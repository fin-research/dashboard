# 交易研究工作台数据范围与接入口径

## 当前交付边界

工作台当前包含七个标签页：总览、交易管理、授信管理、研究辅助、流程中心、二级池周报和融资择时模型。授信管理已经接入 Neon `credit` schema：业务人员每周在本地解析 Excel 并按报告日期写入数据库，浏览器通过同源 `/api/credit` 和 Hyperdrive 读取。研究辅助通过受控的人工命令批量查询 Choice EDB 并写入 Neon `public.edb`，浏览器只通过同源 `/api/economic-indicators` 读取；交易和流程中心仍使用仓库内冻结数据；二级池与融资择时复用现有生产页面组件和各自既有数据链路。

上述数据边界属于工程实现说明，不在工作台 UI 展示“演示数据”“静态演示”“未来统一由数据库与同源 `/data` API 提供”等提示。业务页面只展示模块、数据基准日和业务状态，避免以实现说明占用研究界面。

演示数据来自 `/Users/yueshi/src/eastmoney/交易研究授信`：

- 交易数据与资金存量：`dashboard/app.js` 中的冻结演示快照，基准时点为 `2026-08-07 15:00`。
- 授信数据：本地 Excel 的“授信一览表”和“授信周报”Sheet，经 `pnpm credit:import` 按明确的报告日期写入 Neon；源 Excel 不提交到仓库。
- 研究数据：Choice EDB 的 36 个国内外经济、利率、商品与风险资产序列；人工同步保存近 18 个月有效观测，页面读取 Neon 快照。
- 流程中心：沿用原项目的交易流程与授信周报流程结构，当前任务卡仍由演示数据组装，只用于展示状态流转布局。

原项目的 `source-data/` Excel、登录、局域网 FastAPI、PostgreSQL、Nginx、账号权限和管理员页面均未迁入。源 Excel 含受控业务数据，不应提交到 dashboard 仓库。

## 页面范围

主标签使用 path 路由，不使用 `?view=` 查询参数：

- `/trading-research`：总览。
- `/trading-research/trading`：交易管理。
- `/trading-research/credit`：授信管理。
- `/trading-research/research`：研究辅助。
- `/trading-research/workflow`：流程中心。
- `/trading-research/bond`：二级池周报。
- `/trading-research/financing-model`：融资择时模型。

原 `/bond` 与 `/financing-model` 深链保留，并与工作台子路径复用同一 Svelte 页面组件，不建立第二套业务、样式或请求实现；首页不再重复展示两张入口卡。嵌入工作台时隐藏原页面标题区，日期、台账管理、导出和刷新按钮合并到工作台页头右侧。

| 视图 | 当前展示 | 暂不包含 |
| --- | --- | --- |
| 总览 | 资金存量、当日交易、最新授信可用额度、核心利率、风险事项、数据覆盖 | 除授信外的迁入数据实时刷新 |
| 交易管理 | 当日汇总、品种分布、对手集中度、交易筛选与明细 | 交易录入、聊天解析、凭证生成、押券校验写入 |
| 授信管理 | 数据库一览表、逐列排序、详情自动保存、授信日历，以及不含明细附表的周报汇总和环比变动 | 额度调整审批、系统内投资人自动归集 |
| 研究辅助 | 9 类 × 4 项经济数据走势卡，展示指标名称、最新日期、最新值和近18个月趋势 | OMO 操作、政策卡片和指标自定义 |
| 流程中心 | 交易与授信周报表单布局、只读任务与节点进度 | 登录身份、创建、提交、退回、复核、归档和导出 |
| 二级池周报 | 复用原二级池数据库周报、日期范围、图表与台账管理 | 无新增平行实现 |
| 融资择时模型 | 复用原模型快照、发行窗口、人工结论和卖方观点 | 无新增平行实现 |

页面不得把不同基准日数据伪装为同一时点；总览必须保留“多基准日”状态，各业务视图显示自身 `asOf` 或统计区间。

## 统一业务口径

### 交易

