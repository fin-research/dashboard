# AGENTS.md

## 项目简介

债券市场可视化研究报告全栈应用。技术栈：SvelteKit + Svelte 5 + TypeScript + daisyUI（Tailwind CSS 4）+ Cloudflare Workers/D1/R2/Workflows/Hyperdrive + Neon PostgreSQL + AI Gateway + pnpm。

## 数据来源

本项目仍依赖线上 Python 数据服务。浏览器统一请求同源 `/data/*`：本地开发由 Vite 按 `.env.dev` 的 `DATA_PROXY_TARGET` 转发到 `https://eastmoney.hasbai.xyz`，完整保留 `/data` 前缀；线上 Dashboard Worker 不接管 `/data/*`，浏览器直接访问同域数据服务。

调用端点：

- `GET /data/config`：获取报告配置
- `GET /data/report?date=YYYY-MM-DD[&refresh=1]`：获取指定日期的统一报告数据。每个区块都是完整版原始行：`omo`（窗口原始行）、`rates`（dr/dibo/bonds/futures）、`stock_paragraphs`、`margin`（原始行）、`primary`/`inventory`（原始行 + 视觉派生列）、`secondary`（原始行）；视觉与文字版共用同一份字段，前端按需派生
- `GET /api/rag/hotspots`：只读取最近一次成功生成的热点快照，不接收范围参数、不调用模型
- `POST /api/rag/hotspots`：按 JSON 请求体中的证据范围手动生成并追加快照；滚动范围为 `{"mode":"rolling","rollingCount":20}`，日期范围为 `{"mode":"range","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}`
- `POST /api/market-briefing?date=YYYY-MM-DD`：今日聚焦生成（Worker 路由）。Worker 先从后端 `/data/market-briefing/news` 取当日新闻素材，再通过 AI Gateway `compat/chat/completions`（`AI_GATEWAY_ID=default`）调用 `dynamic/rag`；系统提示为 `src/lib/server/market-briefing.ts` 内嵌的 market-briefing skill 全文，用户提示与旧版后端 Codex 生成逐字一致
- `/api/bond-ledger`：二级池周报数据库与台账管理接口。无参数 `GET` 从 Neon `bond.daily_position` 列出数据库实际存在的报表日，并从 `bond.ledger_upload` 补充原始文件管理信息；`GET ?start&end` 从 `bond` schema 读取并在 Worker 服务端计算周报；`GET ?date` 按数据库记录的 R2 key 下载原始 Excel；`GET ?workflow` 查询导入 Workflow；`POST` 先把 Excel 流式写入不可变 R2 key，再返回 202 并启动 `BondLedgerImportWorkflow`；`DELETE ?date` 删除该报表日三张业务表中的数据并保留 R2 原始归档。本地 `pnpm dev` 将该路径代理到 `DATA_PROXY_TARGET`，不使用浏览器存储。

本地开发直接运行 `pnpm dev`，不需要先启动仓库内的 Python API，也不会自动同步远程 D1。

## 常用命令

- `pnpm install`：安装依赖
- `pnpm dev`：以 `dev` mode 读取 `.env.dev` 并直接启动开发服务器（127.0.0.1:8765，访问入口 `http://127.0.0.1:8765/`）；不同步远程数据库
- `pnpm build`：类型检查 + SvelteKit Cloudflare 生产构建
- `pnpm test`：运行单元测试（node --test，`tests/*.test.mjs`）
- `pnpm typecheck`：svelte-check 类型检查
- `pnpm worker:dev`：构建后使用 Wrangler 在本地运行 Cloudflare Worker
- `pnpm worker:deploy`：构建并部署 `eastmoney-dashboard` Worker
- `pnpm exec wrangler secret put CF_AIG_TOKEN`：交互式配置生产 AI Gateway 认证 Secret；不得把值写入命令、源码或配置文件
- `pnpm worker:typegen`：根据 `wrangler.jsonc` 更新 Worker 绑定类型
- `pnpm bond:db:migrate`：使用 `DATABASE_URL` 直连 Neon，应用 `postgres-migrations/` 中的 `bond` schema 迁移
- `pnpm bond:db:backfill`：只读下载既有线上台账并校验 Excel；增加 `--apply` 且配置 `DATABASE_URL` 后才写入 Neon
- `pnpm db:sync:remote`：仅在明确需要时手动运行；按本地最新 `updated_at` / `generated_at` 只读查询远程 D1，增量 upsert `article`、`keyword`、`hotspot_snapshot`；空库首次只建立最近 100 篇已完成特征抽取文章的有限基线，不读取全库
- `pnpm db:migrate:local` / `pnpm db:migrate:remote`：应用热点缓存表迁移

## 目录结构

