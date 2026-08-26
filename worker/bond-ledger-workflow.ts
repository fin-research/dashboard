import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { parseBondLedgerBuffer } from "../src/lib/bond-ledger/parser.ts";
import type { BondLedgerImportParams } from "../src/lib/bond-ledger/types.ts";
import {
  persistParsedBondLedger,
  recordFailedBondLedgerImport,
  type FailedBondLedgerInput,
} from "../src/lib/server/bond-ledger-repository.ts";
import { withPostgres } from "../src/lib/server/postgres.ts";
import {
  deletePendingBondLedgerObject,
  finalizeBondLedgerObject,
} from "../src/lib/server/bond-ledger.ts";

const MAX_PERSISTED_PARSE_BYTES = 900 * 1024;

export class BondLedgerImportWorkflow extends WorkflowEntrypoint<
  Env,
  BondLedgerImportParams
> {
  async run(
    event: Readonly<WorkflowEvent<BondLedgerImportParams>>,
    step: WorkflowStep,
  ): Promise<{
    reportDate: string;
    statisticsCount: number;
    positionCount: number;
    transactionCount: number;
  }> {
    const params = event.payload;
    let persisted = false;
    try {
      const parsed = await step.do(
        "parse Excel from R2",
        {
          retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
          timeout: "2 minutes",
        },
        async () => {
          const object = await this.env.EASTMONEY.get(params.r2Key);
          if (!object) {
            throw new NonRetryableError("R2 中找不到待解析的 Excel 文件");
          }
          if (params.r2Etag && object.etag !== params.r2Etag) {
            throw new NonRetryableError("R2 文件版本与上传结果不一致");
          }
          let parsedWorkbook;
          try {
            parsedWorkbook = await parseBondLedgerBuffer(
              await object.arrayBuffer(),
            );
          } catch (error) {
            throw new NonRetryableError(errorMessage(error));
          }
          if (
            params.expectedDate &&
            parsedWorkbook.date !== params.expectedDate
          ) {
            throw new NonRetryableError(
              `重新上传文件的报表日必须为 ${params.expectedDate}，实际为 ${parsedWorkbook.date}`,
            );
          }
          const serializedBytes = new TextEncoder().encode(
            JSON.stringify(parsedWorkbook),
          ).byteLength;
          if (serializedBytes > MAX_PERSISTED_PARSE_BYTES) {
            throw new NonRetryableError(
              "Excel 解析结果过大，无法安全写入 Workflow 状态",
            );
          }
          return parsedWorkbook;
        },
      );

      const result = await step.do(
        "update Neon bond tables",
        {
          retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
          timeout: "2 minutes",
        },
        async () =>
          withPostgres(
            this.env.HYPERDRIVE?.connectionString,
            "eastmoney-bond-workflow",
            (client) =>
              persistParsedBondLedger(client, {
                ...params,
                workflowInstanceId: event.instanceId,
                parsed,
              }),
          ),
      );
      persisted = true;
      await step.do(
        "archive Excel by report date",
        {
          retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
          timeout: "1 minute",
        },
        () =>
          finalizeBondLedgerObject(
            this.env.EASTMONEY,
            params.r2Key,
            params.r2Etag,
            result.reportDate,
          ),
      );
      return result;
    } catch (error) {
      const failure: FailedBondLedgerInput = {
        ...params,
        workflowInstanceId: event.instanceId,
        errorMessage: errorMessage(error),
      };
      try {
        await step.do(
          "record import failure",
          {
            retries: { limit: 1, delay: "5 seconds", backoff: "constant" },
            timeout: "30 seconds",
          },
          async () =>
            withPostgres(
              this.env.HYPERDRIVE?.connectionString,
              "eastmoney-bond-workflow-failure",
              (client) => recordFailedBondLedgerImport(client, failure),
            ),
        );
      } catch (recordError) {
        console.error(
          JSON.stringify({
            event: "bond_ledger_failure_record_failed",
            workflowInstanceId: event.instanceId,
            error: errorMessage(recordError),
          }),
        );
      }
      if (!persisted) {
        await deletePendingBondLedgerObject(
          this.env.EASTMONEY,
          params.r2Key,
        ).catch(() => undefined);
      }
      throw error;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
