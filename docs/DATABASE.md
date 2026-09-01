# 数据与存储

Schema 和字段以 migration 与代码为事实来源。本文件只记录长期边界和一致性规则。

## D1：文章证据、政策跟踪与热点快照

生产绑定为 `DB`，数据库名 `eastmoney`。当前运行时关注：

- `article`：文章元数据、摘要和重要性；不保存正文。
- `keyword`：按 `(article_id, ordinal)` 保存结构化主题、事实、解读和影响。
- `hotspot_snapshot`：追加保存完整热点响应、输入指纹、生成时间、模型和已经解析的证据范围。
- `policy_event` / `policy_news`：由 ingest 的 Policy Workflow 写入规范政策卡片与原始资讯证据；Dashboard 只读取。
- `policy_article`：政策与 article 的多对多关系。AI 自动关系保存置信度与依据；Dashboard 人工关联或排除写为 `manual`，后续 AI 不覆盖。
- `research_commentary`：通用标准化点评，类型覆盖时事快评、政策跟踪和海外事件；当前政策页以 `policy_id UNIQUE` 保证每项政策至多一条点评，并保存 AI 初版和人工修订状态。

`daily_hotspot` 与 `hotspot_cache` 是历史 migration 中的旧结构，不应作为新功能的运行时入口。最新读取统一走 `hotspot_snapshot`。

规则：

- D1 结构修改写入 `migrations/`，并检查共享同一生产数据库的 `ingest` 写入契约。
- 本地开发默认使用本地 D1；`pnpm dev` 不同步远端数据。
- `pnpm db:sync:remote` 仅做显式的有限增量同步；不要把它加入普通启动流程。
- 快照为追加记录，不原地覆盖历史生成结果。
- 政策聚合只由 ingest Workflow 执行；政策点评只由页面人工点击生成，不设自动生成任务。

## Neon：二级池台账

Worker 通过 `HYPERDRIVE` 访问 `bond` schema：

- `ledger_upload`：不可变 R2 对象、Workflow 状态和导入计数。
- `daily_statistics`：Sheet1 的逐日统计。
- `daily_position`：按工作表名称合并交易户与可供户的报表日持仓明细，导入时统一重排行号，主键 `(report_date, row_number)`。
- `transaction_record`：由两类账户持仓数量字段统一派生，主键 `(report_date, position_row_number, side)`。

规则：

- PostgreSQL migration 只放 `postgres-migrations/`，由 `pnpm bond:db:migrate` 使用直连 `DATABASE_URL` 执行。
- 每个请求或 Workflow step 创建并关闭一个 `pg.Client`；不在 Worker 全局建立连接池或跨请求复用连接。
- 导入使用全局锁、同日报表 advisory lock 和单事务，避免并发导入交叉覆盖。
- 同一日期只允许一个成功导入；业务表必须能追溯到 `source_upload_id`。
- SQL 必须参数化并优先批量读写；禁止按持仓逐条查询。

## R2

Worker 只绑定私有 `eastmoney` R2 bucket，并通过固定小写前缀隔离对象：

- `bond-ledger/YYYY-MM-DD.xlsx`：二级池台账定稿。同日重新上传覆盖当天对象；上传解析阶段暂存于 `bond-ledger/.pending/<uuid>.xlsx`，Workflow 成功后归档并删除临时对象。页面统计不得通过下载 R2 文件重新计算。
- `market-briefing/YYYY-MM-DD.json`：市场点评人工定稿快照，只包含规范报告字段、今日聚焦和定稿时间，不含原始上游响应；只有显式保存定稿才覆盖当天对象，当天普通加载不读写 R2，选择历史日期时读取并校验该日完整定稿。
- `fund-reports/YYYY-MM-DD.html`：资金日报。同一天再次上传会替换该日报；读取路由不得接受任意对象 key。

资金日报当前不需要 D1/Neon 索引：上传文件名已经提供日期，公开 URL 和 R2 key 都可由日期直接确定；历史列表只枚举 `fund-reports/` 固定前缀并过滤严格日期文件名。需要审批或同日报告的版本历史时再增加独立元数据模型。