- 纳入范围仅为“同业拆借（纯信用）”和“拆出（质押式回购）”。质押式回购融入不计入该工作台交易范围。
- 金额统一使用亿元，接口传输建议使用字符串形式十进制数或最小货币单位，前端不得以二进制浮点作为账务事实来源。
- 利率字段使用百分数值，例如 `1.85` 表示 `1.85%`；利率变动使用 bp。
- 当日成交加权利率：`sum(amount_yi * rate_pct) / sum(amount_yi)`。
- 纯信用占比：`同业拆借成交金额 / 纳入范围成交金额`。
- 对手集中度按纳入范围内的当日成交金额聚合；生产接口需返回用于复核的分母、排名和统计日期。
- 待确认仅表示业务状态，不等于失败或风险处置完成。

### 授信

- 一览表保留“授信一览表”全部机构；周报口径取“授信周报”Sheet 的机构名单。两套口径分别聚合并在 API 中同时返回，不能用固定调整数互相换算。
- `available = total - used`；`utilization_pct = used / total * 100`，`total = 0` 时使用率为 `null`，不得除零后展示为0%。
- 总额、已用、可用和使用率的聚合只纳入 `approved`；空状态在导入时规范为 `revoked`。
- 周报指标固定为授信总额、已用额度、可用额度、新增授信家数和到期家数。新增包含新批、续签和扩额，到期包含授信到期和状态撤销，同一机构在一个比较期内去重。
- 周报不展示全量机构明细附表；授信额度变动与使用额度变动分别计算、分别成表。
- 日历事件分为到期与新增；新增包含生效、续签和扩额，事件同时返回待生效、已生效、待到期、已到期或已撤销状态。
- 缺失到期日保留为 `null`，不得伪造日期。

### 授信导入与存储

- 本地解析命令必须显式传入 `--date YYYY-MM-DD`；不得使用 Excel 中会随打开日期变化的公式单元格推断报告日。
- 数据粒度是报告日。`credit.institution` 保存机构记录，`credit.item` 保存标准化细项；汇总、可用额度和事件从这两张表派生。
- 不建立业务导入审计表、汇总表或导入批次历史。同一报告日期在 advisory lock 和单事务内先删除再重建机构与分项记录；其他日期不受影响。
- 详情修改通过 `PATCH /api/credit` 自动保存，服务端用 `updated_at` 做乐观并发检查。

### 研究

- 研究快照必须包含来源、文件哈希或上游批次 ID、统计区间、生成方式、规则版本、校验结果和复核状态。
- 利率值使用百分数值，变动使用 bp；曲线必须带期限和观测日。
- 当前研究底稿未覆盖的 SHIBOR 曲线、逐日 OMO、政策原文、国内高频和海外市场数据均应明确返回 `available: false` 与 `reason`，不得用模拟数字进入正式快照。
- 规则模板输出不等同于大模型输出，也不等同于研究岗已复核结论。

### 流程

- 交易流程节点：交易员提交 → 投资经理复核 → 合规复核 → 部门负责人复核 → 交易员归档。
- 授信周报节点：授信专员提交 → 授信主管复核 → 周报待导出 → 已导出。
- 每次写操作必须提交 `expectedVersion`，服务端执行乐观锁；流程事件只追加，不覆盖历史审计记录。
- 任务状态、当前节点、经办人、复核人、意见、时间和版本必须由服务端返回，前端不得自行推断。

## 数据分层

浏览器不得直连数据库或 Choice EDB。授信和研究辅助均由 dashboard Worker 通过 Hyperdrive 读取 Neon，其中研究辅助只读 `public.edb`。Choice EDB 仅允许人工同步命令调用；其余尚未接入的迁入模块未来仍通过明确的服务端接口读取。

建议逻辑数据域如下，物理数据库与 schema 需在后续接口设计时由数据所有方确认，不能复用或交叉写入 dashboard 现有 Neon `bond`、`financing_model` schema：

| 数据域 | 逻辑实体 | 必备主键/版本 |
| --- | --- | --- |
| 交易 | `trade`, `trade_collateral`, `trade_status_event` | `trade_id`, `version`, `event_id` |
| 授信 | `credit.institution`, `credit.item` | `report_date`, `institution_name`, `item_type`, `updated_at` |
| 研究 | `research_snapshot`, `market_observation`, `curve_point`, `source_availability` | `snapshot_id`, `series_code`, `observation_date` |
| 流程 | `workflow_task`, `workflow_event`, `workflow_assignment` | `task_id`, `event_id`, `version` |

