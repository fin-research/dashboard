# 授信工作台

入口：`/credit-workbench`。公共规则见 [文档分流](../INDEX.md)；仅在任务涉及本模块时读取。

## 接口

- `GET /api/credit`：读取最新授信报告日。
- `GET /api/credit?date=YYYY-MM-DD`：读取指定报告日；无该日期记录返回 404，无数据库连接返回 503，无效日期返回 400。
- 响应同时返回同一口径的一览表 `summary`、周报 `weeklySummary`、上一报告日汇总、机构和分项、本周结构化授信事件 `weeklyNews`、截至所选报表日近六个月的新增/续作/扩额批复 `recentApprovals`、使用额度变动及日历事件。
- 周环比基准是小于当前日期的上一可用报告日，不要求恰好相隔七天。本周事件包括新增、续作、扩额、到期和撤销；续作与扩额同时发生时只记为扩额。新增但使用额为零的机构不进入使用额度变动。
- `PATCH /api/credit`：以 `(reportDate, institutionName)` 定位一条机构记录，`changes.institution` 仅传发生变化的主体字段，`changes.items` 仅传发生变化的分项及字段；主体与分项在同一事务内更新并重算响应。同字段并发修改以后提交者为准，不同字段自然合并；空增量或非法字段返回 400，记录不存在返回 404。
- GET 与 PATCH 均使用 `Cache-Control: no-store`。Excel 解析仍只由本地命令执行，浏览器不上传源文件。

## 存储：Neon：授信管理

Worker 通过 `HYPERDRIVE` 访问 `credit` schema；本地导入脚本使用直连 `DATABASE_URL`：

- `institution`：以 `(report_date, institution_name)` 为主键，保存机构授信、使用、期限、经办信息和并发更新时间；不保存源行号或周报名单标记。
- `item`：以 `(report_date, institution_name, item_type)` 为主键，保存标准化分项额度、原导入已使用和说明。收益凭证、同业拆借展示值从 `item_usage` 读取融资余额，保留原导入值供核对。
- `institution_event`：以 `(report_date, institution_name)` 为主键，保存相邻报表日之间的新增、续作、扩额、到期和撤销事件，以及事件发生时的额度、期限和授信分项快照。
- `status` 与 `item_type` 使用 PostgreSQL enum；`confidentiality_status` 为 boolean，原 `signed` 转 true，`not_signed` / `unknown` 均转 false；空授信状态在解析时规范为 `revoked`。

规则：

- migration 只放 `credit-migrations/`，配置直连 `DATABASE_URL` 后运行 `pnpm credit:db:migrate`。
- Excel 只在本地解析；导入必须显式指定报告日期，并先使用 `--dry-run` 核对机构数、统一汇总和质量提示。
- 不建立业务导入审计表、汇总表或导入批次历史。同一报告日期在全局锁、日期锁和单事务内替换机构与分项记录，保留不带日期的静态客户关联；事务内重算全部 `institution_event`，确保补导或重导历史日期时后续比较期同步更新。
- 一览表与周报的机构数和授信总额由 `institution` 聚合，已用和可用额度由 `institution_usage` 读取；金额统计只纳入 `approved`，不允许使用固定差额修正。
- 可用额度、使用率和日历事件由机构和分项记录派生；本周快讯、周报新增与到期计数以及近六个月批复从 `institution_event` 读取。
- 浏览器不接收 Excel、不直连 Neon；详情修改通过同源 `/api/credit` 参数化增量更新，主体与分项在同一事务内提交。

## 页面设计

- 授信工作台为首页一级入口 `/credit-workbench`，四个 path 标签页依次为授信一览表（根路径）、授信日历（`/calendar`）、授信周报（`/weekly`）、授信问答（`/assistant`）。两个工作台必须复用 `src/lib/workbench/WorkbenchShell.svelte` 的顶栏、侧栏、移动端抽屉、主内容区和样式；只配置名称、导航和业务内容。

## 页面设计

- 授信工作台的前三个标签页复用同一个 `CreditView.svelte`，由路由参数选择一览表、日历和周报，切换这三个标签时保留已加载报表和编辑状态：一览表默认隐藏已撤销机构（可通过状态筛选查看），按政策性银行、国有行、股份行、城商行、农商行、民营银行、外资行排序，同类按名称排序；支持筛选、逐列排序、显示行序号和详情自动保存；日历按全部、到期、新增筛选事件；周报展示同口径汇总、本周五类结构化授信事件、近六个月新增/续作/扩额批复和授信明细附表。快讯使用编号列表，同一机构同时续作和扩额时只记扩额；明细附表展示全部未撤销机构，按同一分类顺序及银行性质合并单元格，不呈现分项额度变化或使用额度变化为独立快讯。

## 页面设计

- 授信四个标签使用共享侧栏导航，报表日和导出控件挂载到工作台顶栏右侧；“报表日”与选择框水平排列并使用 `1rem` 字号。页面正文不重复展示报告日、机构数、数据来源或导入时间等说明小字。

## 页面设计

- 授信历史日期通过工具栏日期选择器切换；周报使用统一 `1080px` 版式报告画布，打印时隐藏 App Shell、工具栏和交互控件，只输出标题、报告日期、汇总与变动正文。打印不等于建立另一套页面或数据口径。

## 客户与融资使用额

- `institution_client` 静态关联一个或多个 `public.client`，不带报告日，作为唯一归属规则表，新增明确名称可自动匹配，合并与分项归属见 [客户关联规范](clients.md)。
- 收益凭证、同业拆借使用额按报告日读取融资存续本金，元转亿元；总已用额始终为六类有效分项之和。管理员增删改分项时数据库同步原始分项合计；导入总数与分项不一致时警告原数、合计和差额，并使用分项合计。
- 客户未关联显示缺失，不按零计算可用额度。总已用额及上述两项使用额在 API 与页面只读，需修订时维护融资负债。其它分项继续人工维护。
- 接口在机构返回 `clients`、`importedTotalUsed`，分项返回 `usageSource`、`importedUsedAmount`、`linkedClientCount`；`importedTotalUsed` 表示原始分项合计，`importedUsedAmount` 保留导入融资分项值用于核对。
- `credit.usage_reconciliation` 和 `scripts/reconcile-client-usage.mjs` 用于跨历史日期核对，区分融资差异、未关联与总额/分项不一致。
