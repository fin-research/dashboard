# AGENTS.md

## 项目简介

债券市场可视化研究报告前端。技术栈：Svelte 5 + TypeScript + daisyUI（Tailwind CSS 4）+ Vite + pnpm。

## 数据来源

本项目依赖一个独立的本地数据 API 服务（位于 `~/src/data`，Python 项目，默认监听 `http://127.0.0.1:8766`）。开发时前端通过 Vite proxy 把 `/api` 转发到该服务（见 `vite.config.ts`）。

调用端点：

- `GET /api/config`：获取报告配置
- `GET /api/report?date=YYYY-MM-DD[&refresh=1]`：获取指定日期的报告数据，`refresh=1` 强制刷新

开发前需先在 `~/src/data` 启动 API 服务（`uv run data-api`），再在本项目跑 `pnpm dev`。

## 常用命令

- `pnpm install`：安装依赖
- `pnpm dev`：启动开发服务器（127.0.0.1:8765）
- `pnpm build`：类型检查 + 生产构建（输出到 `dist/`）
- `pnpm test`：运行单元测试（node --test，`tests/*.test.mjs`）
- `pnpm typecheck`：svelte-check 类型检查

## 目录结构

- `src/App.svelte`：应用根组件，页面布局与数据装配
- `src/components/`：UI 组件（表格、指标卡片、摘要条、聚焦编辑器等）
- `src/charts/`：ECharts 图表构建模块（信用、权益、流动性等）
- `src/view-model.ts`：报告数据 → 视图模型的转换层
- `src/export.ts`：导出功能（基于 html-to-image）
- `src/api.ts`：API 客户端（请求 `/api/config`、`/api/report`）
- `tests/`：单元测试（纯 TS 逻辑的 node:test 测试）

## 注意事项

- 生产构建产物（`dist/`）是静态文件，**不含 Vite proxy**；部署时需与 API 服务同源（反向代理转发 `/api`），或自行在 Web 服务器上配置转发。
- 端口约定：前端 8765，API 8766，均绑定 127.0.0.1。
- 提交前请确保 `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
