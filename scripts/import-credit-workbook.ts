import { readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

import { parseCreditWorkbook } from "../src/lib/credit/workbook.ts";
import {
  persistCreditWorkbook,
  type PersistCreditImportInput,
} from "../src/lib/server/credit-repository.ts";

const options = parseArguments(process.argv.slice(2));
const fileBuffer = await readFile(options.file);
const parsed = parseCreditWorkbook(fileBuffer, {
  reportDate: options.reportDate,
  originalFileName: path.basename(options.file),
});
const input: PersistCreditImportInput = {
  importedAt: new Date().toISOString(),
  parsed,
};

if (options.dryRun) {
  console.log(JSON.stringify({
    mode: "dry-run",
    reportDate: parsed.reportDate,
    fileName: parsed.originalFileName,
    institutionCount: parsed.institutions.length,
    approvedCount: parsed.approvedCount,
    totalLimit: parsed.totalLimit,
    totalUsed: parsed.totalUsed,
    totalAvailable: parsed.totalAvailable,
    weeklyApprovedCount: parsed.weeklyApprovedCount,
    weeklyTotalLimit: parsed.weeklyTotalLimit,
    weeklyTotalUsed: parsed.weeklyTotalUsed,
    weeklyTotalAvailable: parsed.weeklyTotalAvailable,
    warnings: parsed.warnings,
  }, null, 2));
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required unless --dry-run is used");
}
const client = new Client({
  connectionString,
  application_name: "eastmoney-credit-import",
  keepAlive: true,
});
try {
  await client.connect();
  const result = await persistCreditWorkbook(client, input);
  console.log(JSON.stringify({ mode: "import", ...result, warnings: parsed.warnings }, null, 2));
} finally {
  await client.end().catch(() => undefined);
}

function parseArguments(args: string[]): {
  file: string;
  reportDate: string;
  dryRun: boolean;
} {
  let file = "";
  let reportDate = "";
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--file") file = args[++index] ?? "";
    else if (argument === "--date") reportDate = args[++index] ?? "";
    else if (argument === "--dry-run") dryRun = true;
    else throw new Error(`未知参数：${argument}`);
  }
  if (!file || !reportDate) {
    throw new Error(
      "用法：pnpm credit:import -- --file <xlsx> --date YYYY-MM-DD [--dry-run]",
    );
  }
  return { file: path.resolve(file), reportDate, dryRun };
}
