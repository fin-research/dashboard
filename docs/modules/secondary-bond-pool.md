# 二级池

入口：`/secondary-bond-pool`。“二级池周报”一律指新版运营周报，旧版停止维护，仅保留历史深链。公共规则见 [文档分流](../INDEX.md)；仅在任务涉及本模块时读取。

## 接口

- `GET /api/bond-ledger`：数据库报表日和文件状态清单。
- `GET ?start=YYYY-MM-DD&end=YYYY-MM-DD`：区间周报。
- `GET ?date=YYYY-MM-DD`：下载该日报表对应的原始 Excel。
- `GET ?workflow=<id>`：查询导入 Workflow 状态。
- `POST`：上传 Excel 到 `bond-ledger/.pending/` 并启动 Workflow，返回 202；导入成功后覆盖 `bond-ledger/YYYY-MM-DD.xlsx` 并删除临时对象。
- `DELETE ?date=YYYY-MM-DD`：删除该日数据库业务数据，保留 R2 归档。

## 业务规则

- 原始 Excel 是归档输入，不是页面运行时数据源。周报只查询 Neon `bond` schema。
- Excel 时序表跳过两行复合表头与第 3 行基准行，收益率读取全池列而不是交易户子列；交易户和可供户明细按工作表合并。
- `daily_statistics` 对应 Sheet1；`daily_position` 按表名合并“当日交易户数据”和“当日可供户数据”；`transaction_record` 由两类账户持仓的买入量、卖出量和到期量统一派生。
- 台账日“有/无”以 `bond.daily_position` 是否存在为准；`ledger_upload` 只补充文件和 Workflow 状态。
- `/secondary-bond-pool` 与 `/trading-research/secondary-bond-pool` 为二级债券池运营周报，默认查询本年 1 月 1 日至最新已入库台账日，最新日按 `daily_position` 清单确定且不晚于今天；当年无台账时保持当年范围与空状态，不回退到往年。图表从区间内首个有效交易日绘制，并允许从页头选择任意起止日期。默认范围下上传成功后跟进最新日，手选范围保持不变。原 `/bond` 与 `/trading-research/bond` 停止维护、不进入 UI 导航。
- 页头“上传台账”支持多选 Excel，复用 R2 归档和 Workflow 导入接口，逐份等待入库后刷新报告；成功、失败和进度统一使用全局消息。
- “今日质押量”“今日可用量”按交易户与可供户持仓表的列名读取，单位为张，分别入库 `daily_position.pledged_quantity` / `available_quantity`。新格式须同时提供两列，各行均为非负有效数值，并满足“今日质押量＋今日可用量＝今日持仓量”（容差 0.000001 张）；列位置变化不影响其他字段。旧格式两列都缺失时保留 NULL，不补零、不反推。
- 周报 `availability` 返回最新所选台账日两户的 `pledgedQuantity`、`availableQuantity`、`pledgedFaceAmount`、`availableFaceAmount`；数量合并后按每张面值 100 元换算金额，不按估值全价折算。任一有持仓的券缺少字段时，全池质押/可用汇总均为 NULL，页面显示“—”；明确零值显示 0。历史区间不借用以后日期的值，也不再回退到临时 40 亿元配置。
- 图 1 在最新时点的规模轴上只增加质押点标记，不增加质押线或图例；字段缺失时不画质押点。最新持仓/本金说明框同时列示已质押与可用面值金额，复用标签避让算法在容器缩放时重新避开三条规模曲线，并用引导线指向最新持仓点。正文“规模概览”同步列示“质押/卖出回购xx亿元”和可用金额。
- 运营周报的业务本金、时间加权本金、全池市值、杠杆率、含免税累计毛利和年化收益率均按最新有效报表日的全池口径；资产类别、期限分布和 Top 5 仅按交易户市值。平层静态按持仓全价市值加权的含免税报表收益率计算，全池 DV01 合并交易户和可供户。
- 免税增厚等于年内逐日两户免税收入累计，亦等于含免税与不含免税累计毛利之差；累计收益按台账的时间加权本金和自然日年化口径复核。周报生成前必须通过市值守恒、杠杆核算与当日损益守恒三项检查，任一失败时只显示对账差异，不输出报告正文和导出结果。
- 收益与风险指标中的“收益率（含免税）”和“收益率（不含免税）”直接展示最新报表日 `daily_statistics` 的两个年化收益率源字段，不由前端重算；卡片“较上周”比较最新报表日与向前 7 天时点（缺少同日时取此前最近有效交易日）的源字段差值。波动率和最大回撤只使用所选区间内业务本金大于零的有效交易日，单日收益率为“当日营收 ÷ 业务本金”：波动率按单日收益率样本标准差乘以 `√252`，其“较上周”比较所选区间整体向前平移 7 天后的同口径结果；最大回撤按区间复合净值的峰谷跌幅计算。有效交易日不足时不展示不可计算的指标或变动。
- 规模与收益率走势默认展示全池。切换交易户或可供户时，规模按该账户的持仓全价市值汇总；台账没有账户级业务本金，因此收益线按“账户当日损益 ÷ 全池业务本金”计算账户对全池年化收益率的贡献，两个账户贡献与全部口径可加总核对。可供户首次出现前，全池规模和收益归属交易户，可供户规模及贡献为零。
- 同一报表日导入在事务内替换持仓与成交，统计按来源日期幂等更新。较旧报表不得覆盖由较新报表提供的历史统计。
- 删除某日报表会删除三张业务表的该日数据并保留 R2 原始归档。

