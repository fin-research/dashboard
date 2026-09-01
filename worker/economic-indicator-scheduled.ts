import {
  fetchChoiceEconomicIndicatorRows,
  fetchDmFundingRateRows,
} from "../src/lib/server/economic-indicator-sync.ts";
import { persistEconomicIndicators } from "../src/lib/server/economic-indicators-repository.ts";
import { withPostgres } from "../src/lib/server/postgres.ts";

export async function runEconomicIndicatorScheduledSync(
  env: Cloudflare.Env,
  scheduledTime: number,
): Promise<void> {
  const startedAt = Date.now();
  const request = (path: string, searchParams: URLSearchParams) =>
    requestDataApi(env, path, searchParams);
  const [choice, dm] = await Promise.all([
    fetchChoiceEconomicIndicatorRows(request, "incremental", new Date(scheduledTime)),
    fetchDmFundingRateRows(request, "incremental", new Date(scheduledTime)),
  ]);
  const rows = [...choice.rows, ...dm.rows];
  const result = await withPostgres(
    env.HYPERDRIVE?.connectionString,
    "eastmoney-edb-scheduled-sync",
    (client) => persistEconomicIndicators(client, rows),
  );
  console.log(
    JSON.stringify({
      event: "economic_indicators_incremental_sync",
      range: choice.range,
      requestedIndicators:
        choice.requestedCodes.length + dm.requestedCodes.length,
      returnedIndicators:
        choice.returnedCodes.length + dm.returnedCodes.length,
      dmPages: dm.pageCount,
      storedRows: result.rowCount,
      asOf: result.asOf,
      elapsedMs: Date.now() - startedAt,
    }),
  );
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
