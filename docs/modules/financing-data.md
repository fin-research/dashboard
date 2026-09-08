# 融资台账与数据后台

入口：`/financing/data、/financing/debts/[id]`。公共规则见 [文档分流](../INDEX.md)；仅在任务涉及本模块时读取。

## 业务：负债

- 负债品种目录以 `src/lib/financing/debt-types.js` 为唯一代码配置，不建立目录表。
- 基类保存通用金额、利率和生命周期字段；品种表只保存真正专属字段。
- 浮动与固定收益凭证在数据后台合并为“收益凭证”，以 subtype 保留仪表盘筛选维度。
- `client_id` 是单客户关联，继承子表各自显式安装外键；客户主数据、别名及人工维护见 [客户与授信关联](clients.md)。新行按交易对手自动识别，人工指定优先，无法识别时提示待维护。
- 转融资的页面简称和数据库 `name` 统一固定为“转融资”，对手方、市场和日期保留在各自字段，不拼接进简称。
- `total_amount`、`term_days` 和状态由数据库计算，不允许页面自行写入。
- 所有本金、利息、费用和补充流统一为现金流，不建立品种专属 schedule。

## 业务不变量

- 负债状态由生命周期日期生成：未生效、存续、到期、关闭；不得作为可写字段维护。

## 业务不变量

- 有权限的项目、任务和 SOP 普通字段自动保存；创建、删除、启停、安全动作和数据后台逐行编辑显式保存。

## 业务不变量

- 财务数据必须区分数据错误、来源缺失和口径不明确。

## 业务不变量

- Excel 映射或统计口径变化必须对账数量、金额、日期范围、重复 ID 和孤儿引用。

## 业务不变量

- 线上借入资金汇总表仅导入增量：同一浏览器只发起一个任务，advisory lock 串行化写入，同一编码载荷以内容哈希映射唯一 Workflow 实例。按稳定业务身份匹配的历史负债及其现金流全部保留，包括金额、利率、生命周期日期和人工客户关联；仅为新增负债插入现金流。历史余额按日期/品种键冲突跳过。工作簿自身分项与合计仍硬校验；历史余额与新工作簿不同只提示管理员维护，不覆盖历史。唯一匹配产品的到期日修订不产生新负债，重复身份拒绝导入。

## 业务不变量

- 台账增量写入后只补充 `monthly_financing_metrics` 缺失月份，已存历史月度指标不变；衍生刷新失败不得把任务标记为成功。管理员修订历史后可显式调用既有历史重建维护函数。

## 业务不变量

- 不因某一个日期计算吻合就推断业务公式；先取得业务定义和字段口径。

## 业务不变量

- “近期负债发行与到期动态”的本周区间为报告日所在周周一至报告日，下周区间为下一自然周周一至周五；报告日之后、本周剩余日期不计入任一栏。

## 负债模型

- `financing.debt` 是基类；`id bigint` 来自 `debt_id_seq`。
- `bond`、`income_certificate`、`income_right`、`refinancing`、`swap_facility` 使用 PostgreSQL 原生 `INHERITS`。
- 同业拆借与集团借款没有有效专属字段，直接存基类。
- `income_certificate.subscription_date` 与 `redemption_date` 分别保存认购日和兑付日；`maturity_date` 缺失时由数据库按兑付日前一工作日（周一至周五）兜底。简称使用产品名称，去除发行人全称；“吉祥/财气东来 + 序号”统一为“吉祥231号收益凭证”“财气东来1918号收益凭证”格式。
- `refinancing.name` 由数据库触发器和约束固定为“转融资”；对手方、市场、起息日等信息不得拼入简称。
- `total_amount = amount + interest_payable`、`term_days` 和 `status` 是 stored generated columns。
- 负债与融资项目已解除关联；最终 schema 不应包含有效的项目外键。
- 禁止重新引入 import 字段、外部业务键、重复类别字段、可写状态、原始 Excel 行或单元格字段。

PostgreSQL 的主键、唯一约束和外键不会自动覆盖继承子表，因此必须保留：

- 事务级 advisory lock 与触发器保证跨父/子表 ID 全局唯一。
- 触发器校验现金流引用并在删除负债时级联清理。
- 针对继承、计算列、序列、视图和触发器的兼容测试。

## 现金流、余额和视图

- `cashflow` 统一保存本金、利息、费用与补充流，主键 `(debt_id, sequence)`。
- `balance_snapshot` 以 `(as_of_date, debt_type, subtype)` 保存历史余额。
- `monthly_financing_metrics` 固化 2021 年以来已结束月份的余额、加权融资利率和加权剩余期限；migration 一次性回填，之后由周报 RPC 只补缺失的已结束月份，历史行不反复刷新，当前报告月份仍实时计算。
- 线上导入与日常周报 RPC 均只惰性补缺失月份；重建全部历史指标仅属于管理员显式历史维护。
- 常用读取优先使用 `debt_overview`、`cashflow_overview`、`data_overview` 或明确的集合查询。
- 页面数据缺口不能通过新建冗余汇总表临时解决；先评估视图或集合查询。
- `liability_weekly_report_runs` 只保存报告日、R2 key、来源清单、缺失模块和内容哈希；完整报告保存在 R2。安装包导入的 `liability_market_observations`、`liability_peer_issuances`、`liability_registration_progress` 已删除，不得重新作为回退数据源。

## Neon Data API 与 RLS

