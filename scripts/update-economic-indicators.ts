import { Client } from "pg";
import { z } from "zod";

import { persistEconomicIndicators } from "../src/lib/server/economic-indicators-repository.ts";
import {
  ECONOMIC_INDICATOR_GROUPS,
  economicIndicatorRange,
} from "../src/lib/trading-research/economic-indicators.ts";

const apply = process.argv.slice(2).includes("--apply");
if (!apply) {
  throw new Error(
    "This is a paid manual sync. Re-run with --apply to query 36 Choice EDB indicators once.",
  );
}

const connectionString =
  process.env.DATABASE_URL ??
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL or CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE is required",
  );
}

const dataApiBaseUrl = resolveDataApiBaseUrl();
const definitions = ECONOMIC_INDICATOR_GROUPS.flatMap(
  (group) => group.indicators,
);
const definitionsByCode = new Map(
  definitions.map((definition) => [definition.code, definition]),
);
const publishDateProxyByCode = new Map<string, string>([
  ["EMM00590832", "EMM00008445"], // NBS monthly activity release
  ["EMI01737210", "EMM00072301"], // NBS CPI release
  ["EMM01607812", "EMM00000012"], // NBS quarterly GDP release
  ["EMM00634721", "EMM00087086"], // PBOC money and credit release
  ["EMM00087129", "EMM00087086"], // PBOC money and credit release
]);
const codes = definitions.map((indicator) => indicator.code);
if (new Set(codes).size !== 36) {
  throw new Error(`Expected 36 unique EDB indicators, received ${new Set(codes).size}`);
}

const choiceTableSchema = z.object({
  function: z.string(),
  fields: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});

const { startDate, endDate } = economicIndicatorRange();
const { startDate: quotaStartDate, endDate: quotaEndDate } = currentWeekRange();
const statistics = await fetchChoiceTable(
  "/choice/data-statistics",
  new URLSearchParams({
    indicators:
      "FUNCENAME,PERIOD,STARTDATE,ENDDATE,THRESHOLD,USEDDATA,USEDRATIO,AVAILABEDATA",
    startDate: quotaStartDate,
    endDate: quotaEndDate,
  }),
);
const quota = statistics.rows.find((row) => row.FUNCENAME === "EM_EDB");
if (!quota) throw new Error("Choice data statistics did not return EM_EDB quota");
const availableBefore = numericField(quota, "AVAILABEDATA");
const usedBefore = numericField(quota, "USEDDATA");
const threshold = numericField(quota, "THRESHOLD");
if (availableBefore < codes.length) {
  throw new Error(
    `Choice EDB quota is insufficient: ${availableBefore} available, ${codes.length} required`,
  );
}

const edb = await fetchChoiceTable(
  "/choice/edb",
  new URLSearchParams({
    edbIds: codes.join(","),
    startDate,
    endDate,
    options: "IsPublishDate=1,FixDate=0",
  }),
);
if (edb.function !== "EDB") {
  throw new Error(`Unexpected Choice function: ${edb.function}`);
}
const publishedDatesBySeriesPeriod = new Map<string, string>();
for (const row of edb.rows) {
  const publishedDate = choicePublishedDate(row.PUBLISHDATE);
  if (!publishedDate || publishedDate > endDate) continue;
  publishedDatesBySeriesPeriod.set(
    seriesPeriodKey(stringField(row, "code"), stringField(row, "date")),
    publishedDate,
  );
}
const rows = edb.rows.flatMap((row) => {
  const code = stringField(row, "code");
  const definition = definitionsByCode.get(code);
  if (!definition) return [];
  const observationDate = stringField(row, "date");
  const proxyCode = publishDateProxyByCode.get(code);
  const publishedDate =
    choicePublishedDate(row.PUBLISHDATE) ??
    (proxyCode
      ? publishedDatesBySeriesPeriod.get(
          seriesPeriodKey(proxyCode, observationDate),
        )
      : null);
  const fallbackDate =
    definition.frequency === "日频" || definition.frequency === "不定期"
      ? observationDate
      : null;
  const date = publishedDate ?? fallbackDate;
  if (!date || date > endDate) return [];
  return [
    {
      code,
      observationDate,
      date,
      value: numericField(row, "RESULT"),
    },
  ];
});
const returnedCodes = new Set(rows.map((row) => row.code));
const missingCodes = codes.filter((code) => !returnedCodes.has(code));
if (missingCodes.length) {
  throw new Error(`Choice EDB response is missing indicators: ${missingCodes.join(",")}`);
}

const client = new Client({
  connectionString,
  application_name: "eastmoney-edb-manual-sync",
});
try {
  await client.connect();
  const result = await persistEconomicIndicators(client, rows);
  console.log(
    JSON.stringify(
      {
        quota: {
          period: quota.PERIOD,
          threshold,
          usedBefore,
          availableBefore,
          estimatedCharge: codes.length,
          estimatedAvailableAfter: availableBefore - codes.length,
        },
        range: { startDate, endDate },
        storedRows: result.rowCount,
        distinctIndicators: returnedCodes.size,
        asOf: result.asOf,
      },
      null,
      2,
    ),
  );
} finally {
  await client.end().catch(() => undefined);
}

async function fetchChoiceTable(
  path: string,
  searchParams: URLSearchParams,
): Promise<z.infer<typeof choiceTableSchema>> {
  const url = new URL(`${dataApiBaseUrl}${path}`);
  url.search = searchParams.toString();
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Data API request failed: ${path} (HTTP ${response.status})`);
  }
  return choiceTableSchema.parse(await response.json());
}

function resolveDataApiBaseUrl(): string {
  const configured = process.env.DATA_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const proxyTarget = process.env.DATA_PROXY_TARGET?.trim();
  if (proxyTarget) return `${proxyTarget.replace(/\/$/, "")}/data`;
  return "https://eastmoney.hasbai.xyz/data";
}

function currentWeekRange(now = new Date()): {
  startDate: string;
  endDate: string;
} {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const weekday = end.getUTCDay() || 7;
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - weekday + 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function stringField(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || !value) {
    throw new Error(`Choice response field ${field} is invalid`);
  }
  return value;
}

function numericField(row: Record<string, unknown>, field: string): number {
  const value = Number(row[field]);
  if (!Number.isFinite(value)) {
    throw new Error(`Choice response field ${field} is invalid`);
  }
  return value;
}

function choicePublishedDate(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  if (/^\d{8}$/.test(normalized)) {
    return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  return null;
}

function seriesPeriodKey(code: string, observationDate: string): string {
  return `${code}:${observationDate}`;
}
