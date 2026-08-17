# AGENTS.md

## 项目简介

债券市场可视化研究报告全栈应用。技术栈：SvelteKit + Svelte 5 + TypeScript + daisyUI（Tailwind CSS 4）+ Cloudflare Workers/D1/Workers AI + pnpm。

## 数据来源

本项目仍依赖线上 Python 数据服务。浏览器统一请求同源 `/data/*`：本地开发由 Vite 按 `.env.dev` 的 `DATA_PROXY_TARGET` 转发到 `https://eastmoney.hasbai.xyz`，完整保留 `/data` 前缀；线上 Dashboard Worker 不接管 `/data/*`，浏览器直接访问同域数据服务。

调用端点：

- `GET /data/config`：获取报告配置
- `GET /data/report?date=YYYY-MM-DD[&refresh=1]`：获取指定日期的统一报告数据。每个区块都是完整版原始行：`omo`（窗口原始行）、`rates`（dr/dibo/bonds/futures）、`stock_paragraphs`、`margin`（原始行）、`primary`/`inventory`（原始行 + 视觉派生列）、`secondary`（原始行）；视觉与文字版共用同一份字段，前端按需派生
- `GET /api/rag/hotspots?mode=rolling&count=20[&refresh=1]`：按最新文章数聚合热点（默认 20 篇）
- `GET /api/rag/hotspots?mode=range&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD[&refresh=1]`：按日期范围聚合热点
- `POST /api/market-briefing?date=YYYY-MM-DD`：今日聚焦生成（Worker 路由）。Worker 先从后端 `/data/market-briefing/news` 取当日新闻素材，再经 Workers AI binding 走 AI Gateway（`AI_GATEWAY_ID=default`）`dynamic/rag` 动态路由；系统提示为 `src/lib/server/market-briefing.ts` 内嵌的 market-briefing skill 全文，用户提示与旧版后端 Codex 生成逐字一致

本地开发直接运行 `pnpm dev`，不需要先启动仓库内的 Python API。

## 常用命令

- `pnpm install`：安装依赖
- `pnpm dev`：以 `dev` mode 读取 `.env.dev`，先增量同步远程 D1 的结构化文章、关键词和热点缓存，再启动开发服务器（127.0.0.1:8765，访问入口 `http://127.0.0.1:8765/dashboard/`）
- `pnpm build`：类型检查 + SvelteKit Cloudflare 生产构建
- `pnpm test`：运行单元测试（node --test，`tests/*.test.mjs`）
- `pnpm typecheck`：svelte-check 类型检查
- `pnpm worker:dev`：构建后使用 Wrangler 在本地运行 Cloudflare Worker
- `pnpm worker:deploy`：构建并部署 `eastmoney-dashboard` Worker
- `pnpm worker:typegen`：根据 `wrangler.jsonc` 更新 Worker 绑定类型
- `pnpm db:sync:remote`：按本地最新 `updated_at` / `generated_at` 只读查询远程 D1，增量 upsert `article`、`keyword`、`hotspot_cache`；空库首次只建立最近 100 篇已完成特征抽取文章的有限基线，不读取全库
- `pnpm db:migrate:local` / `pnpm db:migrate:remote`：应用热点缓存表迁移

## 目录结构

- `src/App.svelte`：既有报告页面布局与数据装配
- `src/routes/`：SvelteKit 页面和 RAG API
- `src/lib/server/hotspots.ts`：D1 证据读取、Workers AI 聚合与缓存
- `src/lib/server/market-briefing.ts`：今日聚焦生成（后端取数 + `dynamic/rag` 经 AI Gateway 调用，提示词逐字复刻旧版 Codex 流程）
- `src/routes/api/market-briefing/+server.ts`：`/api/market-briefing` Worker 路由（日期解析、错误映射 400/502/503/504）
- `src/lib/components/WordCloud.svelte`：可点击、可键盘操作的 SVG 词云
- `src/components/`：UI 组件（表格、指标卡片、摘要条、聚焦编辑器等）
- `src/charts/`：ECharts 图表构建模块（信用、权益、流动性等）
- `src/view-model.ts`：报告数据 → 视图模型的转换层
- `src/export.ts`：导出功能（基于 html-to-image）
- `src/api.ts`：浏览器数据客户端（只请求同源 `/data/*`）
- `src/rows.ts`：共享的行解析 helper（`number`/`string`/`secondaryTenorYears`/`isPublicBond` 等），文字版复刻与视觉派生共用
- `src/report-view.ts`：从统一 `/data/report` 原始行派生视觉视图（OMO 日净额、资金面/国债指标、融资融券快照、一级发行点、可比债券含 Theil-Sen/MAD 离群过滤、存量债点）
- `tests/`：单元测试（纯 TS 逻辑的 node:test 测试）

## 注意事项

- 页面路由为 `/dashboard`、`/dashboard/text` 和 `/rag/hotspots`；应用 API 为 `/api/rag/*`。旧 Python 数据接口统一映射到 `/data/*`，该路径只在本地由 Vite 代理，线上不得经过 SvelteKit 后端。
- `/api` 的其他路径仍由原 Cloudflare Tunnel 提供；Worker 只新增更具体的 `/api/rag/*` 路由，不改变 Swagger `/api/docs`。
- Worker 额外接管 `/api/market-briefing`（见 `wrangler.jsonc` routes），浏览器生成聚焦不再调用 `/data/market-briefing`；后端 `/data/market-briefing/news` 只提供素材，文本生成在 Worker 内完成。
- D1 固定绑定现有 `eastmoney` 数据库，文章正文仍不得写入 D1；热点聚合只读取 `article.summary`、`importance` 和 `keyword` 结构化证据，并把按范围键与输入指纹缓存的最终热点写入 `hotspot_cache`。
- Workers AI 固定使用 binding，不得在应用中保存或调用 Cloudflare API Token。热点聚合经 `dynamic/rag` 动态路由，通过 Cloudflare JSON Mode（response_format json_schema）直接产生结构化 JSON，应用只做同一运行时校验；单来源热点热度不超过 60。
- 热点输出固定为 8–15 个；默认跨日期滚动读取最近 20 篇已完成特征抽取的文章，日期范围模式最多读取最近 100 篇。热点热度由模型直接给出 0-100 分，权重公式仅作为提示，应用不自行计算加权得分，只做范围校验与单来源封顶。
- 文字版直接消费 `/data/report` 顶层完整字段（OMO 按报告日过滤 `operationDate`），由 `src/text-report.ts` 严格复刻 `api/scripts/report_cli.py` 的筛选、排序、条件分支、数字格式与完整文本；不得直接读取 Python 生成的报告文本，也不得自行改写既有格式。
- 端口约定：前端 8765，API 8766，均绑定 127.0.0.1。
- 本地启动前只读增量同步远程 D1 中的结构化文章、关键词和热点缓存，不清空本地库、不复制文章正文；空库首次也只读取最近 100 篇已完成特征抽取的文章。请求在本地 D1 上执行，Workers AI 仍使用远程 binding，调用可能产生费用。
- 本项目不做浏览器或截图视觉检查；验证只运行类型检查、单元测试、构建、dry-run 与必要的接口请求。
- 提交前请确保 `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