- Data API 只暴露 `financing` schema，数据库角色为 `authenticated`。
- 可编辑表必须同时进入 `src/lib/financing/data-admin.ts` 白名单、显式 GRANT、RLS policy 和写入审计触发器。
- 数据后台写入白名单为负债品种表、`financial_monthly_data` 与 `debt_limit_configs`；通用表格组件保留但不在页面挂载。
- `financial_monthly_data` 是月度财务宽表，以自然月末 `period_end` 为主键，一月一行，不设指标定义表。基础列为净资本 `net_capital`、证券净资产 `securities_net_assets`、集团净资产 `group_net_assets`、总资产 `total_assets`、总负债 `total_liabilities`、代理买卖证券款 `agency_brokerage_funds`，全部使用亿元；空值代表缺失，允许分次补全。未来基础指标通过 migration 加列，派生指标优先使用数据库计算列。
- `asset_liability_ratio` 为总负债/总资产，`adjusted_asset_liability_ratio` 为（总负债−代理买卖证券款）/（总资产−代理买卖证券款），均是 stored generated columns，保存小数比率，页面转换为百分比。缺少基础金额或分母为零时返回 NULL；基础金额非负，代理买卖证券款不能超过已填总资产或总负债。证券净资产独立录入并与总资产−总负债提示勾稽差额，集团净资产保持独立主体口径。
- 首页、额度和周报通过 `finance_parameters_as_of(date)` 读取截至对应日期的最近非空数据；净资本截至上月末，证券/集团净资产截至上年末，其他列截至报告日。结果保留真实数据日期，允许沿用更早月份并由既有缺口提醒标注，不把后续月份回填到历史报告。历史修订不自动改写已保存的 R2 周报快照，需要显式重新生成。
- 原 `finance_parameters` 仅作为只读迁移档案保留，包括原手工比率和来源；月度维护只写新表。新表沿用 Data API、人员权限 RLS、按月审计和 `updated_at` 并发校验；修改历史月份不会覆盖其他月份。
- Data API 支持 PostgREST 过滤、关联和聚合，也支持调用数据库函数；负债周报使用固定的 `liability_weekly_report_data(date)` RPC 聚合融资业务数据，并通过只读视图 `liability_market_rate_observations` 按指标和日期直接读取原始市场观测。RPC 与视图仅向 `authenticated` 开放，不再要求 JWT 用户关联 `people`；`monthly_financing_metrics` 与底层 `public.edb` 均不直接开放。
- 现金流、历史余额和审计记录不展示，且 `authenticated` 不得通过 Data API 访问。
- 导入载荷、运行状态和结果不写入 Neon；数据库只保存原子提交后的业务表与衍生表结果。
- `role_permissions` 保存三种业务角色与七类权限的授权矩阵；初始 migration 为全部组合授予权限，后续配置只更新 `granted`，不删除权限目录行。
- Data API 可编辑表的 RLS 同时要求人员启用且其角色具有 `data_manage`；SvelteKit mutation 按对应权限类型由服务端授权。
- 更新和删除携带 `updated_at` 做乐观并发检查；主键和计算列只读。
- DDL、视图、函数或列变化后必须显式刷新 Neon Data API schema cache：`neon data-api refresh-schema --database neondb`；migration 中的 PostgreSQL `NOTIFY pgrst` 不能替代 Neon 托管 Data API 的刷新动作。

## Excel 与 SQLite

- 借入资金汇总表可由管理员通过线上内部接口导入。浏览器内解析 `.xlsx` 并生成分批 Protobuf/Brotli 载荷，原始 Excel 不上传；文件上限 10 MB，压缩载荷上限 720 KiB。
- 导入载荷、运行状态和结果只由 Cloudflare Workflow 按短保留期临时保存；Neon 不建立导入临时表、状态表或完成审计。Workflow 只通过 Hyperdrive 在单一事务中更新负债、现金流、余额历史和衍生指标。
- `scripts/financing/import-debts.mjs` 与线上 Workflow 共用同一单事务、advisory lock 和增量批量写入实现；收益凭证重导时先按规范简称匹配，存量历史数据可按原系列名回退匹配；不得删除线上新增数据。集团借款中无金额、无日期、无现金流的可转债说明段落不作为负债导入。
- SQLite 只作为一次性迁移来源；目标负债非空时迁移脚本应拒绝重复覆盖。
- 解析变化先运行 `pnpm financing:db:import -- --dry-run`；SQLite 变化先运行 `pnpm financing:db:migrate:sqlite -- --dry-run`。

导入回归只验证 Excel 映射、单位转换、数量与金额勾稽，不在文档中固化真实业务日期、余额、笔数或历史范围。需要验证时使用未提交的本地样本或测试夹具，并将结果保留在运行环境中，不把真实台账结果写入仓库。

## 页面：Data Administration

- 数据后台的借入资金汇总表导入只对具有 `data_manage` 的角色显示，置于财务指标模块之前，并作为该页唯一最高优先级操作。
- 月度财务数据按月份切换，以紧凑卡片展示当月六项基础金额和两项只读计算比率。右下角加号新增或补录月份，编辑本月可修订任意历史月份；金额以亿元输入，空白代表缺失，月份在编辑时只读，同月不能重复新增。弹窗预览比率和证券净资产勾稽差额，数据库保存后返回最终计算值，成功只就地更新该月份，失败保留输入。通用大表格从页面移除挂载，组件代码保留。
- 文件选定后明确展示名称和大小；浏览器内按“本地解析、编码压缩、等待执行、原子更新、完成”展示阶段、百分比和结果笔数。页面只保存最近 Workflow 实例 ID 以便刷新后恢复，不展示数据库导入历史。
- 仅任务活跃时约每 1.5 秒刷新一次进度；成功或失败后停止轮询，错误保留具体可修正提示，不清空用户已选择的失败文件。
- 窄屏阶段和结果摘要允许换行重排，不产生页面级横向滚动；进度状态同时使用图标、文字和颜色。
