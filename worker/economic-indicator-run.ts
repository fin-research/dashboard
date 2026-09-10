import type { WorkflowStep } from "cloudflare:workers";
import {
  choiceRequestBatches, fetchDmFundingRateRows,
  normalizeChoiceEconomicIndicatorRows, parseChoiceEconomicIndicatorTable,
  type DataApiRequest, type ChoiceEconomicIndicatorRawRow,
} from "../src/lib/server/economic-indicator-sync.ts";
import type { EconomicIndicatorSyncRow } from "../src/lib/server/economic-indicators-repository.ts";
import {
  EconomicIndicatorRequestError, economicIndicatorErrorDetails,
  redactEconomicIndicatorError,
} from "../src/lib/server/economic-indicator-request.ts";

// limit counts retries AFTER the initial call: 3 attempts, delayed 1m then 2m.
export const ECONOMIC_INDICATOR_STEP_CONFIG = {
  retries: { limit: 2, delay: "1 minute", backoff: "exponential" as const },
  timeout: "2 minutes",
} as const;

type RequestSpec = {
  id: string;
  source: "choice-edb" | "dm-funding-history";
  path: string;
  parameters: Record<string, string>;
  codes: string[];
};
type Failure = { step: string; request: RequestSpec; error: { name: string; message: string } };
type Outcome<T> = { ok: true; value: T } | { ok: false; failure: Failure };
type Fetched = { rawRows: ChoiceEconomicIndicatorRawRow[]; rows: EconomicIndicatorSyncRow[]; pageCount: number };
type Stored = { rowCount: number; asOf: string; returnedCodes: string[] };

export type EconomicIndicatorSyncResult = {
  workflowInstanceId: string;
  scheduledTime: number;
  status: "complete" | "partial" | "failed";
  range: { startDate: string; endDate: string };
  requestedIndicators: number;
  returnedIndicators: number;
  dmPages: number;
  storedRows: number;
  asOf: string;
  requests: Array<{ id: string; source: string; codes: string[]; status: "complete" | "failed"; storedRows: number }>;
  failures: Failure[];
};

export function economicIndicatorRequests(scheduledTime: number): RequestSpec[] {
  const endDate = new Date(scheduledTime + 8 * 3600_000).toISOString().slice(0, 10);
  const choice = choiceRequestBatches("incremental", endDate).map((batch, index): RequestSpec => {
    const codes = batch.definitions.map(({ code }) => code);
    return { id: `choice-${index + 1}`, source: "choice-edb", path: "/choice/edb", codes,
      parameters: { edbIds: codes.join(","), startDate: batch.startDate, endDate, options: "IsPublishDate=1,FixDate=0" } };
  });
  const dm = [["DR001", "E1300003"], ["DR007", "E1300004"], ["R007", "E1704420"]].map(([bondCode, code]): RequestSpec => ({
    id: `dm-${bondCode!}`, source: "dm-funding-history", path: "/cfets-histories", codes: [code!],
    parameters: { bondCode: bondCode!, endCapitalTime: String(scheduledTime), limit: "100",
      fields: "bondCode,capitalTime,weightedYield,weightedYieldUpDownValueBp" },
  }));
  return [...choice, ...dm];
}

