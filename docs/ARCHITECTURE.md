# 系统架构

## 运行单元

项目由 SvelteKit 应用和自定义 Cloudflare Worker 入口组成。`worker/entry.ts` 承载构建后的 SvelteKit Worker，并注册 `BondLedgerImportWorkflow`。静态资源由 Worker Assets 提供。

Worker Assets 只承载随应用版本一起构建、发布的前端资源。资金日报是每日独立上传且需要运行时立即生效的业务文件，因此存入 R2，不写入构建目录，也不触发 Worker 重新发布。

```text
Browser
├→ Svelte pages / components / charts
├→ /api/market-report ──→ R2 市场点评 JSON / Data API GraphQL
├→ /fund-report/* ──────→ R2 HTML 日报
├→ /data/* ─────────────→ Python data service
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
- `src/api.ts` 只访问同源 Dashboard `/api/*`。
- `src/report-view.ts` 将 API 已规范的最小报告字段投影为视觉数据。
- `src/text-report.ts` 从同一份报告数据生成文字版，必须复用共享口径而不是建立第二套数据源。
- `src/charts/` 只负责图表配置和图形表达；业务筛选应位于视图派生层。
- `/trading-research` 的授信管理通过 `/api/credit` 读取 Neon `credit` 日报；总览复用其最新可用额度。交易、研究和流程中心仍读取 `src/lib/trading-research/demo-data.ts`，二级池与融资择时复用原页面组件及既有数据链路。具体边界见 `docs/TRADING_RESEARCH_WORKBENCH.md`。

## 服务端模块

- `src/lib/server/hotspots.ts` 读取结构化证据并调用模型。
- `src/lib/server/hotspot-snapshots.ts` 负责最新快照读取、范围校验与追加写入。
- `src/lib/server/market-briefing.ts` 从 `/data/market-briefing/news` 取材并生成今日聚焦。
- `src/lib/server/market-report.ts` 负责精准 GraphQL 查询、按日 R2 快照和人工定稿覆盖。
- `src/lib/server/ai-gateway.ts` 是生成式模型唯一适配器，使用 provider-specific Responses API 固定执行 `custom-opencode` → `custom-codex` 顺序 fallback。
- `src/lib/server/bond-ledger.ts` 处理台账请求、R2、Workflow 与下载边界。
- `src/lib/server/fund-report.ts` 校验并归档资金日报 HTML，枚举固定前缀生成历史列表，并按确定性的日期 key 从 R2 读取单期日报。
- `src/lib/server/bond-ledger-repository.ts` 封装 `bond` schema SQL；`src/lib/server/postgres.ts` 管理短生命周期连接。
- `src/lib/server/credit-repository.ts` 封装 `credit` schema 的日报写入、历史日期读取和相邻报告日比较；Worker 读取仍复用短生命周期 PostgreSQL 连接。
- `src/lib/server/financing-model-repository.ts` 读取 quant 快照并追加人工结论和卖方观点；`src/lib/server/financing-model-research.ts` 按 `AI.md` 调用 AI Search MCP，再通过统一 AI Gateway 生成结构化交叉验证。

## 核心数据流

### 市场点评

浏览器 `GET /api/market-report?date=` → Dashboard Worker → `market-briefing/YYYY-MM-DD.json`。R2 未命中或显式刷新时，Worker 才用精准 GraphQL 查询 Data API 的强类型根字段并覆盖当天快照。视觉版与文字版共享同一最小规范契约；`PUT /api/market-report` 保存完整报告和人工定稿的今日聚焦。

### 市场热点

`ingest` 写入的 D1 `article` / `keyword` → Worker 读取证据 → AI Gateway → 追加 `hotspot_snapshot` → 页面读取最近快照。

### 二级池

浏览器上传 Excel → Worker 写入 `bond-ledger/.pending/<uuid>.xlsx` → 创建 Workflow → Worker 内解析 → Neon 单事务更新 → 覆盖 `bond-ledger/YYYY-MM-DD.xlsx` 并删除临时对象 → 页面按日期区间查询数据库生成周报。

### 资金日报

管理页上传完整 HTML → Worker 校验文件名日期、大小、编码和 HTML 文档头 → R2 `fund-reports/YYYY-MM-DD.html`。`/fund-report` 枚举固定前缀并按日期倒序展示历史列表；日期页只解析确定性的对象 key，不接受任意 R2 路径。

### 融资择时模型

quant pipeline → 本地结构化 JSON → Neon `financing_model.model_run` 追加快照 → dashboard 读取最新运行。人工结论写入追加修订表；卖方观点由页面手动触发，Worker 使用模型日期最近七个上海自然日的 AI Search 证据，经 AI Gateway 严格 Schema 归纳后追加保存。

### 交易研究工作台

授信链路：本地 Excel → `scripts/import-credit-workbook.ts` 解析“授信一览表”和“授信周报” → Neon `credit` 日报表；浏览器 `/trading-research/credit` → `/api/credit` → Hyperdrive → Neon。周报比较当前报告日与上一可用报告日，不在前端重算数据库事实。

其他迁入模块当前仍由冻结数据 → `src/lib/trading-research/demo-data.ts` → 对应只读视图；`/bond` 与 `/financing-model` 的同一页面组件同时装配到工作台子路径。

工作台路由使用真实 path：`/trading-research`、`/trading-research/trading`、`/trading-research/credit`、`/trading-research/research`、`/trading-research/workflow`、`/trading-research/bond`、`/trading-research/financing-model`。不使用 `?view=`；原 `/bond`、`/financing-model` 保留。

后续：交易、研究与流程业务数据库 → 服务端接口 → dashboard 浏览器。浏览器不得直连数据库；所有授信数据只写 `credit` schema，不交叉写入 `bond` 或 `financing_model`。

## 依赖规则

- 浏览器模块不得导入 `$lib/server` 或直接访问 D1、R2、Hyperdrive。
- 图表模块不得自行请求数据。
- 路由 handler 保持轻薄；可复用校验和业务逻辑放入 `src/lib`。
- Workflow 代码留在 `worker/`，避免 Cloudflare runtime 类型污染浏览器 TypeScript 环境。
- 新增报告口径先扩展共享派生层和测试，再接入视觉或文字消费者。