## 数据流

浏览器上传 Excel → Worker 写入 `bond-ledger/.pending/<uuid>.xlsx` → 创建 Workflow → Worker 内解析 → Neon 单事务更新 → 覆盖 `bond-ledger/YYYY-MM-DD.xlsx` 并删除临时对象 → 页面按日期区间查询数据库生成周报。`/secondary-bond-pool` 与工作台同名子路径使用运营周报组件；原 `/bond` 组件及工作台旧子路径继续存在但不进入导航。

## 存储：Neon：二级池台账

Worker 通过 `HYPERDRIVE` 访问 `bond` schema：

- `ledger_upload`：不可变 R2 对象、Workflow 状态和导入计数。
- `daily_statistics`：Sheet1 的逐日统计。
- `daily_position`：按工作表名称合并交易户与可供户的报表日持仓明细，导入时统一重排行号，主键 `(report_date, row_number)`。
- `transaction_record`：由两类账户持仓数量字段统一派生，主键 `(report_date, position_row_number, side)`。

规则：

- PostgreSQL migration 只放 `postgres-migrations/`，由 `pnpm bond:db:migrate` 使用直连 `DATABASE_URL` 执行。
- `0003_position_pledged_available_quantities.sql` 为持仓新增可空数量列及配对/守恒约束，必须先执行迁移再发布新版读写代码；原有数据保持 NULL。更新旧日期台账时通过页头重新上传原始 Excel，Workflow 在同日事务内替换持仓，成功后更新该日 R2 定稿归档。
- 每个请求或 Workflow step 创建并关闭一个 `pg.Client`；不在 Worker 全局建立连接池或跨请求复用连接。
- 导入使用全局锁、同日报表 advisory lock 和单事务，避免并发导入交叉覆盖。
- 同一日期只允许一个成功导入；业务表必须能追溯到 `source_upload_id`。
- SQL 必须参数化并优先批量读写；禁止按持仓逐条查询。

## 页面设计

- 二级债券池运营周报与融资择时模型在工作台内复用各自独立路由的同一页面组件，并将日期、导出等操作区挂载到工作台页头右侧。运营周报按根目录 `secondary-bond-pool` 成品复刻：独立页使用 `1080px` 报告画布、深蓝抬头、五项窄指标卡、浅灰章节条、图表细边框以及桌面等宽双栏；图 1 必须显示最新持仓与本金，上下两张子图各自提供居中且不与坐标轴重叠的图例，图 3A 使用由深到浅的蓝色渐变序列。移动端按“规模杠杆、收益创收、资产期限、重仓券、跟踪重点”的 DOM 顺序单列展示。报告变体仍由 `MetricCard`、`ModuleCard`、`PanelHeading` 扩展，业务图表继续复用 `ChartHost`。原 `/bond` 与 `/trading-research/bond` 深链保留但不显示在 UI 导航；新入口为 `/secondary-bond-pool` 与 `/trading-research/secondary-bond-pool`。
