# 数据与存储

Schema 和字段以 migration 与代码为事实来源。本文件只记录长期边界和一致性规则。

## D1：文章证据与热点快照

生产绑定为 `DB`，数据库名 `eastmoney`。当前运行时关注：

- `article`：文章元数据、摘要和重要性；不保存正文。
- `keyword`：按 `(article_id, ordinal)` 保存结构化主题、事实、解读和影响。
- `hotspot_snapshot`：追加保存完整热点响应、输入指纹、生成时间、模型和已经解析的证据范围。

`daily_hotspot` 与 `hotspot_cache` 是历史 migration 中的旧结构，不应作为新功能的运行时入口。最新读取统一走 `hotspot_snapshot`。

规则：

- D1 结构修改写入 `migrations/`，并检查共享同一生产数据库的 `ingest` 写入契约。
- 本地开发默认使用本地 D1；`pnpm dev` 不同步远端数据。
- `pnpm db:sync:remote` 仅做显式的有限增量同步；不要把它加入普通启动流程。
- 快照为追加记录，不原地覆盖历史生成结果。

## Neon：二级池台账

Worker 通过 `HYPERDRIVE` 访问 `bond` schema：

- `ledger_upload`：不可变 R2 对象、Workflow 状态和导入计数。
- `daily_statistics`：Sheet1 的逐日统计。
- `daily_position`：Sheet2 的报表日持仓明细，主键 `(report_date, row_number)`。
- `transaction_record`：由持仓数量字段派生，主键 `(report_date, position_row_number, side)`。

规则：

- PostgreSQL migration 只放 `postgres-migrations/`，由 `pnpm bond:db:migrate` 使用直连 `DATABASE_URL` 执行。
- 每个请求或 Workflow step 创建并关闭一个 `pg.Client`；不在 Worker 全局建立连接池或跨请求复用连接。
- 导入使用全局锁、同日报表 advisory lock 和单事务，避免并发导入交叉覆盖。
- 同一日期只允许一个成功导入；业务表必须能追溯到 `source_upload_id`。
- SQL 必须参数化并优先批量读写；禁止按持仓逐条查询。

## R2

`BOND_LEDGER` 只保存原始 Excel 归档并用于 Workflow 输入和下载。页面统计不得通过下载 R2 文件重新计算。删除数据库报表日不会删除原始对象。

## Neon：融资择时模型

Worker 通过同一 `HYPERDRIVE` 访问 `financing_model` schema：

- `model_run`：quant pipeline 每次运行追加的不可变结构化快照；核心指标为检索列，完整契约保存在 `payload` JSONB。
- `conclusion_revision`：页面人工修改整体结论的追加修订，读取最新一条；无修订时回退到模型 `base_conclusion`。
- `sell_side_snapshot`：AI Search 检索与 AI Gateway 归纳后的卖方观点追加快照，读取最新一条。

规则：

- migration 只放 `financing-model-migrations/`，使用 `pnpm financing-model:db:migrate` 应用。
- dashboard 不更新或删除 `model_run.payload`；quant 不写人工结论和卖方观点。
- 人工结论和卖方观点都追加保存，不原地覆盖历史版本。
- 卖方快照只保存结构化观点、检索口径和源文档 key，不保存 AI Search 返回的完整正文。

## 变更检查

- D1：本地应用 migration，运行热点快照和证据测试。
- Neon：在 PostgreSQL 兼容环境应用对应 schema migration，检查约束、索引、事务回滚和追加顺序。
- 导入解析变化：先运行只读回填盘点；只有明确授权并使用 `--apply` 才写入。