授信日报按日期保存，同日更正直接事务替换，不另建导入审计记录；其他业务域若需要不可变历史，应在各自契约中独立设计。列表接口必须稳定排序并返回明确报告日期。

## API 契约

已实现的授信读接口：

- `GET /api/credit`：读取最新报告日。
- `GET /api/credit?date=YYYY-MM-DD`：读取指定报告日；同时返回上一可用报告日、两套汇总、机构数据、两类周环比变动和预警。

研究辅助已实现接口：

- `GET /api/economic-indicators`：由 dashboard Worker 通过 Hyperdrive 读取 Neon `public.edb`，返回 `asOf`、`syncedAt` 和近 18 个月的 `rows`。
- 人工更新命令先调用 Data API `GET /choice/data-statistics` 检查 `EM_EDB` 当前周余量，再调用一次 `GET /choice/edb` 读取全部 36 个指标；固定使用 `IsPublishDate=0,FixDate=0`。
- Choice 原始“核心 CPI（上年同月=100）”在前端减 100 展示同比；10Y-2Y 原始百分点在前端乘 100 展示 bp。其他指标不做口径换算。
- Choice EDB 按指标代码计次，不按批量 HTTP 请求计次；一次同步 36 个指标消耗 36 次，页面挂载、刷新和重试均消耗 0 次 Choice EDB 额度。

首次建表及以后人工更新：

```bash
pnpm edb:db:migrate
pnpm edb:update -- --apply
```

`edb:update` 默认使用生产 Data API，可通过 `DATA_API_BASE_URL` 或 `DATA_PROXY_TARGET` 覆盖；命令不自动重试，缺少 `--apply` 会在网络和数据库操作前退出，避免误耗付费额度。命令一次 upsert 当前 36 项指标的近 18 个月原始观测；页面展示换算仍由前端统一完成。

尚未接入模块的首期接口建议：

首期读接口建议：

- `GET /data/trading-research/overview?as_of=YYYY-MM-DD`
- `GET /data/trading-research/trades?date=YYYY-MM-DD&query=&product=&status=&cursor=&limit=`
- `GET /data/trading-research/workflows?scope=mine|pending&cursor=&limit=`

流程写接口在身份、权限和审计方案确认后再开放，建议保持同一 `/data/trading-research/workflows/*` 资源前缀：创建草稿、提交、通过、退回、归档和导出分别使用明确动作端点，并携带 `expectedVersion`。所有写接口必须进行账号鉴权、岗位授权、CSRF/同源校验、输入 Schema 校验和审计落库。

通用响应规则：

- 日期使用上海时区的严格 `YYYY-MM-DD`，时间使用含时区 ISO 8601。
- 动态业务数据使用 `Cache-Control: no-store`；授信按 `reportDate` 选择日报记录。
- 错误响应使用 `{ "error": "可公开信息", "code": "稳定错误码" }`，不得向浏览器返回数据库 SQL、文件路径或密钥。
- 生产响应使用 Zod 或等价 Schema 在服务端和 dashboard 客户端边界校验；字段变更先升级 `schemaVersion` 并同步契约测试。

## 接入顺序与验收

1. 授信先以 Excel 日报导入作为事实来源，逐项核对两套汇总、机构数量、细项合计、周报名单和阈值结果。
2. 投资人及业务明细进入数据库后，再设计自动占用归集与未匹配告警；不得把当前 Excel 数字与未来自动归集结果混为同一口径。
3. 交易接入前确定数据所有权、权限和 `/data/trading-research/*` OpenAPI/Schema；需保留 `GET /data/trading-research/trades?date=YYYY-MM-DD&query=&product=&status=&cursor=&limit=` 契约。
4. 研究数据通过人工同步接入 Choice EDB；新增或替换指标时先复核名称、单位、频率、区域和展示换算，并同步指标映射测试。任何调试不得用页面挂载或循环请求验证付费 EDB。
5. 流程中心最后接入身份和写操作，完成角色矩阵、乐观锁、流程审计事件和导出权限测试。

正式验收至少核对：交易汇总与明细求和一致、授信总额勾稽一致、研究曲线日期一致、流程版本冲突可见、所有页面显示明确基准日、移动端仅表格区域横向滚动。
