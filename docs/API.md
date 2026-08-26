# 接口约定

代码与运行时 Schema 是接口事实来源。本文件记录路由职责和稳定契约，不复制完整响应结构。

## 外部数据服务 `/data/*`

浏览器只通过同源路径访问：

- `GET /data/config`：默认报告配置。
- `POST /data/graphql`：复杂、多资源选择查询；市场点评使用 `marketReport(date:, refresh:)`。
- `POST /data/market-briefing/news?date=YYYY-MM-DD`：供 Worker 使用的新闻素材。

本地 Vite 完整保留 `/data` 前缀并代理到 `DATA_PROXY_TARGET`。线上由独立数据服务处理，Dashboard Worker 不注册这些路由。

`marketReport` 的字段变化必须与 `src/api.ts`、`src/report-view.ts`、`src/text-report.ts` 及相关测试同步。不要恢复 `/data/report`，也不要为视觉版或文字版增加单独的数据源。

浏览器请求示例：

```graphql
query MarketReport($date: Date!, $refresh: Boolean!) {
  marketReport(date: $date, refresh: $refresh) {
    reportDate
    rates
    equities { name close changePct }
    industries { name changePct marketCapYuan }
    primarySummary { currentAmount changeAmount }
  }
}
```

单一资源和写操作继续使用 REST：今日聚焦素材、热点快照、融资择时模型、二级池台账和资金日报都各自属于一个明确业务资源。当前不为这些路由建立第二套 GraphQL 服务。

## Dashboard Worker `/api/*`

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
- `POST`：上传 Excel，成功归档并启动 Workflow 后返回 202。
- `DELETE ?date=YYYY-MM-DD`：删除该日数据库业务数据，保留 R2 归档。

### 融资择时模型

- `GET /api/financing-model`：返回最新 quant 模型快照、当前有效整体结论和最近卖方观点；无模型运行返回 404。
- `GET /api/financing-model?run=<uuid>`：读取指定不可变模型运行。
- `PATCH /api/financing-model/conclusion`：追加人工整体结论修订；请求含 `runId`、`verdict`、`preferredWindow`、`narrative`。
- `POST /api/financing-model/sell-side`：按 `runId` 使用 AI Search 与 AI Gateway 生成并追加卖方观点，成功为 201。

## 通用约定

- JSON 错误使用 `{ "error": "可公开信息" }`；服务端日志可记录诊断信息，但不得包含 Secret 或完整敏感输入。
- 动态生成和台账 JSON 响应使用 `Cache-Control: no-store`。
- 融资择时模型读取、人工结论和卖方生成响应同样使用 `Cache-Control: no-store`；两个写接口执行同源校验，但当前不等同于账号鉴权。
- 日期参数使用严格 `YYYY-MM-DD`；起止日期必须同时提供且起始不晚于结束。
- route handler 只做解析、校验、错误映射和服务调用；业务逻辑放入 `src/lib`。
- 兼容跳转 `/bond-ledger` 固定以 308 指向 `/bond`。
