# AGENTS.md

## Project Overview

债券市场研究全栈应用，提供市场点评、市场热点和二级池周报。技术栈为 SvelteKit、Svelte 5、TypeScript、Tailwind CSS 4、daisyUI、ECharts、Cloudflare Workers/D1/R2/Workflows/Hyperdrive、Neon PostgreSQL 与 AI Gateway。

运行入口：门户 `/`，资金日报 `/fund-report`，管理 `/management`，市场点评 `/market-briefing`，文字版 `/market-briefing/text`，市场热点 `/market-hotspots`，政策跟踪 `/policy-tracking`，新闻资讯 `/news/[id]`，研报详情 `/articles/[id]`，研究点评 `/commentaries/[id]`，融资择时模型 `/financing-model`，二级债券池运营周报 `/secondary-bond-pool`；旧二级池 `/bond` 作为隐藏深链保留。

## Repository Structure

- `src/routes/`：页面与 SvelteKit Worker API。
- `src/components/`、`src/lib/components/`：可复用 UI 组件。
- `src/charts/`：ECharts 配置和图表派生。
- `src/api.ts`、`src/report-view.ts`、`src/text-report.ts`：数据客户端与报告视图派生。
- `src/lib/server/`：仅服务端运行的数据访问、AI、快照和台账逻辑。
- `src/lib/bond-ledger/`：Excel 解析、校验、格式化与分析。
- `worker/`：自定义 Worker 入口和二级池导入 Workflow。
- `migrations/`：D1 migration；`postgres-migrations/`：Neon `bond` schema migration；`financing-model-migrations/`：Neon `financing_model` schema migration。
- `scripts/`：类型生成、D1 同步、Neon migration 与台账回填。
- `tests/`：Node 单元与契约测试。

## Mandatory Rules

- 修改前先搜索现有页面、组件、图表、派生函数和测试；优先复用，不建立平行实现。
- UI 变更必须读取 `DESIGN.md`；保持既有桌面布局和移动端模块顺序，不自行引入新设计体系。
- 浏览器只请求同源 `/data/*`；本地由 Vite 代理，线上 Dashboard Worker 不接管 `/data/*`。
- 市场点评由浏览器直接请求 Data Worker 的单一上游映射 REST 资源，在 `src/market-report-resources.ts` 加工为视觉版与文字版共享的完整契约；Data GraphQL 仅是同资源薄镜像，不作为整份报告主链路。不得请求 `/data/market-report/*`，不得经过 Dashboard Worker 聚合，也不得新增 GraphQL 市场报告业务字段。
- Data REST 列表按顶层 JSON array 消费，每次请求必须用 `fields` 只选择实际使用字段，并以 `src/data-contracts.ts` 的 Zod Schema 校验响应。债券基础信息代码只能从当次成交与收藏报价动态派生，不得硬编码债券清单；公募公司债筛选使用结构化 `bondType` 与 `bondOfferingType`，不得按名称字母猜测。
- Dashboard Worker 服务端访问 Data Worker 必须优先使用 `DATA` Service Binding；不得从同一 Cloudflare zone 通过全局公网 `fetch` 回环。新闻详情扇出必须保持有界并发。
- 一级发行视觉与文字输出必须共用 `src/primary-issues.ts`；文字报告不得读取 Python 归档文本。
- 热点首次访问只读最近成功快照；只有用户手动生成才调用模型并追加 `hotspot_snapshot`。旧快照的证据范围以快照自身为准。
- 二级池原始 Excel 先写 R2，再由 Workflow 解析并通过 Hyperdrive 写入 Neon；页面和浏览器不得解析 Excel 或缓存完整台账。
- D1 与 Neon migration 必须放入各自目录，不得混用。结构变化时检查写入方、读取方和回填脚本。
- 所有生成式 AI 调用只通过 `src/lib/server/ai-gateway.ts` 使用 provider-specific AI Gateway URL；默认按项目组 `AI.md` 依次调用 `custom-opencode/responses` 和 `custom-codex/responses`，不得使用会进入 Universal 适配层的 AI binding `run()`。Schema 由 Zod 定义并在应用端校验，Gateway 鉴权只使用 Worker Secret `CF_AIG_TOKEN`，Provider 密钥由 Gateway BYOK `default` alias 管理。
- 融资择时模型字段及其有序明细只由 quant pipeline 追加；dashboard 只增量更新 `model_run` 当前整体结论并追加 AI Search 卖方观点快照，不修改模型基础结论或其他模型字段。
- 融资择时卖方观点固定调用 `https://search.hasbai.xyz/mcp` 的 `search` 工具，检索参数和日期硬过滤遵循项目组 `AI.md`，不得读取 quant 旧 R2 研报脚本。
- 不手动编辑生成文件 `worker-configuration.d.ts`；绑定变化使用 `pnpm worker:typegen`。
- `pnpm dev` 不自动同步远程 D1。只有任务明确需要本地证据时才运行 `pnpm db:sync:remote`。
- 保留用户已有改动，不做无关重构，不通过删除测试或关闭检查掩盖错误。
- 默认验收为 `pnpm typecheck`、`pnpm test`、`pnpm build`、`git diff --check`。未实际执行浏览器或截图检查时，不得声明视觉验收通过。

## Commands

- 安装：`pnpm install`
- 开发：`pnpm dev`
- 类型检查：`pnpm typecheck`
- 单元测试：`pnpm test`
- 生产构建：`pnpm build`
- Worker 本地运行：`pnpm worker:dev`
- Worker 类型：`pnpm worker:typegen`
- D1 migration：`pnpm db:migrate:local` / `pnpm db:migrate:remote`
- 显式同步远程 D1：`pnpm db:sync:remote`
- Neon migration：`pnpm bond:db:migrate`
- 融资择时 Neon migration：`pnpm financing-model:db:migrate`
- 台账回填盘点：`pnpm bond:db:backfill`；只有显式增加 `--apply` 才写入
- 部署：`pnpm worker:deploy`；仅在用户明确授权部署时执行

## Context Routing

不要默认读取全部文档。按任务选择：

- UI、页面、组件、图表、响应式、导出 → `DESIGN.md`
- 系统分层、数据流、模块依赖、新功能放置 → `docs/ARCHITECTURE.md`
- 报告口径、热点、二级池业务规则 → `docs/DOMAIN.md`
- D1、Neon、R2、migration、导入一致性 → `docs/DATABASE.md`
- `/data/*` 或 `/api/*` 契约、状态码、参数 → `docs/API.md`
- Secret、服务端边界、同源校验、日志 → `docs/SECURITY.md`
- 本地环境、测试、构建、调试、发布 → `docs/DEVELOPMENT.md`

Do not load all documentation by default. Read only documentation relevant to the current task. If multiple areas are affected, read only the corresponding documents. Do not repeatedly read documents already available in the current context unless necessary.
