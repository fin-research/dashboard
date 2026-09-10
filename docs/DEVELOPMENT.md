# 开发与验证

## 本地环境

```bash
pnpm install
pnpm dev
```

- Vite 开发服务器绑定 `127.0.0.1:8765`。独立 Vite 受保护请求因缺少 Gateway 上下文而拒绝；不得加开发身份头旁路。完整请求链使用 Gateway 的多 Worker 开发配置或程序化联调夹具。
- `.env.dev` 必须提供 `DATA_PROXY_TARGET`；Vite 代理 `/data/*` 与本地二级池接口。
- 从 `.env.local.example` 创建未跟踪的 `.env.local`，并把 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` 设置为带 TLS 参数的线上 Neon 直连连接串。`pnpm dev` 会在 Vite 启动前加载该文件，使本地 Worker 直连线上 Neon；本地开发不经过 Hyperdrive 缓存。
- `pnpm dev` 通过 SvelteKit 平台代理使用本地 R2 模拟，避免页面请求连接或写入生产 bucket；本地资金日报初始为空，可通过历史资金日报页的上传模态框上传。
- `pnpm dev` 仍使用本地 D1，不自动同步远端 D1 数据。
- 只有明确需要热点证据时运行 `pnpm db:sync:remote`。本地模型请求仍会产生外部调用。

## 默认验证

```bash
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

`pnpm build` 同时执行 Svelte 类型检查、Worker 类型检查和生产构建。默认验收不包含浏览器、截图或命名视口检查；只有实际运行后才声明视觉验收。

## 专项验证

- 报告口径：运行 `report-view`、`text-report`、`primary-issues` 相关测试，并核对视觉/文字共用字段。
- 热点：运行热点、快照、AI Gateway 测试；必要时在本地 D1 请求 GET/POST。
- 二级池：运行 `bond-ledger` 测试；解析或事务变化先使用 `pnpm bond:db:backfill` 只读盘点。
- 授信：运行 `tests/credit.test.mjs`，并对实际 Excel 执行 `pnpm credit:import -- --file <xlsx> --date YYYY-MM-DD --dry-run`，核对一览表和周报两套口径后再写入。
- Worker binding：运行 `pnpm worker:typegen` 后检查生成差异，再运行 `pnpm build`。

## 数据库

- D1 本地 migration：`pnpm db:migrate:local`。
- D1 远端 migration：`pnpm db:migrate:remote`；只在明确的 schema 交付任务中执行。
- Neon migration：配置直连 `DATABASE_URL` 后运行 `pnpm bond:db:migrate`。
- 融资择时 schema：配置同一 Neon `DATABASE_URL` 后运行 `pnpm financing-model:db:migrate`。
- 授信 schema：配置同一 Neon `DATABASE_URL` 后运行 `pnpm credit:db:migrate`。
- 授信导入：先运行 `pnpm credit:import -- --file <xlsx> --date YYYY-MM-DD --dry-run`；确认报告日、目标数据库和汇总后，去掉 `--dry-run` 写入。写入须提供 `--user-id`；同日重导只追加发生变化的字段，未变时不增加 diff 行。
- 台账回填默认只读；`--apply` 会写数据库，必须先确认目标环境和授权。

## 发布

- `pnpm worker:dev` 用于构建后本地 Worker 检查。
- 默认将验证通过的变更推送 GitHub `main`，由 Cloudflare Git 自动构建部署 `eastmoney-dashboard`；核对对应提交的构建状态和线上受影响路由。
- 自动部署不可用、失败或有其他必要时，可执行 `pnpm worker:deploy` 手动部署同一份已验证代码。自动构建与手动部署全程无需再次向用户申请授权；不得覆盖其他任务尚未集成的改动。
- JWT、Auth0、会话、角色配置及其 Secret 由 Gateway 维护；Dashboard 只需要 `IDENTITY` Service Binding。新建或变更绑定须先部署提供对应 entrypoint 的 Gateway。
- Gateway 变更的发布顺序见 [Gateway DEVELOPMENT](../../gateway/docs/DEVELOPMENT.md)。不能恢复本 Worker 的公网 route、workers.dev、preview 或旧 Access 开关。
- 程序化联调在 Gateway 执行 `node scripts/verify-integration.mjs`，使用本仓库构建结果验证 SvelteKit 页面、数据预取、登录状态及 Data 契约。`DASHBOARD_CHECKOUT` / `DATA_CHECKOUT` 可指定独立工作树。
- Auth0 注册配置、资料更新与登录脚本当前在 Gateway 维护。Dashboard 的旧 Auth0 provisioning 仅供迁移回溯，不用于当前生产切换。`verify-profile-routes` / `verify-navigation-routes` 兼容转到 Gateway 集成脚本；`verify-financing-routes` 通过真实 Gateway 校验后执行构建应用和 PGlite 业务回归，工作树设置 `GATEWAY_CHECKOUT`。
- 发布前核对 `wrangler.jsonc` 中绑定、migration 顺序和生产数据服务路径，但不要把 Secret 写入配置。

