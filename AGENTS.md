# AGENTS.md

## 项目简介

债券市场可视化研究报告全栈应用。技术栈：SvelteKit + Svelte 5 + TypeScript + daisyUI（Tailwind CSS 4）+ Cloudflare Workers/D1/Workers AI + pnpm。

## 数据来源

本项目仍依赖线上 Python 数据服务。浏览器统一请求同源 `/data/*`：本地开发由 Vite 按 `.env.dev` 的 `DATA_PROXY_TARGET` 转发到 `https://eastmoney.hasbai.xyz`，完整保留 `/data` 前缀；线上 Dashboard Worker 不接管 `/data/*`，浏览器直接访问同域数据服务。

调用端点：

- `GET /data/config`：获取报告配置
- `GET /data/report?date=YYYY-MM-DD[&refresh=1]`：获取指定日期的报告数据
- `GET /api/rag/hotspots?mode=rolling&count=20[&refresh=1]`：按最新文章数聚合热点（默认 20 篇）
- `GET /api/rag/hotspots?mode=range&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD[&refresh=1]`：按日期范围聚合热点

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
- `src/lib/components/WordCloud.svelte`：可点击、可键盘操作的 SVG 词云
- `src/components/`：UI 组件（表格、指标卡片、摘要条、聚焦编辑器等）
- `src/charts/`：ECharts 图表构建模块（信用、权益、流动性等）
- `src/view-model.ts`：报告数据 → 视图模型的转换层
- `src/export.ts`：导出功能（基于 html-to-image）
- `src/api.ts`：浏览器数据客户端（只请求同源 `/data/*`）
- `tests/`：单元测试（纯 TS 逻辑的 node:test 测试）

## 注意事项

- 页面路由为 `/dashboard`、`/dashboard/text` 和 `/rag/hotspots`；应用 API 为 `/api/rag/*`。旧 Python 数据接口统一映射到 `/data/*`，该路径只在本地由 Vite 代理，线上不得经过 SvelteKit 后端。
- `/api` 的其他路径仍由原 Cloudflare Tunnel 提供；Worker 只新增更具体的 `/api/rag/*` 路由，不改变 Swagger `/api/docs`。
- D1 固定绑定现有 `eastmoney` 数据库，文章正文仍不得写入 D1；热点聚合只读取 `article.summary`、`importance` 和 `keyword` 结构化证据，并把按范围键与输入指纹缓存的最终热点写入 `hotspot_cache`。
- Workers AI 固定使用 binding，不得在应用中保存或调用 Cloudflare API Token。Gemma 4 通过强制 function calling 的 JSON Schema 产生 structured output，普通正文 JSON 只作为模型偏离工具调用时的兼容输入，两者都必须通过同一运行时校验；单来源热点热度不超过 60。
- 热点输出固定为 8–15 个；默认跨日期滚动读取最近 20 篇已完成特征抽取的文章，日期范围模式最多读取最近 100 篇。热点热度由来源覆盖度、市场影响、新鲜度、证据可信度和跨资产关联度按固定权重计算，不直接采用模型自由排序。
- 文字版通过 `/data/text-report-data` 读取结构化源数据，由 `src/text-report.ts` 严格复刻 `api/scripts/report_cli.py` 的筛选、排序、条件分支、数字格式与完整文本；不得直接读取 Python 生成的报告文本，也不得自行改写既有格式。
- 端口约定：前端 8765，API 8766，均绑定 127.0.0.1。
- 本地启动前只读增量同步远程 D1 中的结构化文章、关键词和热点缓存，不清空本地库、不复制文章正文；空库首次也只读取最近 100 篇已完成特征抽取的文章。请求在本地 D1 上执行，Workers AI 仍使用远程 binding，调用可能产生费用。
- 本项目不做浏览器或截图视觉检查；验证只运行类型检查、单元测试、构建、dry-run 与必要的接口请求。
- 提交前请确保 `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
