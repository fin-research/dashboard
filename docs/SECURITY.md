# 安全边界

## Secret 与配置

- 生成式 AI 只通过 `src/lib/server/ai-gateway.ts`；传输、重试、BYOK 和 AI 日志规则只在 [共享 AI](../../eastmoney/docs/AI.md) 维护。业务代码不读取上游 API Key。
- `CF_AIG_TOKEN` 只通过 Worker Secret 注入；`CLOUDFLARE_ACCOUNT_ID`、`AI_GATEWAY_ID` 和数据服务基址是非敏感配置，但仍应通过 Worker/Vite 配置读取。
- Neon 直连 `DATABASE_URL` 只供本地 migration、回填和授信 Excel 导入脚本使用；本地 `pnpm dev` 通过未跟踪的 `.env.local` 注入 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`，生产 Dashboard Worker 仅使用 `HYPERDRIVE` 业务连接；Gateway 使用 `AUTHORIZATION_DB` 权限连接，见下文权限边界。
- quant 在本机使用 `DATABASE_URL` 追加融资择时模型快照；连接串不得经 dashboard 页面或 API 暴露。
- Neon 开发直连从 `.env.local.example` 创建未跟踪的 `.env.local`。不要提交该文件。

## 客户端与服务端边界

- 授信助手使用独立 R2 `credit` 材料库，页面、`/api/credit-assistant/*`、SSE 和 Worker 直连入口在 Gateway 完成身份与路由权限验证后进入业务处理。固定 DO 名称从已验证 `user.auth0Id` 和客户名称派生，不接受客户端声明的用户 ID 或随机会话 Cookie。只有 `定期报告/` 为公开材料，其他原件及其信息须机构已签署保密协议。按用户要求，一次生成及其 SSE 沿用提交时核对的客户权限，完成时不再重复查询；新的历史读取、复制和下载请求仍核对当前状态。保密下载同时要求当前用户、客户及 `turnId` 对应的已提供来源/附件，未知、缺失或失败不放行。范围外问题在材料检索前固定拒答；具体流程见 `CREDIT_ASSISTANT.md`。

- 浏览器不得取得 Provider 密钥、数据库连接字符串、D1/R2 binding、完整二级池 Excel 数据缓存或授信源 Excel。本地授信导入不得上传文件到 Worker、R2 或浏览器接口。
- 授信助手客户选择与协议标签仅使用工作台内存中的展示快照，不进行选择前授权往返；空闲且无答复的会话读取不回查协议。第一条问题可直接创建客户会话，提交时必须查询后端当前机构和协议；含材料的历史读取及附件权限规则不变，前端保密标志不进入授权输入。
- `$lib/server` 模块不得被客户端代码导入。
- Dashboard Worker 到同一 zone 的 Data Worker 使用 `DATA` Service Binding；服务端代码不得以公开 hostname 做 Worker-to-Worker 回环请求。市场点评浏览器直接请求公开 `/data/*` 行情资源；旧 `/api/market-resources/*` 使用同一公开只读边界，保留资源与参数白名单。
- 生成式 AI 输出必须经 Zod Schema 或明确的文本协议校验后进入业务层。
- 融资择时卖方观点先调用固定 AI Search MCP 公共端点，仅把限长、去重后的证据交给 AI Gateway；机构、标题、日期和源 key 由检索元数据回填，不接受模型自由生成。
- R2 对象 key 和下载文件必须先由数据库记录解析，不能接受任意用户路径直读存储桶。
- 资金日报列表只枚举 `fund-reports/` 固定前缀并过滤严格日期文件名；单期读取只允许用严格日期派生 `fund-reports/YYYY-MM-DD.html`，不得把 URL 路径直接拼为 R2 key。返回的交互 HTML 使用 CSP sandbox 保留脚本交互，但不授予同源访问能力，并禁用摄像头、麦克风和定位。

## 请求保护与私有入口

- Gateway 是本站唯一公网入口，Auth0 JWT、JWKS、会话、账号状态、角色及路由权限全部由 Gateway 处理。详细协议见 [共享 AUTH](../../eastmoney/docs/AUTH.md)。
- Dashboard `routes=[]`、`workers_dev=false`、`preview_urls=false`，没有 Custom Domain，默认 fetch 固定 404；静态资产 `run_worker_first=true`，不能绕开默认入口。
- 只有 `GatewayDashboard` 命名 Service Binding 接收 Gateway 的 Base64URL 上下文，解析后移入请求内 `env.GATEWAY_CONTEXT` 并删除身份头。`hooks.server.ts` 仅从该元数据设置 `locals.user` 和 permissions，不读取 Cookie、外部身份头，不验证 JWT，也不调用 Auth0/权限库。缺少元数据失败关闭。
- 独立授信助手 HTTP 从同一私有入口取得已验证 `user`，继续执行用户/客户会话绑定、材料保密和下载来源检查。DO 不新增公网旁路。
- Gateway 的同源、方法和 named action 检查发生在转发前；业务仍验证输入白名单、记录归属、乐观锁、文件类型/大小/内容和事务 RLS。上传登录检查、菜单及前端权限只用于交互。
- Gateway 拥有 `/auth/login`、`/auth/callback`、退出、`/auth/session` 和 `/api/profile`，后端只保留必要的兼容或私有转发。登录响应和包含身份的响应 private/no-store，401 跳登录而 403 保留权限错误；`__data.json` 使用 SvelteKit redirect 数据协议。
- 新账号的邮箱/姓名/部门和验证流程仍由 Auth0 Actions/Forms 管理；用户字段不授予角色。Auth0 token 的 namespace email 必须与当前账号一致，旧邮箱会话不能修改资料。
- 个人信息白名单与本人校验由 Gateway 维护；邮箱变更需明确确认，重置验证并退出；密码使用既有重置邮件流程。管理凭据不留在 Dashboard Worker，目录及角色配置通过 `IDENTITY: IdentityService` 取得。

## 数据与日志

- D1 不保存研报正文；政策正文仍存 `policy_news`，见 [共享数据库](../../eastmoney/docs/DATABASE.md#共享-d1)。热点只读取结构化摘要和关键词。
- Worker 日志记录事件、状态、范围、Provider 尝试次序、任务类型、effort、reasoning summary/context 模式、返回摘要条数与字符数、Prompt Cache token 计数、加密推理存在性、输出长度和 Gateway log ID，不记录 token、连接串、推理摘要正文、完整 AI 输入输出、完整文章正文、授信源文件路径或 Excel 内容。
- Data/API 错误可对外返回用于排查的结构化安全诊断：接口路径、HTTP 状态、错误码、数据源、
  处理阶段，以及限长后的字段路径、收到类型和标量值。不得返回堆栈、Cookie、token、签名
  URL、连接串、完整正文或大段原始响应；详细堆栈仍只进入服务端日志。

## 权限结果与业务约束

`src/lib/permissions.ts` 与 `route-permissions.ts` 是 Gateway 生成的前端展示契约，供菜单与导航使用；不可作为服务端授权输入。修改权限在 Gateway 完成，再同步契约。`locals.user.id` 与 `auth0Id` 均为 Auth0 subject，业务负责人只用 Auth0 ID，不能按邮箱/姓名关联。

客户端会话只由根 layout 实例持有，不跨 SSR 请求共享，不写 localStorage。公开首屏经 `/auth/session` 初始化一次，普通导航复用展示快照；过期和明确角色变更时刷新。相同 token 的 SSR 导航不覆盖登录时的权限展示快照，403 不额外刷新会话。角色成员变更后从个人资料页“刷新登录状态”重新走授权码流程取得新 token，或重新登录。其他终端的旧菜单不构成服务端授权；Gateway 使用已签名 JWT 的角色，每个业务请求实时查询 permission 表（内测全权限例外保留），普通准入不查询 Auth0 Management API。

Dashboard 不持有 `AUTHORIZATION_DB` 或 Auth0 管理 Secret。`/management/people` 保留界面、草稿、版本和错误响应，通过私有 Gateway 服务读写。Gateway 在无缓存权限连接中完成角色锁、版本检查和事务，未知角色/权限失败关闭；配置不会改变当前 beta-open 模式。

融资数据后台继续使用表/字段白名单、参数化 SQL、完整主键与乐观条件。事务用 Gateway 已确认的 Auth0 ID、permissions 和 operation 设置 `request.auth.*` 后 `SET LOCAL ROLE authenticated`；提交/回滚清除上下文。RLS 保留 read/create/update/delete 及记录归属约束，不接受浏览器提供的权限集合。