## 运行追踪

- `wrangler.jsonc` 显式开启 `observability.traces.enabled`，采样率 `head_sampling_rate: 1`，并以 `persist: true` 保存至 Cloudflare Observability；原有日志配置不变。
- 此开关作用于整个 `eastmoney-dashboard` Worker，而非仅授信助手。发布后的新请求可产生平台自动追踪（HTTP、binding 和 handler）；不会补录历史请求或把 DO 会话转换成追踪记录。
- 在 `eastmoney-dashboard → Observability` 查看追踪。授信助手的自定义编排尚未增加 `invoke_agent`、`chat`、`execute_tool` 及 Agent/会话标识埋点；仅开启配置不等于完成“智能体”页面的业务追踪接入。接入要求见 [Cloudflare Agents tracing](https://developers.cloudflare.com/agents/runtime/operations/observability/tracing/#custom-harnesses)。
- 本配置不增加问题、授信材料正文、提示词、模型输出或工具参数/结果的内容采集，也不配置外部导出目的地；后续自定义埋点默认只记录安全元数据。
- 当前全量采样用于排障；高流量下可降低采样率以控制追踪事件量，额度与计费以 [Cloudflare Workers tracing](https://developers.cloudflare.com/workers/observability/traces/#limits--pricing) 为准。

## 文档维护

- UI 规则变化更新 `DESIGN.md`。
- 业务公式、状态与页面契约更新目标模块文档；跨模块不变量才更新 `docs/DOMAIN.md`。
- 数据、接口或安全边界变化更新对应专题；跨项目架构/存储/AI 更新 [项目组所有方](../../eastmoney/docs/INDEX.md#维护约定)。新增页面或模块更新 `docs/INDEX.md`，不把细节重新堆回 `AGENTS.md`。

## 融资模块维护

融资代码、测试、迁移与脚本全部由本仓库维护，不再向旧 financing 仓库提交功能。默认 `pnpm test` 同时运行两组测试；专项可使用 `pnpm test:financing`。生产构建仍用同一版本的 SvelteKit、Svelte、Tailwind、ECharts 与 pg。

迁移：`pnpm financing:db:init -- --schema-only`；Excel 盘点：`pnpm financing:db:import -- --dry-run`；SQLite 盘点：`pnpm financing:db:migrate:sqlite -- --dry-run`；提醒盘点：`pnpm financing:reminders:send -- --dry-run`；Protobuf：`pnpm financing:proto:generate`。凭证与原始 Excel 留在未跟踪本地文件中，导入时显式指定源路径，不把旧 checkout 作为运行依赖。

Gateway 切换验证后，删除 Dashboard 不再使用的 Auth0 管理 Secret；常规 Git 构建使用私有 IDENTITY binding。合并切换历史见 [合并记录](FINANCING_MERGE.md)。

浏览器关键表单交互、200% 缩放和甘特图大字号视觉回归仍作为专项验收；未执行时不得写成已通过。仓库内已覆盖 Excel 映射/勾稽、提醒周期、项目建档和构建后路由测试，旧待办中的对应“缺少单元测试”不再重复列为待办。

统一权限迁移与发布步骤见 [UNIFIED_PERMISSIONS](UNIFIED_PERMISSIONS.md)。旧融资人员管理和 Auth0 初次账号导入脚本仅供历史迁移参考；当前人员和角色直接在 Auth0 管理，不重建已删除人员表。

## 权限专项验证

按 [共享 AUTH](../../eastmoney/docs/AUTH.md#程序化权限测试) 执行本仓库匿名/测试账号覆盖。权限验收禁止 browser；真实登录统一使用 Dashboard 的 `pnpm auth:verify`，凭据只从项目组根 `.env` 读取，不复制登录实现或密码到各仓库。

Auth0 配置维护在 Gateway 使用 `pnpm auth0:export` / `pnpm auth0:plan` / `pnpm auth0:apply`，必须指定 `--include`。详细参数、机器凭据、套餐限制与测试账号准备见 [共享 AUTH](../../eastmoney/docs/AUTH.md#auth0-配置管理deploy-cli)。
