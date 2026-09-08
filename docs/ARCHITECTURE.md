# 系统架构

## 运行单元

项目由 SvelteKit 应用和自定义 Cloudflare Worker 入口组成。`worker/entry.ts` 承载构建后的 SvelteKit Worker，并注册 `BondLedgerImportWorkflow`。静态资源由 Worker Assets 提供。

Worker Assets 只承载随应用版本一起构建、发布的前端资源。资金日报是每日独立上传且需要运行时立即生效的业务文件，因此存入 R2，不写入构建目录，也不触发 Worker 重新发布。

```text
Browser
├→ Svelte pages / components / charts
├→ /data/* 单一上游映射资源 ────────────────────────────────→ Data Worker
├→ /api/market-report ──→ R2 市场点评定稿 JSON
├→ /fund-report/* ──────→ R2 HTML 日报
├→ /data/* ─────────────→ TypeScript Data Worker
└→ /api/* ──────────────→ SvelteKit Worker routes
                          ├→ D1
                          ├→ AI Gateway
                          ├→ R2
                          ├→ Workflow → Hyperdrive → Neon bond
                          └→ Hyperdrive → Neon credit

SvelteKit Worker /api/market-briefing ── DATA Service Binding ──→ Data Worker

quant pipeline ──────────→ Neon financing_model
Browser /financing-model → Worker → Hyperdrive → financing_model
                                  └→ AI Search MCP → AI Gateway

ingest Cron → PolicyWorkflow → D1 policy_event / policy_news / policy_article
Browser /trading-research/policy-tracking → Dashboard Worker → D1
                                      └→ manual commentary generation → DATA + AI Gateway

Local credit Excel ──────→ local parser → Neon credit
```

## 页面与派生层

- `src/routes/` 负责页面装配、路由参数和 HTTP 边界，不承载复杂业务计算。
- `src/App.svelte` 保留市场点评的整体报告装配。
- `src/api.ts` 按上海日期分流：当天对同源 `/data/*` 原始资源做一次请求编排，用 `fields` 请求最小 DTO 并经 Zod 校验；每个资源独立捕获错误并以显式空结构继续构建报告，同时返回 resource issue 供依赖模块显示“数据缺失”。历史日期优先 GET 完整 R2 定稿，收到 `REPORT_NOT_FINALIZED` 时按所选日期重新请求原始资源；只有手动保存定稿才 PUT `/api/market-report`。
- `src/market-report-resources.ts` 在浏览器内完成市场点评的筛选、合并与口径换算，产出的唯一 `ReportData` 同时供视觉版和文字版使用。
- `src/report-view.ts` 将 API 已规范的最小报告字段投影为视觉数据。
- `src/text-report.ts` 从同一份报告数据生成文字版，并把可识别的文字版手动编辑反向更新到规范报告数据；不得保存完整文字版或建立第二套数据源。
- `src/charts/` 只负责图表配置和图形表达；业务筛选应位于视图派生层。
- `/credit-workbench` 的授信报表通过 `/api/credit` 读取 Neon `credit` 日报；交易研究工作台总览复用其最新可用额度。研究辅助通过 `/api/economic-indicators` 和 Hyperdrive 读取 Neon `public.edb`；融资工作台的负债周报也只读这张公共表。Choice EDB 与 DM 只由首次本地全历史回填及每日增量 Cron 调用。交易和流程中心仍读取 `src/lib/trading-research/demo-data.ts`，二级池与融资择时复用原页面组件及既有数据链路。具体边界见 `docs/TRADING_RESEARCH_WORKBENCH.md`。
- `/trading-research/policy-tracking` 只读 ingest Workflow 已聚合的政策、面向境内资金/利率研究的三档重要性与自动研报关系；人工调整关系和手动生成/编辑政策点评通过同源 `/api/policies/*` 写 D1。页面加载和筛选不调用模型。政策资讯、关联研报与点评分别使用 `/news/[id]`、`/articles/[id]`、`/commentaries/[id]` 独立深链；政策资讯详情读取 D1 已归档的 DM 原文与政策原文链接，研报详情通过 Worker 的 `DATA` Service Binding 获取正文，点评详情只读 D1。

- 交易研究工作台与授信工作台使用同一 `src/lib/workbench/WorkbenchShell.svelte`。市场热点和政策跟踪由 `src/lib/pages/` 维护单一业务组件，在工作台内使用嵌入布局；旧独立入口仅做兼容跳转。授信问答以固定根容器包裹聊天和工具栏，只有嵌套工具栏通过 portal 挂载页头，避免切换标签时遗留聊天 DOM。

## 服务端模块

- 授信问答使用同一 Worker 内的 `CreditAgent`（Agents SDK + SQLite Durable Object），从独立 R2 `credit` 原件/解析文本及 AI Search `credit` 找证据，执行有来源的计算后通过统一 Gateway 生成并复核答复。入口、材料更新、数据边界与 Access 预留路径见 `docs/CREDIT_ASSISTANT.md`。

