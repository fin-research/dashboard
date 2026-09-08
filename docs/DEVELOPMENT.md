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
- 个人信息服务使用独立的 `eastmoney dashboard profile` Auth0 管理应用：`AUTH0_MANAGEMENT_CLIENT_ID` 为非敏感配置，`AUTH0_MANAGEMENT_CLIENT_SECRET` 必须作为 Dashboard 的 Worker Secret 单独配置（不得轮换融资 Worker 使用的管理应用密钥）。需要 `read:users`、`update:users`、`read:roles` 权限；只读取当前账号的角色与权限，不授予前端管理令牌。
- 管理凭证配置：`node --use-env-proxy scripts/provision-auth0-profile.mjs` 只读计划；用户授权后加 `--apply` 创建或复用 Dashboard 专用 M2M 应用（不轮换已存在密钥），验证 client credentials 后通过标准输入写入 Worker Secret，并更新本地非敏感 Client ID。脚本不输出或落盘密钥与 Token；之后运行 `pnpm worker:typegen`。
- Access 团队域名变更时，同步 Dashboard、Data 与 financing 的 `ACCESS_TEAM_DOMAIN` 并重新生成类型；执行 `node scripts/update-access-team-domain.mjs --apply` 更新 Auth0 的对应回调与退出白名单，保留其余地址。
- Auth0 中文主题、两步注册和自定义登录域名的配置与检查见 `auth0/README.md`。浏览器域名为 `AUTH0_LOGIN_DOMAIN`，服务端管理 API 保持 `AUTH0_DOMAIN`；二者不能一起替换。
- 注册验证提示：Action 源码为 `auth0/actions/eastmoney-login.cjs`，公开页面为 `/auth/verify-email`。必须先发布 Dashboard 并确认提示页 200，再执行 `node --use-env-proxy scripts/publish-auth0-login.mjs --apply`；脚本保留已有 Action Secret、依赖和绑定，拒绝覆盖其他未发布草稿。发布后回读生效版本与 post-login 绑定。
- 本地账号服务可从 `.dev.vars.example` 创建未跟踪的 `.dev.vars`。变更真实邮箱、姓名及发送密码重置邮件均属于实际账号操作；默认测试使用模拟服务，不修改真实账号。
- 账号与路由专项验收：`node --test tests/auth-client.test.mjs tests/profile.test.mjs tests/access.test.mjs tests/fund-report.test.mjs`；构建后运行 `node scripts/verify-profile-routes.mjs` 验证真实 SvelteKit 路由与内存上传，全部上游为模拟实现。
- 发布前核对 `wrangler.jsonc` 中绑定、migration 顺序和生产数据服务路径，但不要把 Secret 写入配置。

## 文档维护

- UI 规则变化更新 `DESIGN.md`。
- 业务口径变化更新 `docs/DOMAIN.md`。
- 数据、接口或安全边界变化只更新对应专题，不把细节重新堆回 `AGENTS.md`。

## 融资模块维护

融资代码、测试、迁移与脚本全部由本仓库维护，不再向旧 financing 仓库提交功能。默认 `pnpm test` 同时运行两组测试；专项可使用 `pnpm test:financing`。生产构建仍用同一版本的 SvelteKit、Svelte、Tailwind、ECharts 与 pg。

迁移：`pnpm financing:db:init -- --schema-only`；Excel 盘点：`pnpm financing:db:import -- --dry-run`；SQLite 盘点：`pnpm financing:db:migrate:sqlite -- --dry-run`；提醒盘点：`pnpm financing:reminders:send -- --dry-run`；Protobuf：`pnpm financing:proto:generate`。凭证与原始 Excel 留在未跟踪本地文件中，导入时显式指定源路径，不把旧 checkout 作为运行依赖。

`node scripts/provision-financing-management.mjs` 验证原融资 M2M 应用与权限；`--apply` 将原凭据安全写入 Dashboard 的专用 Secret，不创建或轮换原凭据。部署与切换顺序、性能指标见 [合并记录](FINANCING_MERGE.md)。

浏览器关键表单交互、200% 缩放和甘特图大字号视觉回归仍作为专项验收；未执行时不得写成已通过。仓库内已覆盖 Excel 映射/勾稽、提醒周期、项目建档和构建后路由测试，旧待办中的对应“缺少单元测试”不再重复列为待办。
