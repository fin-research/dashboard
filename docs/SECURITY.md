# 安全边界

## Secret 与配置

- 生成式 AI 只通过 `src/lib/server/ai-gateway.ts`；传输、重试、BYOK 和 AI 日志规则只在 [共享 AI](../../eastmoney/docs/AI.md) 维护。业务代码不读取上游 API Key。
- `CF_AIG_TOKEN` 只通过 Worker Secret 注入；`CLOUDFLARE_ACCOUNT_ID`、`AI_GATEWAY_ID` 和数据服务基址是非敏感配置，但仍应通过 Worker/Vite 配置读取。
- Neon 直连 `DATABASE_URL` 只供本地 migration、回填和授信 Excel 导入脚本使用；本地 `pnpm dev` 通过未跟踪的 `.env.local` 注入 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`，生产 Worker 使用 `HYPERDRIVE` 业务连接与 `AUTHORIZATION_DB` 权限连接，见下文权限边界。
- quant 在本机使用 `DATABASE_URL` 追加融资择时模型快照；连接串不得经 dashboard 页面或 API 暴露。
- Neon 开发直连从 `.env.local.example` 创建未跟踪的 `.env.local`。不要提交该文件。

## 客户端与服务端边界

- 授信问答是单独的材料库，按用户要求将指定授信材料原件及解析文本上传独立 R2 `credit`，并支持按文档 ID 下载；这不改变下文“授信台账 Excel 仅本地导入 Neon”的既有流程。其页面、`/api/credit-assistant/*` 和独立 Worker HTTP 入口统一验证 Access 身份，直连域名也不能绕过。会话隔离 Cookie 不承担身份认证。授信问答另将每个会话绑定授信库中的客户机构，只有 `定期报告/` 为公开材料，其他原件及其信息须该机构已签署保密协议。检索生成、历史读取和带 `turnId` 的原件下载都在服务端校验；协议状态未知、记录缺失或读取失败不得放行。

- 浏览器不得取得 Provider 密钥、数据库连接字符串、D1/R2 binding、完整二级池 Excel 数据缓存或授信源 Excel。本地授信导入不得上传文件到 Worker、R2 或浏览器接口。
- `$lib/server` 模块不得被客户端代码导入。
- Dashboard Worker 到同一 zone 的 Data Worker 使用 `DATA` Service Binding；服务端代码不得以公开 hostname 做 Worker-to-Worker 回环请求。市场点评浏览器携带有效 Access 会话直接请求 `/data/*` 行情资源，由 Data 校验 JWT；旧 `/api/market-resources/*` 仅作为相同登录边界的限定兼容通道。
- 生成式 AI 输出必须经 Zod Schema 或明确的文本协议校验后进入业务层。
- 融资择时卖方观点先调用固定 AI Search MCP 公共端点，仅把限长、去重后的证据交给 AI Gateway；机构、标题、日期和源 key 由检索元数据回填，不接受模型自由生成。
- R2 对象 key 和下载文件必须先由数据库记录解析，不能接受任意用户路径直读存储桶。
- 资金日报列表只枚举 `fund-reports/` 固定前缀并过滤严格日期文件名；单期读取只允许用严格日期派生 `fund-reports/YYYY-MM-DD.html`，不得把 URL 路径直接拼为 R2 key。返回的交互 HTML 使用 CSP sandbox 保留脚本交互，但不授予同源访问能力，并禁用摄像头、麦克风和定位。

## 请求保护

- Auth0 的 `eastmoney-email` 连接只允许邮箱注册，Pre Registration Action 限制为 `18.cn`；新账号验证邮箱后登录，迁移的既有账号保留原验证状态。
- Cloudflare Access 使用团队 `hasbai.cloudflareaccess.com` 和独立 eastmoney 应用。Worker 校验 RS256 签名、issuer、audience、有效期与人员邮箱，不信任单独的邮箱头，也不接受服务身份执行用户操作。
- 新注册账号未验证邮箱时，Post Login Action 暂停登录并跳转公开 `/auth/verify-email`，提示检查邮件；不向 Access 回调发送 `access_denied`，也不签发身份声明。页面不接收或显示邮箱／账号 ID，不消费 Auth0 附带的 `state`；验证后发起全新登录，直接调用旧事务 `/continue` 仍被拒绝。原迁移账号的 UUID、账号 ID 与原邮箱绑定例外保持不变。
- `/auth/login` 是统一登录／注册入口，返回地址只接受安全的本站路径。退出清理站点 Cookie，再退出 Auth0 和 Access，最后回到本站首页；两层退出目标由服务端生成，不采用请求中的 `returnTo`，退出响应禁止缓存。
- 浏览器登录与退出使用 `auth.hasbai.xyz`；`AUTH0_DOMAIN` 继续指向原租户域名，仅用于服务端管理 API。新注册用户在 Auth0 Forms 中必填姓名、部门，保存成功后再进入原邮箱验证流程；资料字段不授予角色或自动关联融资人员，原有账号不强制补填。
- `src/hooks.server.ts` 对全部业务页面和 API 执行统一身份与权限检查，具体规则见下文。
- `worker/entry.ts` 对绕过 SvelteKit 的授信问答 HTTP 入口执行相同验证；WebSocket 和 GET 也受保护。
- 写入同时验证 Origin，文件上传继续保留类型、大小、日期、内容校验，数据库写入继续使用参数化查询和事务。登录不能替代业务输入校验。
- 旧报告资源兼容通道在验证 Access 登录后，只允许报告使用的资源、字段、日期范围和有界条数，不能转发任意 URL、路径、GraphQL 或 Choice 指标。通过私有 DATA binding 读取后流式返回，客户端继续执行原有 Zod 契约校验。
- 个人资料只使用签名已验证 JWT 中的 `eastmoney_user_id`（兼容 `custom` / `oidc_fields`），绝不通过邮箱查找并关联 Auth0 用户。每次读写再次核对 Auth0 当前账号、连接、停用状态和邮箱；旧邮箱对应的 Access 会话不得继续修改资料。
- `/api/profile` 严格白名单输入，用户不能传入目标 ID、角色、权限、`app_metadata` 或密码。邮箱变更必须明确确认，仅限 18.cn，设置 `email_verified=false` 与 `verify_email=true` 后退出登录；密码只使用 Auth0 邮件重置流程。管理 API 的 Secret 仅驻留服务端，外部请求禁止跟随重定向，响应与请求均限制读取大小。
- 前端路由守卫与上传前登录检查属于交互保护；服务端 Access 与 Origin 校验仍是授权边界。浏览器同源 HTTP 401 统一跳转登录，禁止把 403 或上游管理凭证失效误判为当前用户登录失效。
- 登录相关响应和含身份的页面使用 private/no-store；JWT、Cookie、客户端 Secret 不进入页面数据或日志。
- `ACCESS_MODE=legacy` 仅用于有明确顺序的迁移与回退；正常配置为 `enforce`，未知模式或保护配置缺失必须失败关闭。

## 数据与日志

- D1 不保存研报正文；政策正文仍存 `policy_news`，见 [共享数据库](../../eastmoney/docs/DATABASE.md#共享-d1)。热点只读取结构化摘要和关键词。
- Worker 日志记录事件、状态、范围、Provider 尝试次序、任务类型、effort、reasoning summary/context 模式、返回摘要条数与字符数、Prompt Cache token 计数、加密推理存在性、输出长度和 Gateway log ID，不记录 token、连接串、推理摘要正文、完整 AI 输入输出、完整文章正文、授信源文件路径或 Excel 内容。
- Data/API 错误可对外返回用于排查的结构化安全诊断：接口路径、HTTP 状态、错误码、数据源、
  处理阶段，以及限长后的字段路径、收到类型和标量值。不得返回堆栈、Cookie、token、签名
  URL、连接串、完整正文或大段原始响应；详细堆栈仍只进入服务端日志。

## 全站授权入口

除 Access 登录即允许的行情原始资源读取及其旧兼容通道外，所有业务页面、只读 API、写入 API 和 named actions 由 `src/lib/server/authorization.ts` 检查。`src/hooks.server.ts` 是 SvelteKit 的唯一检查入口；全局服务端 layout 依赖 pathname，使纯客户端页面之间的导航也经过入口检查。门户、身份流程和静态资源以明确规则公开，其余业务只读接口同样执行应用权限检查。

`src/lib/permissions.ts` 是权限代码及说明的唯一来源，`src/lib/server/permission-policy.ts` 按真实路由 ID、HTTP 方法、named action 分配权限。未知路由、未登记操作和含多个 action 的请求失败关闭。GET/HEAD 也校验读取权限；写入检查 Origin，前端可见性不能代替服务端校验。

独立授信问答 HTTP 入口调用同一授权函数，保留原客户保密材料边界。Data Worker 的行情原始资源 GET/HEAD 只验证 Access 登录；其余公网用户请求通过私有 `AUTHORIZATION` binding 调用 Dashboard `Authorization` entrypoint；Data 不维护第二套权限目录或授权矩阵，不信任自报身份或权限头。服务绑定和明确允许的 Access 服务身份用于机器任务，不代表用户角色。Ingest 的 HTTP 入口仅公开 health，其工作由 Cron/Workflow 执行；Quant、Choice 无新增用户权限入口。

全站身份仍只有 `locals.user`：`id` 是 Access subject，`auth0Id` 来自已验证的 `eastmoney_user_id`，`authorization` 为统一授权结果。业务负责人只用 Auth0 ID；不能用 Access subject、姓名或邮箱推断关联。每次应用权限请求查询 Auth0 当前账号、连接、验证状态及角色；账号停用、邮箱变更和撤销角色不受应用身份缓存影响。仅管理服务 token 可按有效期缓存，人员目录与角色列表只在单请求内复用。

## 权限存储与内测模式

用户、角色及成员关系仅由 Auth0 管理。应用只维护 `authorization.permission` 和 `authorization.role_permission`，详见 [管理中心](modules/management.md)。模式显式配置为 `beta-open` 或 `enforce`，未知模式拒绝受保护请求；内测开放仅发生在身份验证之后，不能匿名绕过，也不允许未登记操作。

Auth0 管理请求由 `auth0-management.js` 共用唯一 `AUTH0_MANAGEMENT_CLIENT_SECRET`，禁止跟随外部重定向，限时、限长读取。应用权限不读取旧融资 resource server 的 permissions。角色权限保存使用事务、角色锁和版本比对；禁止客户端提供有效权限集合或授权模式。

融资数据后台继续使用同源 Worker 代理、表/字段白名单、参数化 SQL、完整主键和乐观版本条件。事务内设置已验证的 `request.auth.user_id`、`request.auth.permissions`、`request.auth.operation` 后 `SET LOCAL ROLE authenticated`；提交或回滚均清除上下文。RLS 分别检查 read/create/update/delete，不再查询 people 表或保存人员授权到期时间。`authenticated` 无权修改权限表。原人员、角色权限、审计表与审计触发器在迁移中移除，不建立替代审计流程。

权限矩阵的读取、配置和保存只使用 `AUTHORIZATION_DB`，它连接同一 Neon 数据库并明确禁用 Hyperdrive 查询缓存；业务读取继续使用既有 `HYPERDRIVE`。部署配置缺少该权限连接时，正式授权与后台配置失败关闭，不回退到缓存连接。