- `src/lib/server/hotspots.ts` 读取结构化证据并调用模型。
- `src/lib/server/hotspot-snapshots.ts` 负责最新快照读取、范围校验与追加写入。
- `src/lib/server/market-briefing.ts` 通过 `DATA` Service Binding 分别从 `/data/stock-summary`、`/data/news` 和新闻详情取材；新闻详情保持最多 5 个并发，在 Dashboard Worker 组装提示词并生成今日聚焦。
- `src/lib/server/market-report.ts` 负责完整定稿的按日 R2 读取与手动覆盖，读取和写入都经同一快照 Schema 校验，不查询 Data API。
- `src/lib/server/data-news.ts` 通过 `DATA` Service Binding 有界读取并校验单篇研报正文，供研报详情和政策点评生成复用。
- `src/lib/server/ai-gateway.ts` 是生成式模型唯一适配器，使用 provider-specific Responses API 固定调用 `custom-codex`；可重试失败时仅重试同一 Provider 一次，授信问答保持单次尝试。
- `src/lib/server/bond-ledger.ts` 处理台账请求、R2、Workflow 与下载边界。
- `src/lib/server/profile.ts` 使用已验证 Access JWT 的 `eastmoney_user_id` 定位 Auth0 账号；个人信息 `/profile` 与 `/api/profile` 不依赖融资业务人员关联，不读写 Neon `financing`。权限仅展示 Auth0 已分配值，实际融资授权继续由融资工作台判断。
- `src/lib/server/fund-report.ts` 校验并归档资金日报 HTML，枚举固定前缀生成历史列表，并按确定性的日期 key 从 R2 读取单期日报。
- `src/lib/server/bond-ledger-repository.ts` 封装 `bond` schema SQL；`src/lib/server/postgres.ts` 管理短生命周期连接。
- `src/lib/server/credit-repository.ts` 封装 `credit` schema 的报表日导入、机构自动保存、历史日期读取、日历事件和相邻报告日比较；Worker 复用短生命周期 PostgreSQL 连接。
- `src/lib/server/financing-model-repository.ts` 从 `model_run` 结构化列及有序明细表重建 quant 快照，增量更新同一运行的当前整体结论，并追加卖方观点和逻辑汇总修订；`src/lib/server/financing-model-research.ts` 按 `AI.md` 调用 AI Search MCP，再通过统一 AI Gateway 生成结构化卖方逻辑汇总。

## 核心数据流

### 交易研究工作台

授信链路：本地 Excel → `scripts/import-credit-workbook.ts` 解析“授信一览表”和“授信周报” → Neon `credit.institution` / `credit.item`；浏览器 `/trading-research/credit` → `/api/credit` → Hyperdrive → Neon。读取、周报比较、日历事件和自动保存的服务端确认结果均来自数据库。

统一 EDB 链路：Choice EDB + DM `/cfets-histories` → dashboard 首次本地全历史回填 / 每日 00:00 增量 Cron → Neon `public.edb`；浏览器 `/trading-research/research` → `/api/economic-indicators` → Hyperdrive → 最近 18 个月快照，融资工作台负债周报则由服务端经同一 Hyperdrive 读取所需年度序列。前端负责明确的展示换算、利差派生和走势图抽样，不直接调用付费或办公网上游。

交易和流程中心当前仍由冻结数据 → `src/lib/trading-research/demo-data.ts` → 对应只读视图；`/secondary-bond-pool`、`/bond` 与 `/financing-model` 的同一页面组件分别装配到工作台子路径，其中旧 `bond` 只作为隐藏深链保留。

工作台路由使用真实 path：`/trading-research`、`/trading-research/trading`、`/trading-research/credit`、`/trading-research/research`、`/trading-research/workflow`、`/trading-research/secondary-bond-pool`、`/trading-research/financing-model`。不使用 `?view=`；原 `/trading-research/bond`、`/bond` 与 `/financing-model` 保留，但旧二级池入口不显示在导航。

后续：交易与流程业务数据库 → 服务端接口 → dashboard 浏览器。浏览器不得直连数据库或研究数据上游。所有授信数据只写 `credit` schema，不交叉写入 `bond` 或 `financing_model`。

## 依赖规则

- 浏览器模块不得导入 `$lib/server` 或直接访问 D1、R2、Hyperdrive。
- 图表模块不得自行请求数据。
- 路由 handler 保持轻薄；可复用校验和业务逻辑放入 `src/lib`。
- Workflow 代码留在 `worker/`，避免 Cloudflare runtime 类型污染浏览器 TypeScript 环境。
- 新增报告口径先扩展共享派生层和测试，再接入视觉或文字消费者。

具体页面规则和接口见 [模块索引](INDEX.md)，不在公共文档重复维护。

## 融资模块合并

Dashboard 是唯一 UI/API Worker。融资领域位于 `src/lib/financing/`（浏览器安全代码）、`src/lib/server/financing/`（查询、授权、审计）、`src/routes/financing/`（路由）和 `src/charts/financing/`（报表图表）。管理页面位于 `src/routes/management/`。共享 UI 只由既有 `WorkbenchShell`、`MetricCard`、`ModuleCard`、`PanelHeading`、`ChartHost`、`GlobalMessages` 维护。

融资身份查询、提醒查询、报表生成和数据库连接均不能放进全站根 layout。仅融资业务导航执行融资授权与集合查询；重型导入解析器留在浏览器 Web Worker，报表动作客户端按路由加载。Finance 的 CSS 限定 `.financing-scope`，其颜色与表面映射 Dashboard 令牌，不能在导航后污染门户和报告。

自定义 Worker 同时导出 DebtImportWorkflow，继续使用既有 Workflow 名称和台账原子导入。两个 cron 按表达式分流；从旧 Worker 切换时停止旧 cron，防止重复扫描。迁移不会改变 Quant、Data、Ingest 或其他上游接口。