- `src/App.svelte`：既有报告页面布局与数据装配
- `src/routes/`：SvelteKit 门户、市场点评、市场热点、二级池周报页面和应用 API
- `src/lib/server/hotspots.ts`：D1 证据读取、AI Gateway 聚合与缓存
- `src/lib/server/hotspot-snapshots.ts`：最近热点快照读取、完整范围校验与追加写入
- `src/lib/server/market-briefing.ts`：今日聚焦生成（后端取数 + `dynamic/rag` 经 AI Gateway 调用，提示词逐字复刻旧版 Codex 流程）
- `src/lib/bond-ledger/`：二级池 Excel 解析、线上数据库客户端和周报分析；浏览器不得解析 Excel 或缓存完整台账。
- `src/lib/server/bond-ledger.ts`：R2 流式上传、Workflow 启动/状态、原始文件下载和请求校验边界。
- `worker/bond-ledger-workflow.ts`：从 R2 读取 Excel、Worker 内解析并触发 Neon 原子更新的 Cloudflare Workflow；放在 SvelteKit `src` 之外，避免 Worker runtime 类型污染浏览器 DOM 类型检查。
- `src/lib/server/bond-ledger-repository.ts`：`bond` schema 的批量写入、成交派生、台账清单和周报数据库查询。
- `postgres-migrations/`：Neon PostgreSQL 的 `bond` schema DDL；不得放入 D1 的 `migrations/`。
- `src/lib/server/ai-gateway.ts`：基于 AI SDK 的统一 OpenAI-compatible Gateway 适配器，负责认证、参数白名单、响应限长、协议归一和结构化输出校验
- `src/routes/api/market-briefing/+server.ts`：`/api/market-briefing` Worker 路由（日期解析、错误映射 400/502/503/504）
- `src/lib/components/WordCloud.svelte`：可点击、可键盘操作的 SVG 词云
- `src/components/`：UI 组件（表格、指标卡片、摘要条、聚焦编辑器等）
- `src/charts/`：ECharts 图表构建模块（信用、权益、流动性等）
- `src/view-model.ts`：报告数据 → 视图模型的转换层
- `src/export.ts`：导出功能（基于 html-to-image）
- `src/api.ts`：浏览器数据客户端（只请求同源 `/data/*`）
- `src/rows.ts`：共享的行解析 helper（`number`/`string`/`secondaryTenorYears`/`isPublicBond` 等），文字版复刻与视觉派生共用
- `src/report-view.ts`：从统一 `/data/report` 原始行派生视觉视图（OMO 日净额、资金面/国债指标、融资融券快照、一级发行点、可比债券含 Theil-Sen/MAD 离群过滤、存量债点）
- `src/primary-issues.ts`：可视化与文字版共用的一级发行细项派生；仅消费 API 返回的报告日与上一交易日行，按日期、类型、发行人合并期限/票息并统一格式
- `tests/`：单元测试（纯 TS 逻辑的 node:test 测试）

## 注意事项

- 门户页固定为 `/`；页面路由为 `/market-briefing`、`/market-briefing/text`、`/market-hotspots` 和 `/bond`（旧 `/bond-ledger` 仅保留 308 兼容跳转）。应用 API 位于 `/api/*`。 Python 数据接口为 `/data/*`，该路径只在本地由 Vite 代理，线上不得经过 SvelteKit 后端。
- 二级池周报生产数据位于 Neon `bond` schema，Worker 只通过 Cloudflare `HYPERDRIVE` binding（配置名 `eastmoney`）连接；每次请求或 Workflow step 新建并关闭一个 `pg.Client`，不得跨请求复用连接。原始 Excel 先进入 R2 `BOND_LEDGER`，再由 Workflow 解析；页面不得下载 Excel 做计算。
- `bond.daily_statistics` 对应 Sheet1，`bond.daily_position` 对应 Sheet2，`bond.transaction_record` 必须由持仓的买量、卖量和到期量派生。导入使用全局导入锁加同日报表 advisory lock、单事务替换持仓/成交及幂等统计 upsert；旧报表不得覆盖由更新报表写入的历史统计。
- D1 固定绑定现有 `eastmoney` 数据库，文章正文仍不得写入 D1；热点聚合只读取 `article.summary`、`importance` 和 `keyword` 结构化证据。每次手动生成都向 `hotspot_snapshot` 追加完整响应、已解析证据范围和输入指纹；首次访问只取最近快照，UI 范围必须由该快照响应回填，不得按当前参数或当前证据重新解释旧响应。
- 所有模型调用只通过 `src/lib/server/ai-gateway.ts`，经 `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/compat/chat/completions` 走 `dynamic/rag`。生产认证只允许使用 Worker Secret `CF_AIG_TOKEN`，账户 ID 与 Gateway ID 分别使用非敏感变量 `CLOUDFLARE_ACCOUNT_ID`、`AI_GATEWAY_ID`；不得把 token 写入源码或 `wrangler.jsonc`。结构化调用用一个 Zod Schema 自动生成标准 `response_format.json_schema`，由 AI SDK 校验结果，Prompt 不重复手写结构。热点聚合保持 `enable_thinking=true`（`reasoning_effort=low`，不设置 completion token 上限）；单来源热点热度不超过 60。统一参数和调用方式以根目录 `README.md` 为准。
- 热点输出固定为 8–15 个；默认跨日期滚动读取最近 20 篇已完成特征抽取的文章，日期范围模式最多读取最近 100 篇。热点热度由模型直接给出 0-100 分，权重公式仅作为提示，应用不自行计算加权得分，只做范围校验与单来源封顶。
- 文字版直接消费 `/data/report` 顶层完整字段（OMO 按报告日过滤 `operationDate`），由 `src/text-report.ts` 严格复刻 `api/scripts/report_cli.py` 的筛选、排序、条件分支、数字格式与完整文本；一级发行必须与可视化共用 `src/primary-issues.ts`，不得形成平行口径；不得直接读取 Python 生成的报告文本。
- 端口约定：前端 8765，API 8766，均绑定 127.0.0.1。
- `pnpm dev` 不得同步远程 D1；只有在明确需要刷新本地热点证据时，才手动运行 `pnpm db:sync:remote`。需要本地调用模型时，从 `.dev.vars.example` 创建未纳入版本控制的 `.dev.vars` 并配置 `CF_AIG_TOKEN`；请求在本地 D1 上执行，AI Gateway 调用仍会产生费用。
- 本项目不做浏览器或截图视觉检查；验证只运行类型检查、单元测试、构建、dry-run 与必要的接口请求。
- 提交前请确保 `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
