# 安全边界

## Secret 与配置

- 生成式 AI 只通过 `src/lib/server/ai-gateway.ts` 的固定 provider-specific URL 进入 AI Gateway；统一调用 `custom-codex/responses`，可重试失败时仅重试同一 Provider 一次（授信问答保持单次尝试），不得使用会进入 Universal 适配层的 AI binding `run()`。Provider 密钥由 Gateway BYOK 的 `default` alias 管理，业务代码不读取上游 API Key。
- `CF_AIG_TOKEN` 只通过 Worker Secret 注入；`CLOUDFLARE_ACCOUNT_ID`、`AI_GATEWAY_ID` 和数据服务基址是非敏感配置，但仍应通过 Worker/Vite 配置读取。
- Responses 请求不显式传递 `store`，统一设置 `reasoning.context="current_turn"`，并保留 `reasoning.summary="auto"` 请求可读推理摘要；不得设置 `include: ["reasoning.encrypted_content"]`。这不开放原始推理过程。稳定 Prompt 放在 `instructions`，动态新闻、证据和模型快照放在末尾 `input`，并使用版本化 `prompt_cache_key` 复用上游 Prompt Cache。
- Neon 直连 `DATABASE_URL` 只供本地 migration、回填和授信 Excel 导入脚本使用；本地 `pnpm dev` 通过未跟踪的 `.env.local` 注入 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`，生产 Worker 仍只读取 `HYPERDRIVE.connectionString`。
- quant 在本机使用 `DATABASE_URL` 追加融资择时模型快照；连接串不得经 dashboard 页面或 API 暴露。
- Neon 开发直连从 `.env.local.example` 创建未跟踪的 `.env.local`。不要提交该文件。

## 客户端与服务端边界

- 授信问答是单独的材料库，按用户要求将指定授信材料原件及解析文本上传独立 R2 `credit`，并支持按文档 ID 下载；这不改变下文“授信台账 Excel 仅本地导入 Neon”的既有流程。其页面、`/api/credit-assistant/*` 和独立 Worker HTTP 入口统一验证 Access 身份，直连域名也不能绕过。会话隔离 Cookie 不承担身份认证。授信问答另将每个会话绑定授信库中的客户机构，只有 `定期报告/` 为公开材料，其他原件及其信息须该机构已签署保密协议。检索生成、历史读取和带 `turnId` 的原件下载都在服务端校验；协议状态未知、记录缺失或读取失败不得放行。

- 浏览器不得取得 Provider 密钥、数据库连接字符串、D1/R2 binding、完整二级池 Excel 数据缓存或授信源 Excel。本地授信导入不得上传文件到 Worker、R2 或浏览器接口。
- `$lib/server` 模块不得被客户端代码导入。
- Dashboard Worker 到同一 zone 的 Data Worker 使用 `DATA` Service Binding；服务端代码不得以公开 hostname 做 Worker-to-Worker 回环请求。公开市场点评的浏览器请求使用 `/api/market-resources/*` 限定通道，其余 Data 请求须携带有效 Access 会话。
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
- `src/hooks.server.ts` 统一保护所有非 GET/HEAD/OPTIONS 操作及 `/profile*`、`/api/profile*`、`/trading-research*`、`/credit-assistant`、`/api/credit*` 和 `/api/economic-indicators`。其他页面和只读接口保持公开。Dashboard 对有效登录账号不检查角色或业务权限。
- `worker/entry.ts` 对绕过 SvelteKit 的授信问答 HTTP 入口执行相同验证；WebSocket 和 GET 也受保护。
- 写入同时验证 Origin，文件上传继续保留类型、大小、日期、内容校验，数据库写入继续使用参数化查询和事务。登录不能替代业务输入校验。
- 公开报告资源通道只允许报告使用的资源、字段、日期范围和有界条数，不能转发任意 URL、路径、GraphQL 或 Choice 指标。通过私有 DATA binding 读取后流式返回，客户端继续执行原有 Zod 契约校验。
- 个人资料只使用签名已验证 JWT 中的 `eastmoney_user_id`（兼容 `custom` / `oidc_fields`），绝不通过邮箱查找并关联 Auth0 用户。每次读写再次核对 Auth0 当前账号、连接、停用状态和邮箱；旧邮箱对应的 Access 会话不得继续修改资料。
- `/api/profile` 严格白名单输入，用户不能传入目标 ID、角色、权限、`app_metadata` 或密码。邮箱变更必须明确确认，仅限 18.cn，设置 `email_verified=false` 与 `verify_email=true` 后退出登录；密码只使用 Auth0 邮件重置流程。管理 API 的 Secret 仅驻留服务端，外部请求禁止跟随重定向，响应与请求均限制读取大小。
- 前端路由守卫与上传前登录检查属于交互保护；服务端 Access 与 Origin 校验仍是授权边界。浏览器同源 HTTP 401 统一跳转登录，禁止把 403 或上游管理凭证失效误判为当前用户登录失效。
- 登录相关响应和含身份的页面使用 private/no-store；JWT、Cookie、客户端 Secret 不进入页面数据或日志。
- `ACCESS_MODE=legacy` 仅用于有明确顺序的迁移与回退；正常配置为 `enforce`，未知模式或保护配置缺失必须失败关闭。

## 数据与日志

- D1 不保存文章正文；热点只读取结构化摘要和关键词。
- Worker 日志记录事件、状态、范围、Provider 尝试次序、任务类型、effort、reasoning summary/context 模式、返回摘要条数与字符数、Prompt Cache token 计数、加密推理存在性、输出长度和 Gateway log ID，不记录 token、连接串、推理摘要正文、完整 AI 输入输出、完整文章正文、授信源文件路径或 Excel 内容。
- Data/API 错误可对外返回用于排查的结构化安全诊断：接口路径、HTTP 状态、错误码、数据源、
  处理阶段，以及限长后的字段路径、收到类型和标量值。不得返回堆栈、Cookie、token、签名
  URL、连接串、完整正文或大段原始响应；详细堆栈仍只进入服务端日志。

## 融资与管理模块的额外授权

中央 Access 校验由 `src/lib/server/access.ts` 统一执行。`locals.user` 保存全站身份，`locals.financingUser` 保存明确关联、启用的融资人员。融资 middleware 仅对 `/financing/*` 和人员相关管理路由执行；通过 `route-contract.ts` 把新路由映射到原 named action 权限表，未登记 mutation 拒绝。

Profile 使用既有低权限 `AUTH0_MANAGEMENT_CLIENT_ID/SECRET`；人员管理使用 `FINANCING_AUTH0_MANAGEMENT_CLIENT_ID/SECRET`，复用原融资 M2M 应用而不扩大个人资料应用权限。两个 Secret 不能互换，不能进入客户端或日志。

### 融资授权

- Auth0 RBAC 是三种融资角色和七类权限的管理来源。角色名为 `financing:admin`、`financing:handler`、`financing:reviewer`，在应用中仍使用原 admin/handler/reviewer 代码和原权限代码。
- 角色授权使用 `https://eastmoney.hasbai.xyz/financing` API 的 permissions，忽略其他 API 的同名权限。账号必须且只能关联一种融资角色。
- `people` 保存人员主档和 Auth0 账号关联；人员启用是进入融资业务的额外条件。人员页面同步 Auth0 的角色与账号状态，角色／权限维护调用 Auth0 后读取确认结果。
- SvelteKit 非安全方法继续按“路由 + named action”映射权限，未登记 mutation 默认拒绝。本人任务更新继续同时校验 personId 与负责人，SQL 保留负责人条件。
- 不允许停用／删除当前人员或移除其登录权限，并至少保留一个启用管理员、一个可维护权限配置的启用角色。移除融资登录只移除融资角色和人员关联，不删除全站 Auth0 账号。
- 融资人员停用使用人员状态与 `app_metadata.financing_enabled`；它不自动封禁其他应用。Auth0 全局 blocked 仍阻止融资访问。


### 融资授权缓存和数据后台

- 只读请求可复用最多 60 秒的身份判断，缓存键仍为凭证 SHA-256，不保存明文 Cookie/JWT。写请求、`/data/token` 和 `/data/api/*` 强制实时查询 Auth0。
- 数据后台通过同源 `/financing/data/api/*` 使用原有表和字段白名单。客户端不再取得 Neon Auth JWT，禁止任意表、任意 SQL、无主键批量修改和只读字段写入；乐观版本条件继续保留。
- Worker 在单请求同一个 Hyperdrive Client 的事务中设置已验证身份的事务上下文 `request.financing.user_id`，然后 `SET LOCAL ROLE authenticated`。所有设置在事务结束时消失；Auth0 路径不依赖旧 Neon JWT 扩展的会话初始化。
- PostgreSQL RLS 同时检查人员启用、Auth0 账号状态、data_manage 和最长 60 秒的已确认授权有效期；过期授权拒绝读取和写入。数据写入继续由原审计触发器记录 personId、邮箱和变更前后值。
- 导入、数据编辑和令牌／代理入口保留 data_manage 检查，POST/PATCH/DELETE 额外校验 Origin。
- 生产账号迁移采用带原 scrypt 参数的批量导入；上线前核对全部 ID、邮箱、角色与权限。只有新认证和业务访问可用后才移除旧 Neon Auth。
