# AGENTS.md

## 项目简介

债券市场可视化研究报告前端。技术栈：Svelte 5 + TypeScript + daisyUI（Tailwind CSS 4）+ Vite + pnpm。

## 数据来源

本项目依赖一个独立的本地数据 API 服务（位于仓库 `api/` 目录，Python 项目，默认监听 `http://127.0.0.1:8766`）。API 内部路由不带 `/api`；开发时 Vite proxy 转发并剥离 `/api`（见 `vite.config.ts`），生产环境由 Caddy 执行相同操作。

调用端点：

- `GET /api/config`：获取报告配置
- `GET /api/report?date=YYYY-MM-DD[&refresh=1]`：获取指定日期的报告数据，`refresh=1` 强制刷新

开发前需先在仓库 `api/` 目录启动 API 服务（`uv run server`），再在本项目跑 `pnpm dev`。

## 常用命令

- `pnpm install`：安装依赖
- `pnpm dev`：启动开发服务器（127.0.0.1:8765，访问入口 `http://127.0.0.1:8765/dashboard/`）
- `pnpm build`：类型检查 + 生产构建（输出到 `dist/`）
- `pnpm test`：运行单元测试（node --test，`tests/*.test.mjs`）
- `pnpm typecheck`：svelte-check 类型检查
- `pnpm worker:dev`：构建后使用 Wrangler 在本地运行 Cloudflare Worker
- `pnpm worker:deploy`：构建并部署 `eastmoney-dashboard` Worker
- `pnpm worker:typegen`：根据 `wrangler.jsonc` 更新 Worker 绑定类型

## 目录结构

- `src/App.svelte`：应用根组件，页面布局与数据装配
- `src/components/`：UI 组件（表格、指标卡片、摘要条、聚焦编辑器等）
- `src/charts/`：ECharts 图表构建模块（信用、权益、流动性等）
- `src/view-model.ts`：报告数据 → 视图模型的转换层
- `src/export.ts`：导出功能（基于 html-to-image）
- `src/api.ts`：API 客户端（请求 `/api/config`、`/api/report`）
- `tests/`：单元测试（纯 TS 逻辑的 node:test 测试）

## 注意事项

- **子路径部署**：`vite.config.ts` 中 `base` 硬编码为 `/dashboard/`，构建产物资源引用为 `/dashboard/assets/*`。生产部署时反向代理（Caddy）剥离 `/dashboard` 前缀后转发给 nginx 按根路径服务；本地开发经 Vite dev server 访问 `http://127.0.0.1:8765/dashboard/`。
- 生产构建产物（`dist/`）是静态文件，**不含 Vite proxy**；部署时需与 API 服务同源，由 Caddy 转发并剥离 `/api`。对外 Swagger 文档地址为 `/api/docs`。
- Cloudflare Worker 仅接管 `eastmoney.hasbai.xyz/dashboard` 与 `/dashboard/*`，不反代 `/api`；前端继续通过同源 `/api/*` 访问原 API 服务。
- Cloudflare 路由入口为 `/dashboard`（可视化报告）和 `/dashboard/text`（文字版报告），静态资源及 SPA 回退由 Worker 处理。原 Dockerfile、nginx 与 Caddy 部署管线保留。
- 端口约定：前端 8765，API 8766，均绑定 127.0.0.1。
- 提交前请确保 `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
