# 接口约定

代码与运行时 Schema 是接口事实来源。本文件记录路由职责和稳定契约，不复制完整响应结构。

## 外部数据服务 `/data/*`

Dashboard Worker 通过同源代理访问：

- `GET /data/config`：默认报告配置。
- `POST /data/graphql`：复杂、多资源选择查询；市场点评使用带 `request` 参数的强类型根字段。
- `POST /data/market-briefing/news?date=YYYY-MM-DD`：供 Worker 使用的新闻素材。

本地 Vite 完整保留 `/data` 前缀并代理到 `DATA_PROXY_TARGET`。线上由独立数据服务处理，Dashboard Worker 不注册这些路由。

市场点评根字段的变化必须与 Worker 映射、`src/report-view.ts`、`src/text-report.ts` 及相关测试同步。不要恢复 `/data/report`，也不要为视觉版或文字版增加单独的数据源。

Worker 精准查询示例：

```graphql
query MarketReport($request: MarketReportInput!) {
  reportDate(request: $request)
  fundingRates(request: $request) { code rate changeBp }
  equities(request: $request) { name close changePct }
  industries(request: $request) { name changePct marketCapYuan }
  primarySummary(request: $request) { currentAmount changeAmount }
}
```

浏览器只通过 Dashboard REST 读取或保存市场点评；今日聚焦素材、热点快照、融资择时模型、二级池台账和资金日报仍各自属于一个明确业务资源，不建立第二套 GraphQL 服务。

## Dashboard Worker `/api/*`

### 市场点评

- `GET /api/market-report?date=YYYY-MM-DD[&refresh=true]`：优先返回 R2 日快照；缺失或刷新时请求 Data API 并覆盖 `market-briefing/YYYY-MM-DD.json`。
- `PUT /api/market-report?date=YYYY-MM-DD`：同源保存完整规范报告与今日聚焦定稿，覆盖当天对象。

### 市场热点

- `GET /api/rag/hotspots`：返回最近快照；无快照为 404；不接受范围参数。
- `POST /api/rag/hotspots`：生成并追加快照，成功为 201。
- 滚动请求：`{"mode":"rolling","rollingCount":20}`，数量必须为 8–100 的整数。
- 日期请求：`{"mode":"range","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}`。

### 今日聚焦

- `POST /api/market-briefing?date=YYYY-MM-DD`：日期缺省时使用上海时区当天。
- 无效日期为 400；上游、模型或配置错误按路由映射为 5xx。

### 资金日报

- `POST /api/fund-report`：上传单个 UTF-8 HTML，文件名末尾必须为 `YYYYMMDD.html` 或 `YYYY-MM-DD.html`；成功为 201。
- 请求体为原始 HTML 文件，`X-Fund-Report-Filename` 传 URL 编码的原文件名，`X-Fund-Report-Size` 传文件字节数。
- Worker 将文件保存为 R2 `fund-reports/YYYY-MM-DD.html`；同日报告再次上传会覆盖并在响应中返回 `replaced: true`。
- `GET /fund-report`：以 `Cache-Control: no-store` 返回按日期倒序排列的历史资金日报列表。
- `GET /fund-report/YYYY-MM-DD.html`：从 R2 返回 HTML；无该日报为 404。

### 二级池台账

- `GET /api/bond-ledger`：数据库报表日和文件状态清单。
- `GET ?start=YYYY-MM-DD&end=YYYY-MM-DD`：区间周报。
- `GET ?date=YYYY-MM-DD`：下载该日报表对应的原始 Excel。
- `GET ?workflow=<id>`：查询导入 Workflow 状态。
- `POST`：上传 Excel 到 `bond-ledger/.pending/` 并启动 Workflow，返回 202；导入成功后覆盖 `bond-ledger/YYYY-MM-DD.xlsx` 并删除临时对象。
- `DELETE ?date=YYYY-MM-DD`：删除该日数据库业务数据，保留 R2 归档。

### 融资择时模型

- `GET /api/financing-model`：返回最新 quant 模型快照、当前有效整体结论和最近卖方观点；无模型运行返回 404。
- `GET /api/financing-model?run=<uuid>`：读取指定不可变模型运行。
- `PATCH /api/financing-model/conclusion`：追加人工整体结论修订；请求含 `runId`、`verdict`、`preferredWindow`、`narrative`。
- `POST /api/financing-model/sell-side`：按 `runId` 使用 AI Search 与 AI Gateway 生成并追加卖方逻辑汇总及 4–5 家逐机构观点，成功为 201。
- `PATCH /api/financing-model/sell-side`：追加人工卖方逻辑汇总修订；请求含 `runId`、`logicSummary`，保留原检索口径与来源证据。

### 授信管理

- `GET /api/credit`：读取最新授信报告日。
- `GET /api/credit?date=YYYY-MM-DD`：读取指定报告日；无该日期记录返回 404，无数据库连接返回 503，无效日期返回 400。
- 响应同时返回一览表口径 `summary`、周报名单口径 `weeklySummary`、上一报告日汇总、机构和分项、授信额度变动、使用额度变动及日历事件。
- 周环比基准是小于当前日期的上一可用报告日，不要求恰好相隔七天。授信额度变动和使用额度变动分开计算，新增但使用额为零的机构不进入使用额度变动。
- `PATCH /api/credit`：以 `(reportDate, institutionName, expectedUpdatedAt)` 定位一条机构记录，保存详情字段和完整分项，使用 `updated_at` 防止旧响应覆盖新数据；成功只返回变更机构及受影响的服务端派生汇总。
- GET 与 PATCH 均使用 `Cache-Control: no-store`。Excel 解析仍只由本地命令执行，浏览器不上传源文件。

## 通用约定

- JSON 错误使用 `{ "error": "可公开信息" }`；服务端日志可记录诊断信息，但不得包含 Secret 或完整敏感输入。
- 动态生成和台账 JSON 响应使用 `Cache-Control: no-store`。
- 融资择时模型读取、人工结论、卖方生成和卖方修订响应同样使用 `Cache-Control: no-store`；写接口执行同源校验，但当前不等同于账号鉴权。
- 日期参数使用严格 `YYYY-MM-DD`；起止日期必须同时提供且起始不晚于结束。
- route handler 只做解析、校验、错误映射和服务调用；业务逻辑放入 `src/lib`。
- 兼容跳转 `/bond-ledger` 固定以 308 指向 `/bond`。
