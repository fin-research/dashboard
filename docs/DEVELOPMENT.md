# 开发与验证

## 本地环境

```bash
pnpm install
pnpm dev
```

- 开发服务器绑定 `127.0.0.1:8765`。
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
- 授信导入：先运行 `pnpm credit:import -- --file <xlsx> --date YYYY-MM-DD --dry-run`；确认报告日、目标数据库和汇总后，去掉 `--dry-run` 写入。再次导入同一日期会在单事务内替换当日记录，不产生导入审计历史。
- 台账回填默认只读；`--apply` 会写数据库，必须先确认目标环境和授权。

## 发布

- `pnpm worker:dev` 用于构建后本地 Worker 检查。
- 默认将验证通过的变更推送 GitHub `main`，由 Cloudflare Git 自动构建部署 `eastmoney-dashboard`；核对对应提交的构建状态和线上受影响路由。
- 自动部署不可用、失败或有其他必要时，可执行 `pnpm worker:deploy` 手动部署同一份已验证代码。自动构建与手动部署全程无需再次向用户申请授权；不得覆盖其他任务尚未集成的改动。
- 全站与融资业务共用 `AUTH0_MANAGEMENT_CLIENT_ID`、`AUTH0_MANAGEMENT_CLIENT_SECRET`。管理应用保留 `read:users`、`create:users`、`update:users`、`read:roles`、`update:roles`；个人资料 endpoint 仍严格限制当前账号和输入字段。
- 管理凭据验证：`node --use-env-proxy scripts/provision-auth0-management.mjs`。完成测试和构建后，`--apply` 用临时 0600 文件把既有 Secret 附到新 Worker version，再将该版本切为 100%；Client ID、Secret 和代码一起生效，临时文件在 finally 删除。不得先用 `secret put` 覆盖活动 Secret，造成新旧 Client ID 不匹配。原两个 provisioning 命令仅兼容转发到统一脚本。
- Access 团队域名变更时，同步 Dashboard、Data 与 financing 的 `ACCESS_TEAM_DOMAIN` 并重新生成类型；执行 `node scripts/update-access-team-domain.mjs --apply` 更新 Auth0 的对应回调与退出白名单，保留其余地址。
- Auth0 中文主题、两步注册和自定义登录域名的配置与检查见 `auth0/README.md`。浏览器域名为 `AUTH0_LOGIN_DOMAIN`，服务端管理 API 保持 `AUTH0_DOMAIN`；二者不能一起替换。
- 注册验证提示：Action 源码为 `auth0/actions/eastmoney-login.cjs`，公开页面为 `/auth/verify-email`。必须先发布 Dashboard 并确认提示页 200，再执行 `node --use-env-proxy scripts/publish-auth0-login.mjs --apply`；脚本保留已有 Action Secret、依赖和绑定，拒绝覆盖其他未发布草稿。发布后回读生效版本与 post-login 绑定。
- 本地账号服务可从 `.dev.vars.example` 创建未跟踪的 `.dev.vars`。变更真实邮箱、姓名及发送密码重置邮件均属于实际账号操作；默认测试使用模拟服务，不修改真实账号。
- 账号与路由专项验收：`node --test tests/auth-client.test.mjs tests/profile.test.mjs tests/access.test.mjs tests/fund-report.test.mjs`；构建后运行 `node scripts/verify-profile-routes.mjs` 验证真实 SvelteKit 路由与内存上传，全部上游为模拟实现。
- 发布前核对 `wrangler.jsonc` 中绑定、migration 顺序和生产数据服务路径，但不要把 Secret 写入配置。

## 文档维护

- UI 规则变化更新 `DESIGN.md`。
- 业务公式、状态与页面契约更新目标模块文档；跨模块不变量才更新 `docs/DOMAIN.md`。
- 数据、接口或安全边界变化更新对应专题；跨项目架构/存储/AI 更新 [项目组所有方](../../eastmoney/docs/INDEX.md#维护约定)。新增页面或模块更新 `docs/INDEX.md`，不把细节重新堆回 `AGENTS.md`。

## 融资模块维护

融资代码、测试、迁移与脚本全部由本仓库维护，不再向旧 financing 仓库提交功能。默认 `pnpm test` 同时运行两组测试；专项可使用 `pnpm test:financing`。生产构建仍用同一版本的 SvelteKit、Svelte、Tailwind、ECharts 与 pg。

迁移：`pnpm financing:db:init -- --schema-only`；Excel 盘点：`pnpm financing:db:import -- --dry-run`；SQLite 盘点：`pnpm financing:db:migrate:sqlite -- --dry-run`；提醒盘点：`pnpm financing:reminders:send -- --dry-run`；Protobuf：`pnpm financing:proto:generate`。凭证与原始 Excel 留在未跟踪本地文件中，导入时显式指定源路径，不把旧 checkout 作为运行依赖。

统一凭据版本上线并确认后，删除 Dashboard 已无调用方的 `FINANCING_AUTH0_MANAGEMENT_CLIENT_SECRET`。此后 Git 自动构建沿用统一 Secret；常规代码发布无需重复执行凭据切换脚本。合并切换历史见 [合并记录](FINANCING_MERGE.md)。

浏览器关键表单交互、200% 缩放和甘特图大字号视觉回归仍作为专项验收；未执行时不得写成已通过。仓库内已覆盖 Excel 映射/勾稽、提醒周期、项目建档和构建后路由测试，旧待办中的对应“缺少单元测试”不再重复列为待办。

统一权限迁移与发布步骤见 [UNIFIED_PERMISSIONS](UNIFIED_PERMISSIONS.md)。旧融资人员管理和 Auth0 初次账号导入脚本仅供历史迁移参考；当前人员和角色直接在 Auth0 管理，不重建已删除人员表。

## 权限专项验证

按 [共享 AUTH](../../eastmoney/docs/AUTH.md#程序化权限测试) 执行本仓库匿名/测试账号覆盖。权限验收禁止 browser；真实登录统一使用 Dashboard 的 `pnpm auth:verify`，凭据只从项目组根 `.env` 读取，不复制登录实现或密码到各仓库。

Auth0 配置维护使用 `pnpm auth0:export` / `pnpm auth0:plan` / `pnpm auth0:apply`，必须指定 `--include`。详细参数、机器凭据、套餐限制与测试账号准备见 [共享 AUTH](../../eastmoney/docs/AUTH.md#auth0-配置管理deploy-cli)。
