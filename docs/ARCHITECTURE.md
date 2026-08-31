# 系统架构

## 运行单元

项目由 SvelteKit 应用和自定义 Cloudflare Worker 入口组成。`worker/entry.ts` 承载构建后的 SvelteKit Worker，并注册 `BondLedgerImportWorkflow`。静态资源由 Worker Assets 提供。

Worker Assets 只承载随应用版本一起构建、发布的前端资源。资金日报是每日独立上传且需要运行时立即生效的业务文件，因此存入 R2，不写入构建目录，也不触发 Worker 重新发布。

```text
Browser
├→ Svelte pages / components / charts
├→ /data/market-report/*、/data/industry、/data/stock-summary ──→ Data Worker
├→ /api/market-report ──→ R2 市场点评定稿 JSON
├→ /fund-report/* ──────→ R2 HTML 日报
├→ /data/* ─────────────→ TypeScript Data Worker
└→ /api/* ──────────────→ SvelteKit Worker routes
                          ├→ D1
                          ├→ AI Gateway
                          ├→ R2
                          ├→ Workflow → Hyperdrive → Neon bond
                          └→ Hyperdrive → Neon credit

quant pipeline ──────────→ Neon financing_model
Browser /financing-model → Worker → Hyperdrive → financing_model
                                  └→ AI Search MCP → AI Gateway

Local credit Excel ──────→ local parser → Neon credit
```

## 页面与派生层

- `src/routes/` 负责页面装配、路由参数和 HTTP 边界，不承载复杂业务计算。
- `src/App.svelte` 保留市场点评的整体报告装配。
- `src/api.ts` 直接读取同源 `/data/*` 分段资源，并只用 Dashboard `/api/market-report` 读取或保存人工定稿。
- `src/report-view.ts` 将 API 已规范的最小报告字段投影为视觉数据。
- `src/text-report.ts` 从同一份报告数据生成文字版，必须复用共享口径而不是建立第二套数据源。
- `src/charts/` 只负责图表配置和图形表达；业务筛选应位于视图派生层。
- `/trading-research` 的授信管理通过 `/api/credit` 读取 Neon `credit` 日报；总览复用其最新可用额度。研究辅助由浏览器直接查询同源 `/data/graphql` 的 Choice EDB 字段，不经过 Dashboard `/api/*`；交易和流程中心仍读取 `src/lib/trading-research/demo-data.ts`，二级池与融资择时复用原页面组件及既有数据链路。具体边界见 `docs/TRADING_RESEARCH_WORKBENCH.md`。

## 服务端模块

- `src/lib/server/hotspots.ts` 读取结构化证据并调用模型。
- `src/lib/server/hotspot-snapshots.ts` 负责最新快照读取、范围校验与追加写入。
- `src/lib/server/market-briefing.ts` 分别从 `/data/stock-summary`、`/data/news` 和新闻详情取材，在 Dashboard Worker 组装提示词并生成今日聚焦。
- `src/lib/server/market-report.ts` 只负责按日 R2 定稿读取与覆盖，不查询 Data API。
- `src/lib/server/ai-gateway.ts` 是生成式模型唯一适配器，使用 provider-specific Responses API 固定执行 `custom-opencode` → `custom-codex` 顺序 fallback。
- `src/lib/server/bond-ledger.ts` 处理台账请求、R2、Workflow 与下载边界。
- `src/lib/server/fund-report.ts` 校验并归档资金日报 HTML，枚举固定前缀生成历史列表，并按确定性的日期 key 从 R2 读取单期日报。
- `src/lib/server/bond-ledger-repository.ts` 封装 `bond` schema SQL；`src/lib/server/postgres.ts` 管理短生命周期连接。
- `src/lib/server/credit-repository.ts` 封装 `credit` schema 的报表日导入、机构自动保存、历史日期读取、日历事件和相邻报告日比较；Worker 复用短生命周期 PostgreSQL 连接。
- `src/lib/server/financing-model-repository.ts` 从 `model_run` 结构化列及有序明细表重建 quant 快照，增量更新同一运行的当前整体结论，并追加卖方观点和逻辑汇总修订；`src/lib/server/financing-model-research.ts` 按 `AI.md` 调用 AI Search MCP，再通过统一 AI Gateway 生成结构化卖方逻辑汇总。

