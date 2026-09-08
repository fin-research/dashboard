# AGENTS.md

## Project Overview

债券市场研究全栈应用，提供市场点评、市场热点、二级池周报及融资业务管理。技术栈为 SvelteKit、Svelte 5、TypeScript、Tailwind CSS 4、daisyUI、ECharts、Cloudflare Workers/D1/R2/Workflows/Hyperdrive、Neon PostgreSQL 与 AI Gateway。

融资入口 `/financing`（仪表盘、负债周报、项目、SOP、台账）；管理中心 `/management`（角色权限配置）与全站个人信息 `/profile`。

页面入口、兼容路由和模块范围只在 [docs/INDEX.md](docs/INDEX.md) 维护。

## Repository Structure

- `src/routes/`：页面与 SvelteKit Worker API。
- `src/components/`、`src/lib/components/`：可复用 UI 组件。
- `src/charts/`：ECharts 配置和图表派生。
- `src/api.ts`、`src/report-view.ts`、`src/text-report.ts`：数据客户端与报告视图派生。
- `src/lib/server/`：仅服务端运行的数据访问、AI、快照和台账逻辑。
- `src/lib/bond-ledger/`：Excel 解析、校验、格式化与分析。
- `worker/`：自定义 Worker 入口和二级池导入 Workflow。
- `migrations/`：D1 migration；`postgres-migrations/`：Neon `bond` schema migration；`financing-model-migrations/`：Neon `financing_model` schema migration。
- `authorization-migrations/`：统一权限 schema migration；`scripts/apply-unified-permissions.mjs` 负责 Auth0 身份核对与跨 schema 原子迁移。
- `auth0/`：Auth0 中文主题、注册字段和登录 Actions；配置与启用顺序见 `auth0/README.md`。公开提示页先上线，注册字段须先有已验证自定义域名。
- `scripts/`：类型生成、D1 同步、Neon migration 与台账回填。
- `tests/`：Node 单元与契约测试，融资原有回归位于 `tests/financing/`。
- `financing-migrations/`、`scripts/financing/`：融资 schema migration 与本地维护命令；原 Excel 与凭证不迁入 Git。

## Mandatory Rules

- 修改前先搜索现有页面、组件、图表、派生函数和测试；优先复用，不建立平行实现。
- UI 变更必须读取 `DESIGN.md`；保持既有桌面布局和移动端模块顺序，不自行引入新设计体系。
- 跨服务路由、DATA / InternalData 与身份所有权遵循 [共享架构](../eastmoney/docs/ARCHITECTURE.md)；只改页面时按模块索引读取，不预读其他仓库。
- 市场点评 REST 编排与视觉/文字共用契约、旧资源兼容边界见 [市场点评模块](docs/modules/market-briefing.md)；业务加工留在 Dashboard。
- Data 消费端使用 `src/data-contracts.ts` 的 Zod Schema 校验最小 DTO；字段投影与分页遵循 [Data API 契约](../data/docs/API.md)，不透传上游 envelope。债券动态代码与类型筛选见市场点评模块。
- 新闻详情扇出保持有界并发，复用 `src/lib/server/data-news.ts` 和既有 DATA adapter。
- 身份只使用 `locals.user`，权限只使用统一入口的 `user.authorization`；业务不得另建身份或授权系统。精确认证、路由豁免、失败关闭与模式规则见 [SECURITY](docs/SECURITY.md)。
- 一级发行视觉与文字输出必须共用 `src/primary-issues.ts`；文字报告不得读取 Python 归档文本。
- 热点首次访问只读最近成功快照；只有用户手动生成才调用模型并追加 `hotspot_snapshot`。旧快照的证据范围以快照自身为准。
- 二级池原始 Excel 先写 R2，再由 Workflow 解析并通过 Hyperdrive 写入 Neon；页面和浏览器不得解析 Excel 或缓存完整台账。
- D1/Neon/R2 所有权及跨仓库 migration 协同遵循 [共享数据库](../eastmoney/docs/DATABASE.md)；本地连接、日期和导入一致性遵循 [DATABASE](docs/DATABASE.md)。
- 生成式 AI 仅通过 `src/lib/server/ai-gateway.ts`；传输、重试与检索遵循 [共享 AI](../eastmoney/docs/AI.md)，业务 Prompt、Schema 和例外留在目标模块。
- 融资模型的 Quant / Dashboard 写入分工见 [共享数据库](../eastmoney/docs/DATABASE.md#融资模型跨仓库写入)，页面契约见 [融资模型模块](docs/modules/financing-model.md)。
- 卖方观点使用研究库检索，授信问答使用独立授信材料库；不得跨用其证据来源和权限。具体检索分别见融资模型模块与 [授信问答](docs/CREDIT_ASSISTANT.md)。
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
- 权限 migration：`pnpm auth:db:migrate` 默认只读盘点；显式 `--apply` 才执行，替换账号需提供经确认的 `--person-map` JSON。
- Neon migration：`pnpm bond:db:migrate`
- 融资择时 Neon migration：`pnpm financing-model:db:migrate`
- 台账回填盘点：`pnpm bond:db:backfill`；只有显式增加 `--apply` 才写入
- 部署：验证通过后推送 GitHub `main`，由 Cloudflare Git 自动构建部署；必要时可执行 `pnpm worker:deploy` 手动部署。两种方式均无需再次向用户申请授权；部署后核对线上版本和受影响路由。

## Context Routing

跨项目执行与并行工作树规则见 [项目组 AGENTS](../eastmoney/AGENTS.md)；未在上下文中时读取一次。只加载任务相关文档，跨模块仅加读受影响部分，不重复读取已有上下文。

- 页面、API、业务或定时任务：先按 [docs/INDEX.md](docs/INDEX.md) 定位唯一模块文档与代码，再按任务叠加专题。
- UI、组件、图表、响应式、打印：加读 [DESIGN](DESIGN.md)。
- 本仓库分层：加读 [ARCHITECTURE](docs/ARCHITECTURE.md)；只有跨服务变化才加读共享架构。
- SQL、日期、事务和导入：加读 [DATABASE](docs/DATABASE.md)；共享表/存储归属变化才加读共享数据库。
- API / actions：加读 [API](docs/API.md)；身份与权限：加读 [SECURITY](docs/SECURITY.md)。
- 测试、开发和交付：加读 [DEVELOPMENT](docs/DEVELOPMENT.md)。
- AI 调用：加读 [共享 AI](../eastmoney/docs/AI.md) 与模块 Prompt/Schema；授信问答 `credit_answer` 例外由 [CREDIT_ASSISTANT](docs/CREDIT_ASSISTANT.md) 维护。

融资和管理功能不读取旧 Financing 文档作为当前规范。共享文档总入口为 [项目组索引](../eastmoney/docs/INDEX.md)。