## Neon：授信管理

Worker 通过 `HYPERDRIVE` 访问 `credit` schema；本地导入脚本使用直连 `DATABASE_URL`：

- `institution`：以 `(report_date, institution_name)` 为主键，保存机构授信、使用、期限、经办信息、周报名单标记和并发更新时间。
- `item`：以 `(report_date, institution_name, item_type)` 为主键，保存标准化分项额度、已使用和说明。
- `status`、`confidentiality_status` 与 `item_type` 使用 PostgreSQL enum；空授信状态在解析时规范为 `revoked`。

规则：

- migration 只放 `credit-migrations/`，配置直连 `DATABASE_URL` 后运行 `pnpm credit:db:migrate`。
- Excel 只在本地解析；导入必须显式指定报告日期，并先使用 `--dry-run` 核对机构数、两套汇总和质量提示。
- 不建立业务导入审计表、汇总表或导入批次历史。同一报告日期在全局锁、日期锁和单事务内替换机构与分项记录，其他日期保持不变。
- 一览表与周报的机构数、授信总额、已用和可用额度均从 `institution` 聚合；金额统计只纳入 `approved`，不允许使用固定差额修正。
- 可用额度、使用率、周报新增与到期计数以及日历事件由机构和分项记录派生，不落冗余结果。
- 浏览器不接收 Excel、不直连 Neon；详情修改通过同源 `/api/credit` 参数化增量更新，主体与分项在同一事务内提交。

## Neon：融资择时模型

Worker 通过同一 `HYPERDRIVE` 访问 `financing_model` schema：

- `model_run`：quant pipeline 每次运行追加的结构化模型记录；标量直接落列，完整训练样本量与起止发行日独立于样本外验证指标保存，校验迭代、分组均值和优选日期使用 PostgreSQL 原生数组，当前整体结论与模型基础结论分别落列。
- `model_run_market_driver`：每次运行的有序市场驱动因子，主键 `(run_id, ordinal)`。
- `model_run_driver_group`：六类正式特征组的局部 SHAP 发行支持度与权重，主键 `(run_id, ordinal)`。
- `model_run_product_scenario`：3Y/5Y 公募债与次级债四种方案相对各自同类债中位数的同批预测、排序及推荐标记，主键 `(run_id, ordinal)`。
- `model_run_forecast_window`：每次运行的有序未来发行窗口，主键 `(run_id, ordinal)`。
- `timing_decision_record`：每次模型运行至多一条人工决策记录，只保存决策操作和结果；模型日期、历史分位与发行建议从 `model_run` 派生，不设状态列。
- `sell_side_snapshot`：AI Search 检索与 AI Gateway 归纳后的卖方逻辑汇总及人工修订追加快照，读取最新一条。

规则：

- migration 只放 `financing-model-migrations/`，使用 `pnpm financing-model:db:migrate` 应用。
- `model_run` 不保存原始 JSON；dashboard 从结构化列和有序明细表重建前端快照，quant 不写人工结论、历史决策记录和卖方观点。
- 人工结论只增量更新目标 `model_run` 的 `conclusion_*` 与 `conclusion_updated_at`；模型基础结论列保持不变。生成的卖方观点和人工卖方逻辑汇总继续追加保存。
- 历史择时决策记录按 `run_id` upsert；决策操作必填，结果允许后补，二者均由人工输入，不从模型预测自动生成。
- 卖方快照只保存结构化观点、检索口径和源文档 key，不保存 AI Search 返回的完整正文。

## 变更检查

- D1：本地应用 migration，运行热点快照和证据测试。
- Neon：在 PostgreSQL 兼容环境应用对应 schema migration，检查约束、索引、事务回滚和追加顺序。
- 二级池导入解析变化：先运行只读回填盘点；只有明确授权并使用 `--apply` 才写入。
- 授信导入解析变化：先运行 `pnpm credit:import -- --file <xlsx> --date YYYY-MM-DD --dry-run`；确认目标环境后去掉 `--dry-run` 写入。