## 核心数据流

### 市场点评

浏览器并发请求 `/data/market-report/*`、`/data/industry` 和 `/data/stock-summary`，再在 `src/api.ts` 组装规范报告；一级发行在行业资源给出上一交易日后单独请求。市场数据不经过 Dashboard Worker，也不使用 Data GraphQL 聚合。浏览器另以 `GET /api/market-report?date=` 只读取已有 R2 定稿并合并 `focus_text`；无定稿时继续展示实时分段数据。`PUT /api/market-report` 保存完整报告和人工定稿的今日聚焦。

### 市场热点

`ingest` 写入的 D1 `article` / `keyword` → Worker 读取证据 → AI Gateway → 追加 `hotspot_snapshot` → 页面读取最近快照。

### 二级池

浏览器上传 Excel → Worker 写入 `bond-ledger/.pending/<uuid>.xlsx` → 创建 Workflow → Worker 内解析 → Neon 单事务更新 → 覆盖 `bond-ledger/YYYY-MM-DD.xlsx` 并删除临时对象 → 页面按日期区间查询数据库生成周报。

### 资金日报

管理页上传完整 HTML → Worker 校验文件名日期、大小、编码和 HTML 文档头 → R2 `fund-reports/YYYY-MM-DD.html`。`/fund-report` 枚举固定前缀并按日期倒序展示历史列表；日期页只解析确定性的对象 key，不接受任意 R2 路径。

### 融资择时模型

quant pipeline → 本地结构化结果 → Neon `financing_model.model_run` 标量列、原生数组及有序明细表 → dashboard 重建最新运行。人工结论通过 PATCH 增量更新同一条 `model_run` 的当前结论列；卖方观点由页面手动触发，Worker 使用模型日期最近七个上海自然日的 AI Search 证据，经 AI Gateway 严格 Schema 归纳为单段逻辑汇总及 4–5 家逐机构观点后追加保存。人工编辑逻辑汇总时保留原逐机构观点和检索证据，并追加新快照。

### 交易研究工作台

授信链路：本地 Excel → `scripts/import-credit-workbook.ts` 解析“授信一览表”和“授信周报” → Neon `credit.institution` / `credit.item`；浏览器 `/trading-research/credit` → `/api/credit` → Hyperdrive → Neon。读取、周报比较、日历事件和自动保存的服务端确认结果均来自数据库。

研究辅助链路：浏览器 `/trading-research/research` → 同源 `/data/graphql` → Data API
`choiceEdb` → Choice EDB。一次页面加载用一个 GraphQL 请求读取 36 个指标的近 18 个月观测，
前端只负责两项明确展示换算和走势图抽样，不经过 Dashboard Worker 后端路由。

交易和流程中心当前仍由冻结数据 → `src/lib/trading-research/demo-data.ts` → 对应只读视图；`/bond` 与 `/financing-model` 的同一页面组件同时装配到工作台子路径。

工作台路由使用真实 path：`/trading-research`、`/trading-research/trading`、`/trading-research/credit`、`/trading-research/research`、`/trading-research/workflow`、`/trading-research/bond`、`/trading-research/financing-model`。不使用 `?view=`；原 `/bond`、`/financing-model` 保留。

后续：交易与流程业务数据库 → 服务端接口 → dashboard 浏览器。浏览器不得直连数据库；研究辅助直连的是统一 Data API 而不是数据库。所有授信数据只写 `credit` schema，不交叉写入 `bond` 或 `financing_model`。

## 依赖规则

- 浏览器模块不得导入 `$lib/server` 或直接访问 D1、R2、Hyperdrive。
- 图表模块不得自行请求数据。
- 路由 handler 保持轻薄；可复用校验和业务逻辑放入 `src/lib`。
- Workflow 代码留在 `worker/`，避免 Cloudflare runtime 类型污染浏览器 TypeScript 环境。
- 新增报告口径先扩展共享派生层和测试，再接入视觉或文字消费者。
