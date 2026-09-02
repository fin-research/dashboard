import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import {
  fetchChoiceEconomicIndicatorRows,
  fetchDmFundingRateRows,
  type EconomicIndicatorSyncParams,
} from "../src/lib/server/economic-indicator-sync.ts";
import {
  persistEconomicIndicators,
  type EconomicIndicatorSyncRow,
} from "../src/lib/server/economic-indicators-repository.ts";
import { withPostgres } from "../src/lib/server/postgres.ts";

export type EconomicIndicatorSyncResult = {
  workflowInstanceId: string;
  scheduledTime: number;
  range: { startDate: string; endDate: string };
  requestedIndicators: number;
  returnedIndicators: number;
  dmPages: number;
  storedRows: number;
  asOf: string;
};

const sourceStepConfig = {
  retries: { limit: 4, delay: "30 seconds", backoff: "exponential" as const },
  timeout: "5 minutes",
} as const;

const persistStepConfig = {
  retries: { limit: 4, delay: "30 seconds", backoff: "exponential" as const },
  timeout: "2 minutes",
} as const;

export class EconomicIndicatorSyncWorkflow extends WorkflowEntrypoint<
  Cloudflare.Env,
  EconomicIndicatorSyncParams
> {
  async run(
    event: Readonly<WorkflowEvent<EconomicIndicatorSyncParams>>,
    step: WorkflowStep,
  ): Promise<EconomicIndicatorSyncResult> {
    const scheduledTime =
      event.payload?.scheduledTime ??
      event.schedule?.scheduledTime ??
      event.timestamp.getTime();

    const [choice, dm] = await Promise.all([
      step.do(
        "fetch Choice EDB incremental",
        sourceStepConfig,
        async (context) => {
          const result = await fetchChoiceEconomicIndicatorRows(
            (path, searchParams) => requestDataApi(this.env, path, searchParams),
            "incremental",
            new Date(scheduledTime),
          );
          console.log(
            JSON.stringify({
              event: "economic_indicators_workflow_source",
              source: "choice-edb",
              workflowInstanceId: event.instanceId,
              attempt: context.attempt,
              requestedIndicators: result.requestedCodes.length,
              returnedIndicators: result.returnedCodes.length,
              rowCount: result.rows.length,
              range: result.range,
            }),
          );
          return result;
        },
      ),
      step.do(
        "fetch DM funding history incremental",
        sourceStepConfig,
        async (context) => {
          const result = await fetchDmFundingRateRows(
            (path, searchParams) => requestDataApi(this.env, path, searchParams),
            "incremental",
            new Date(scheduledTime),
          );
          console.log(
            JSON.stringify({
              event: "economic_indicators_workflow_source",
              source: "dm-funding-history",
              workflowInstanceId: event.instanceId,
              attempt: context.attempt,
              requestedIndicators: result.requestedCodes.length,
              returnedIndicators: result.returnedCodes.length,
              rowCount: result.rows.length,
              pageCount: result.pageCount,
            }),
          );
          return result;
        },
      ),
    ]);

    const rows: EconomicIndicatorSyncRow[] = [...choice.rows, ...dm.rows];
    const stored = await step.do(
      "persist Neon economic indicators",
      persistStepConfig,
      async (context) => {
        const result = await withPostgres(
          this.env.HYPERDRIVE?.connectionString,
          "eastmoney-edb-workflow",
          (client) => persistEconomicIndicators(client, rows),
        );
        console.log(
          JSON.stringify({
            event: "economic_indicators_workflow_persisted",
            workflowInstanceId: event.instanceId,
            attempt: context.attempt,
            storedRows: result.rowCount,
            asOf: result.asOf,
          }),
        );
        return result;
      },
    );

    const result: EconomicIndicatorSyncResult = {
      workflowInstanceId: event.instanceId,
      scheduledTime,
      range: choice.range,
      requestedIndicators:
        choice.requestedCodes.length + dm.requestedCodes.length,
      returnedIndicators:
        choice.returnedCodes.length + dm.returnedCodes.length,
      dmPages: dm.pageCount,
      storedRows: stored.rowCount,
      asOf: stored.asOf,
    };
    console.log(
      JSON.stringify({
        event: "economic_indicators_workflow_complete",
        ...result,
      }),
    );
    return result;
  }
}

async function requestDataApi(
  env: Cloudflare.Env,
  path: string,
  searchParams: URLSearchParams,
): Promise<unknown> {
  const url = new URL(`https://eastmoney.hasbai.xyz/data${path}`);
  url.search = searchParams.toString();
  const response = await env.DATA.fetch(
    new Request(url, { headers: { Accept: "application/json" } }),
  );
  if (!response.ok) {
    throw new Error(`Data API request failed: ${path} (HTTP ${response.status})`);
  }
  return response.json();
}