export async function runEconomicIndicatorSync(
  step: Pick<WorkflowStep, "do">,
  workflowInstanceId: string,
  scheduledTime: number,
  request: DataApiRequest,
  persist: (rows: EconomicIndicatorSyncRow[]) => Promise<{ rowCount: number; asOf: string }>,
): Promise<EconomicIndicatorSyncResult> {
  const specs = economicIndicatorRequests(scheduledTime);
  const endDate = new Date(scheduledTime + 8 * 3600_000).toISOString().slice(0, 10);

  async function isolatedStep<T extends Rpc.Serializable<T>>(
    name: string, spec: RequestSpec, operation: () => Promise<T>,
  ): Promise<Outcome<T>> {
    try {
      const value = await step.do(name, ECONOMIC_INDICATOR_STEP_CONFIG, async (context) => {
        try { return await operation(); }
        catch (error) {
          const diagnostic = { workflowInstanceId, step: name, request: spec,
            attempt: context.attempt, error: economicIndicatorErrorDetails(error) };
          console.error(JSON.stringify({ event: "economic_indicators_workflow_step_failed", ...diagnostic }));
          // Error.message is durably retained for each attempt, including recovered errors.
          throw new Error(JSON.stringify(diagnostic));
        }
      });
      return { ok: true, value };
    } catch (error) {
      // Catch exhausted steps inside their branch before joining any other work.
      const failure: Failure = { step: name, request: spec, error: economicIndicatorErrorDetails(error) };
      return { ok: false, failure };
    }
  }

  const fetched = specs.map((spec) => isolatedStep(`fetch ${spec.id} ${spec.path}`, spec, async (): Promise<Fetched> => {
    let payload: unknown;
    try {
      payload = await request(spec.path, new URLSearchParams(spec.parameters));
      if (spec.source === "choice-edb") {
        return { rawRows: parseChoiceEconomicIndicatorTable(payload), rows: [], pageCount: 0 };
      }
      const dm = await fetchDmFundingRateRows(async () => payload, "incremental", new Date(scheduledTime), [spec.parameters.bondCode!]);
      return { rawRows: [], rows: dm.rows, pageCount: dm.pageCount };
    } catch (error) {
      if (payload === undefined) throw error;
      const body = redactEconomicIndicatorError(JSON.stringify(payload));
      throw new EconomicIndicatorRequestError({ path: spec.path, parameters: spec.parameters,
        stage: "response_validation", responseBody: body.slice(0, 24_000), responseTruncated: body.length > 24_000,
        cause: economicIndicatorErrorDetails(error) });
    }
  }));

  // Publication-date proxies can be in a different Choice batch. DM persists
  // immediately, independently of that Choice metadata dependency.
  const choiceReferences = Promise.all(fetched.filter((_, index) => specs[index]!.source === "choice-edb"))
    .then((results) => results.flatMap((result) => result.ok ? result.value.rawRows : []));

  const completed = await Promise.all(specs.map(async (spec, index) => {
    const source = await fetched[index]!;
    if (!source.ok) return { spec, source, stored: source };
    const referenceRows = spec.source === "choice-edb" ? await choiceReferences : [];
    const stored = await isolatedStep(`persist ${spec.id} Neon economic indicators`, spec, async (): Promise<Stored> => {
      const rows = spec.source === "choice-edb"
        ? normalizeChoiceEconomicIndicatorRows(source.value.rawRows, endDate, referenceRows)
        : source.value.rows;
      // A successful empty incremental window is valid; retain existing history.
      const result = rows.length ? await persist(rows) : { rowCount: 0, asOf: "" };
      return { ...result, returnedCodes: [...new Set(rows.map(({ code }) => code))] };
    });
    return { spec, source, stored };
  }));

  const failures = completed.flatMap(({ stored }) => stored.ok ? [] : [stored.failure]);
  const stored = completed.flatMap(({ stored }) => stored.ok ? [stored.value] : []);
  const result: EconomicIndicatorSyncResult = {
    workflowInstanceId, scheduledTime,
    status: failures.length === 0 ? "complete" : failures.length === specs.length ? "failed" : "partial",
    range: { startDate: specs.flatMap((spec) => spec.parameters.startDate ? [spec.parameters.startDate] : []).sort()[0]!, endDate },
    requestedIndicators: specs.reduce((sum, spec) => sum + spec.codes.length, 0),
    returnedIndicators: new Set(stored.flatMap(({ returnedCodes }) => returnedCodes)).size,
    dmPages: completed.reduce((sum, { source }) => sum + (source.ok ? source.value.pageCount : 0), 0),
    storedRows: stored.reduce((sum, item) => sum + item.rowCount, 0),
    asOf: stored.map(({ asOf }) => asOf).sort().at(-1) ?? "",
    requests: completed.map(({ spec, stored }) => ({ id: spec.id, source: spec.source, codes: spec.codes,
      status: stored.ok ? "complete" : "failed", storedRows: stored.ok ? stored.value.rowCount : 0 })),
    failures,
  };
  // Preserve an explicit partial/failed result beyond transient log retention.
  return step.do("record economic indicator sync result", ECONOMIC_INDICATOR_STEP_CONFIG, async () => {
    const log = result.status === "complete" ? console.log : console.error;
    log(JSON.stringify({ event: "economic_indicators_workflow_result", ...result }));
    return result;
  });
}
