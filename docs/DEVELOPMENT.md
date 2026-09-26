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

## 默认验证与合并

本地负责快速反馈，GitHub Actions 负责完整合并验收。使用与 CI 一致的 Node 24 和仓库 `packageManager` 指定的 pnpm；推送前必须运行 `pnpm check:quick`，依次检查差异、Svelte/应用类型和 Worker 类型。逻辑变更或缺陷修复还须运行直接相关的轻量单元测试，例如 `node --test tests/market-briefing-workflow.test.mjs`；同一份改动已有通过结果时不重复运行。纯文档修改只需 `git diff --check`。

本地默认不重复全量覆盖率、浏览器截图或生产构建；排障需要时可以运行，无需额外申请。`pnpm build` 仍包含两类类型检查，已经对同一份改动成功构建时无需另跑类型检查。`check:quick` 不连接业务数据库、不调用线上服务；SvelteKit 类型同步会写入本地生成目录 `.svelte-kit`。本地检查通过后才进入以下流程，不能用本地结果替代 CI。

1. 主代理修改代码并划定本任务文件，每次派一个新的子代理负责提交、推送任务分支和创建/更新 PR；禁止直接推送 `main`。有意视觉变化先生成、审阅并提交候选截图，再入队。
2. 普通分支 push 不运行 CI；PR 创建/更新仅执行轻量入队门禁，核对线上已强制启用 merge queue 和 GitHub Actions 来源的 `Dashboard CI`。PR 上的绿色门禁只表示可以入队，不能报告为测试通过。草稿 PR 也不跑全量验收。
3. 准备合并时使用 `gh pr merge <number> --auto` 加入 GitHub 合并队列（禁止 `--admin`）；完整 `.github/workflows/tests.yml` 只在 `merge_group` 上自动执行，手动 `workflow_dispatch` 留作排障。队列用最新 main 加上待合并改动生成独立提交；无需为其它 PR 先合并反复更新任务分支。真实 Git/视觉冲突仍须修复，禁止直接覆盖其它任务截图。
4. 全量检查分为并行的两项：Python 与 Node 完整覆盖率；CI 工具/视觉覆盖门禁、类型检查、生产构建、复用生产 CSS 的浏览器构建及严格截图/交互比较。最后统一 `Dashboard CI` 要求两项均成功，失败、取消、跳过和缺失结果都拒绝合并。保留完整测试范围与截图容差，不按文件路径跳过。
5. `main` ruleset 同时要求 PR、merge queue 和 GitHub Actions 来源的 `Dashboard CI`；无人工审批要求、无管理员或应用 bypass，禁止删除/强推。队列一次构建/合并一个 PR，避免前序失败引发多个推测合并组重建；不要求作者分支追平 main，最新 main 的兼容性由队列检查保证。配置源 `.github/main-ruleset.json` 必须通过 rulesets API 应用并读回核验；不能只改文件，不能在未启用队列时使用轻量 PR 门禁。
6. 按 [CI 等待与收尾](TESTING.md#ci-等待与收尾2026-09-20) 使用 `scripts/wait-ci.mjs`，单个子代理只等待一次对应 `merge_group` 的完整检查并确认队列完成合并，记录 PR head、合并组 SHA、运行链接、合并提交和 Cloudflare 构建状态。被移出队列、取消、失败或仍在运行均不是交付成功；主代理根据证据修复，再派新的子代理处理。合并后的 main 不重复跑测试、覆盖率或截图；Cloudflare Git 仍负责生产部署。CI 成功不代表生产鉴权或全部路由 E2E 已验收。

pnpm 下载缓存和按 OS/架构/Playwright 版本固定的 Chromium 缓存由 `.github/actions/setup-ci` 共用，依赖安装仍为 frozen lockfile，浏览器安装命令仍核对缺失文件。PR/合并组缓存受 GitHub ref 作用域限制，不能作为其它任务的公共缓存；因此 `dependency-cache.yml` 仅在 main 的依赖/缓存配置变化时预热可共享的默认分支缓存，不执行测试或构建。Python uv 缓存依赖键使用实际声明 PEP 723 依赖的 `tests/test_credit_materials.py`。不缓存构建产物、截图基线、实际截图或测试通过结论。

截图基线、覆盖范围与候选生成规则见 [TESTING](TESTING.md)。`Visual baseline candidates` 只生成待审候选，不能替代 `Dashboard CI`。

## 专项验证

下列轻量测试可在本地按改动范围先运行，完整测试集仍由 CI 执行；涉及真实数据、权限或线上服务的专项验证按任务单独安排，不因常规 CI 通过而省略或声称通过。

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
- 授信 schema：配置同一 Neon `DATABASE_URL` 后运行 `pnpm credit:db:migrate`。`0009` 依赖融资 `0034_bond_investors.sql`，须先应用融资 migration，并先在生产副本分支核对逐期债券真实值与其它合并结果。
- 授信导入：先运行 `pnpm credit:import -- --file <xlsx> --date YYYY-MM-DD --dry-run`；确认报告日、目标数据库和汇总后，去掉 `--dry-run` 写入。写入须提供 `--user-id`；同日重导只追加发生变化的字段，未变时不增加 diff 行。
- 台账回填默认只读；`--apply` 会写数据库，必须先确认目标环境和授权。

## 发布

- `pnpm worker:dev` 用于构建后本地 Worker 检查。
- 默认将 PR 加入合并队列，队列完整 CI 成功后自动合并到 GitHub `main`，由 Cloudflare Git 自动构建部署 `eastmoney-dashboard`；核对对应提交的构建状态和线上受影响路由。
- 自动部署不可用、失败或有其他必要时，可执行 `pnpm worker:deploy` 手动部署同一份已验证代码。自动构建与手动部署全程无需再次向用户申请授权；不得覆盖其他任务尚未集成的改动。
- JWT、Auth0、会话、角色配置及其 Secret 由 Gateway 维护；Dashboard 只需要 `IDENTITY` Service Binding。新建或变更绑定须先部署提供对应 entrypoint 的 Gateway。
- Gateway 变更的发布顺序见 [Gateway DEVELOPMENT](../../gateway/docs/DEVELOPMENT.md)。不能恢复本 Worker 的公网 route、workers.dev、preview 或旧 Access 开关。
- 程序化联调在 Gateway 执行 `node scripts/verify-integration.mjs`，使用本仓库构建结果验证 SvelteKit 页面、数据预取、登录状态及 Data 契约。`DASHBOARD_CHECKOUT` / `DATA_CHECKOUT` 可指定独立工作树。
- Auth0 注册配置、资料更新与登录脚本当前在 Gateway 维护。Dashboard 的旧 Auth0 provisioning 仅供迁移回溯，不用于当前生产切换。`verify-profile-routes` / `verify-navigation-routes` 兼容转到 Gateway 集成脚本；`verify-financing-routes` 通过真实 Gateway 校验后执行构建应用和 PGlite 业务回归，工作树设置 `GATEWAY_CHECKOUT`。
- 发布前核对 `wrangler.jsonc` 中绑定、migration 顺序和生产数据服务路径，但不要把 Secret 写入配置。

## 运行追踪

- `wrangler.jsonc` 显式开启 `observability.traces.enabled`，采样率 `head_sampling_rate: 0.1`，并以 `persist: true` 保存至 Cloudflare Observability；日志仍为全量采样，保留失败诊断。
- 此开关作用于整个 `eastmoney-dashboard` Worker，而非仅授信助手。发布后的新请求可产生平台自动追踪（HTTP、binding 和 handler）；不会补录历史请求或把 DO 会话转换成追踪记录。
- 在 `eastmoney-dashboard → Observability` 查看平台追踪；授信助手按 [Cloudflare Agents tracing](https://developers.cloudflare.com/agents/runtime/operations/observability/tracing/#custom-harnesses) 记录 `invoke_agent`、`chat`、`execute_tool` 与 Agent/会话标识，不记录问题或检索正文。
- 追踪不增加问题、授信材料正文、提示词、模型输出或工具参数/结果的内容采集，也不配置外部导出目的地；自定义埋点只记录安全元数据。
- 日常追踪采用 10% 头部采样；专项排障可临时恢复全量并在完成后回调。抽样不保证每次问答都有追踪，不能替代日志和业务状态。额度与计费以 [Cloudflare Workers tracing](https://developers.cloudflare.com/workers/observability/traces/#limits--pricing) 为准。

## 云资源审计

[2026-09-21 审计](operations/cloud-resource-audit-2026-09-21.md) 记录 Neon、Workers、D1、R2、Hyperdrive、Queue、Workflow、AI Gateway 和构建用量、数据可见性与优化证据。`scripts/audit-cloud-resources.mjs --help` 提供只读的聚合指标采集命令；使用有 Analytics Read 权限的令牌，输出不包含消息、用户资料或凭据。空数据、无权限和账单不可用必须分别记录，不能视为零消耗。

## 文档维护

- UI 规则变化更新 `DESIGN.md`。
- 业务公式、状态与页面契约更新目标模块文档；跨模块不变量才更新 `docs/DOMAIN.md`。
- 数据、接口或安全边界变化更新对应专题；跨项目架构/存储/AI 更新 [项目组共享专题](../../eastmoney/AGENTS.md#context-routing)。新增页面或模块在 `AGENTS.md` 登记文档入口，模块细节仍归模块文档。

## 融资模块维护

融资代码、测试、迁移与脚本全部由本仓库维护，不再向旧 financing 仓库提交功能。默认 `pnpm test` 同时运行两组测试；专项可使用 `pnpm test:financing`。生产构建仍用同一版本的 SvelteKit、Svelte、Tailwind、ECharts 与 pg。

迁移：`pnpm financing:db:init -- --schema-only`；Excel 盘点：`pnpm financing:db:import -- --dry-run`；SQLite 盘点：`pnpm financing:db:migrate:sqlite -- --dry-run`；提醒盘点：`pnpm financing:reminders:send -- --dry-run`。凭证与原始 Excel 留在未跟踪本地文件中，导入时显式指定源路径，不把旧 checkout 作为运行依赖。

Gateway 切换验证后，删除 Dashboard 不再使用的 Auth0 管理 Secret；常规 Git 构建使用私有 IDENTITY binding。合并切换历史见 [合并记录](FINANCING_MERGE.md)。

浏览器关键表单交互、200% 缩放和甘特图大字号视觉回归仍作为专项验收；未执行时不得写成已通过。仓库内已覆盖 Excel 映射/勾稽、提醒周期、项目建档和构建后路由测试，旧待办中的对应“缺少单元测试”不再重复列为待办。

统一权限迁移与发布步骤见 [UNIFIED_PERMISSIONS](UNIFIED_PERMISSIONS.md)。旧融资人员管理和 Auth0 初次账号导入脚本仅供历史迁移参考；当前人员和角色直接在 Auth0 管理，不重建已删除人员表。

## 权限专项验证

按 [共享 AUTH](../../eastmoney/docs/AUTH.md#程序化权限测试) 执行本仓库匿名/测试账号覆盖。权限验收禁止 browser；真实登录统一使用 Dashboard 的 `pnpm auth:verify`，凭据只从项目组根 `.env` 读取，不复制登录实现或密码到各仓库。

Auth0 配置维护在 Gateway 使用 `pnpm auth0:export` / `pnpm auth0:plan` / `pnpm auth0:apply`，必须指定 `--include`。详细参数、机器凭据、套餐限制与测试账号准备见 [共享 AUTH](../../eastmoney/docs/AUTH.md#auth0-配置管理deploy-cli)。

## 测试分层与覆盖率

测试规范、覆盖率口径、当前审计及专项入口见 [TESTING](TESTING.md)。
