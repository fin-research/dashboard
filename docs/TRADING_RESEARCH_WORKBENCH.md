# 交易研究工作台数据范围与接入口径

## 当前交付边界

`/trading-research` 当前是静态页面演示，只迁入原项目的五个业务视图：总览、交易管理、授信管理、研究辅助、流程中心。页面不读取 Excel、不访问数据库、不调用 `/data/*`，也不产生交易、审批、复核或导出记录。

演示数据来自 `/Users/yueshi/src/eastmoney/交易研究授信`：

- 交易数据与资金存量：`dashboard/app.js` 中的冻结演示快照，基准时点为 `2026-08-07 15:00`。
- 授信数据：`dashboard/data/credit-snapshot.json`，基准日为 `2026-08-21`，快照 ID 为 `credit-20260821-6096d604b537`。
- 研究数据：`dashboard/data/research-snapshot.json`，完整周为 `2026-08-10` 至 `2026-08-14`，快照 ID 为 `market-20260814-ebd1924910cc`。
- 流程中心：沿用原项目的交易流程与授信周报流程结构，当前任务卡由上述演示交易和授信快照组装，只用于展示状态流转布局。

原项目的 `source-data/` Excel、登录、局域网 FastAPI、PostgreSQL、Nginx、账号权限和管理员页面均未迁入。源 Excel 含受控业务数据，不应提交到 dashboard 仓库。

## 页面范围

| 视图 | 当前展示 | 暂不包含 |
| --- | --- | --- |
| 总览 | 资金存量、当日交易、授信可用额度、核心利率、风险事项、数据覆盖 | 二级资金池、融资择时、实时刷新 |
| 交易管理 | 当日汇总、品种分布、对手集中度、交易筛选与明细 | 交易录入、聊天解析、凭证生成、押券校验写入 |
| 授信管理 | 发布汇总、口径勾稽、高使用率机构、预警、风险优先样例明细 | 全量120条分页、历史趋势、额度调整审批 |
| 研究辅助 | 快照校验、核心利率、近10日趋势、存单曲线、国债曲线、缺失范围 | 未被底稿覆盖的宏观高频、海外、OMO、政策卡片 |
| 流程中心 | 交易与授信周报表单布局、只读任务与节点进度 | 登录身份、创建、提交、退回、复核、归档和导出 |

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

- 发布范围以授信周报当前机构名单为准，不直接按主表全部有效行汇总。
- `available = total - used`；`utilization_pct = used / total * 100`，`total = 0` 时使用率为 `null`，不得除零后展示为0%。
- 当前快照发布总额为 `3448.35` 亿元，已使用 `1022.5955` 亿元，可用 `2425.7545` 亿元，使用率 `29.6546%`。
- 主表有效记录为 `3450.35` 亿元；按当前周报名单排除历史或合并机构记录 `2.00` 亿元后得到发布口径。
- 使用率达到60%进入关注，达到80%进入预警；到期预警必须同时携带基准日、到期日和剩余天数。
- 缺失到期日保留为 `null` 并显示“待补录”，不得伪造日期。

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

## 未来数据分层

浏览器不得直连数据库。数据库保存业务事实和不可变快照，`api` 仓库通过同源 `/data/*` 暴露读写契约，dashboard 只做请求、筛选和呈现。

建议逻辑数据域如下，物理数据库与 schema 需在后续接口设计时由数据所有方确认，不能复用或交叉写入 dashboard 现有 Neon `bond`、`financing_model` schema：

| 数据域 | 逻辑实体 | 必备主键/版本 |
| --- | --- | --- |
| 交易 | `trade`, `trade_collateral`, `trade_status_event` | `trade_id`, `version`, `event_id` |
| 授信 | `credit_snapshot`, `credit_line`, `credit_scope_adjustment`, `credit_alert` | `snapshot_id`, `line_id`, `rule_version` |
| 研究 | `research_snapshot`, `market_observation`, `curve_point`, `source_availability` | `snapshot_id`, `series_code`, `observation_date` |
| 流程 | `workflow_task`, `workflow_event`, `workflow_assignment` | `task_id`, `event_id`, `version` |

快照表应不可变追加；更正通过新快照或修订事件表达。列表接口必须稳定排序，并返回 `asOf`、`generatedAt`、`sourceBatchId`、`schemaVersion` 和分页信息。

## 建议 `/data` API 契约

首期读接口建议：

- `GET /data/trading-research/overview?as_of=YYYY-MM-DD`
- `GET /data/trading-research/trades?date=YYYY-MM-DD&query=&product=&status=&cursor=&limit=`
- `GET /data/trading-research/credits/latest` 或 `GET /data/trading-research/credits?snapshot_id=`
- `GET /data/trading-research/research/latest` 或 `GET /data/trading-research/research?snapshot_id=`
- `GET /data/trading-research/workflows?scope=mine|pending&cursor=&limit=`

流程写接口在身份、权限和审计方案确认后再开放，建议保持同一 `/data/trading-research/workflows/*` 资源前缀：创建草稿、提交、通过、退回、归档和导出分别使用明确动作端点，并携带 `expectedVersion`。所有写接口必须进行账号鉴权、岗位授权、CSRF/同源校验、输入 Schema 校验和审计落库。

通用响应规则：

- 日期使用上海时区的严格 `YYYY-MM-DD`，时间使用含时区 ISO 8601。
- 动态业务数据使用 `Cache-Control: no-store`；冻结快照若缓存，必须以不可变 `snapshotId` 为键。
- 错误响应使用 `{ "error": "可公开信息", "code": "稳定错误码" }`，不得向浏览器返回数据库 SQL、文件路径或密钥。
- 生产响应使用 Zod 或等价 Schema 在服务端和 dashboard 客户端边界校验；字段变更先升级 `schemaVersion` 并同步契约测试。

## 接入顺序与验收

1. 在 `api` 仓库确定数据所有权、数据库实体、权限和 `/data/trading-research/*` OpenAPI/Schema。
2. 先接交易和授信只读接口，逐项对比演示快照的汇总、明细数量、范围调整与阈值结果。
3. 接研究快照时保留 `available` 缺失状态，不以页面占位数据替代上游事实。
4. 流程中心最后接入身份和写操作，完成角色矩阵、乐观锁、审计事件和导出权限测试。
5. dashboard 切换到远程数据后必须覆盖加载、空状态、部分失败、过期快照、分页、筛选和重试；不得把 `200` 之外的响应静默降级为旧演示数据。

正式验收至少核对：交易汇总与明细求和一致、授信总额勾稽一致、研究曲线日期一致、流程版本冲突可见、所有页面显示明确基准日、移动端仅表格区域横向滚动。
