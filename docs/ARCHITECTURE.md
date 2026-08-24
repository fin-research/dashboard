# 系统架构

## 运行单元

项目由 SvelteKit 应用和自定义 Cloudflare Worker 入口组成。`worker/entry.ts` 承载构建后的 SvelteKit Worker，并注册 `BondLedgerImportWorkflow`。静态资源由 Worker Assets 提供。

```text
Browser
├→ Svelte pages / components / charts
├→ /data/* ─────────────→ Python data service
└→ /api/* ──────────────→ SvelteKit Worker routes
                          ├→ D1
                          ├→ AI Gateway
                          ├→ R2
                          └→ Workflow → Hyperdrive → Neon bond
```

## 页面与派生层

- `src/routes/` 负责页面装配、路由参数和 HTTP 边界，不承载复杂业务计算。
- `src/App.svelte` 保留市场点评的整体报告装配。
- `src/api.ts` 只访问同源 `/data/*`。
- `src/report-view.ts`、`src/primary-issues.ts`、`src/rows.ts` 将统一报告原始行派生为视觉数据。
- `src/text-report.ts` 从同一份报告数据生成文字版，必须复用共享口径而不是建立第二套数据源。
- `src/charts/` 只负责图表配置和图形表达；业务筛选应位于视图派生层。

## 服务端模块

- `src/lib/server/hotspots.ts` 读取结构化证据并调用模型。
- `src/lib/server/hotspot-snapshots.ts` 负责最新快照读取、范围校验与追加写入。
- `src/lib/server/market-briefing.ts` 从 `/data/market-briefing/news` 取材并生成今日聚焦。
- `src/lib/server/ai-gateway.ts` 是生成式模型唯一适配器。
- `src/lib/server/bond-ledger.ts` 处理台账请求、R2、Workflow 与下载边界。
- `src/lib/server/bond-ledger-repository.ts` 封装 `bond` schema SQL；`src/lib/server/postgres.ts` 管理短生命周期连接。

## 核心数据流

### 市场点评

`/data/report` → 浏览器数据客户端 → 共享派生层 → 视觉组件 / 文字报告。前端不读取 Python 归档文本。

### 市场热点

`ingest` 写入的 D1 `article` / `keyword` → Worker 读取证据 → AI Gateway → 追加 `hotspot_snapshot` → 页面读取最近快照。

### 二级池

浏览器上传 Excel → Worker 流式写入不可变 R2 key → 创建 Workflow → Worker 内解析 → Neon 单事务更新 → 页面按日期区间查询数据库生成周报。

## 依赖规则

- 浏览器模块不得导入 `$lib/server` 或直接访问 D1、R2、Hyperdrive。
- 图表模块不得自行请求数据。
- 路由 handler 保持轻薄；可复用校验和业务逻辑放入 `src/lib`。
- Workflow 代码留在 `worker/`，避免 Cloudflare runtime 类型污染浏览器 TypeScript 环境。
- 新增报告口径先扩展共享派生层和测试，再接入视觉或文字消费者。
