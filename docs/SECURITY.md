# 安全边界

## Secret 与配置

- 生成式 AI 只通过 `src/lib/server/ai-gateway.ts` 的固定 provider-specific URL 进入 AI Gateway；优先 `custom-opencode/responses`，可重试失败时回退 `custom-codex/responses`，不得使用会进入 Universal 适配层的 AI binding `run()`。Provider 密钥由 Gateway BYOK 的 `default` alias 管理，业务代码不读取上游 API Key。
- `CF_AIG_TOKEN` 只通过 Worker Secret 注入；`CLOUDFLARE_ACCOUNT_ID`、`AI_GATEWAY_ID` 和数据服务基址是非敏感配置，但仍应通过 Worker/Vite 配置读取。
- Responses 请求不显式传递 `store`，统一使用 `reasoning.summary="auto"` 请求可读推理摘要；这不开放原始推理过程。稳定 Prompt 放在 `instructions`，动态新闻、证据和模型快照放在末尾 `input`，并使用版本化 `prompt_cache_key` 复用上游 Prompt Cache。
- Neon 直连 `DATABASE_URL` 只供本地 migration、回填和授信 Excel 导入脚本使用；本地 `pnpm dev` 通过未跟踪的 `.env.local` 注入 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`，生产 Worker 仍只读取 `HYPERDRIVE.connectionString`。
- quant 在本机使用 `DATABASE_URL` 追加融资择时模型快照；连接串不得经 dashboard 页面或 API 暴露。
- Neon 开发直连从 `.env.local.example` 创建未跟踪的 `.env.local`。不要提交该文件。

## 客户端与服务端边界

- 浏览器不得取得 Provider 密钥、数据库连接字符串、D1/R2 binding、完整二级池 Excel 数据缓存或授信源 Excel。本地授信导入不得上传文件到 Worker、R2 或浏览器接口。
- `$lib/server` 模块不得被客户端代码导入。
- 生成式 AI 输出必须经 Zod Schema 或明确的文本协议校验后进入业务层。
- 融资择时卖方观点先调用固定 AI Search MCP 公共端点，仅把限长、去重后的证据交给 AI Gateway；机构、标题、日期和源 key 由检索元数据回填，不接受模型自由生成。
- R2 对象 key 和下载文件必须先由数据库记录解析，不能接受任意用户路径直读存储桶。
- 资金日报列表只枚举 `fund-reports/` 固定前缀并过滤严格日期文件名；单期读取只允许用严格日期派生 `fund-reports/YYYY-MM-DD.html`，不得把 URL 路径直接拼为 R2 key。返回的交互 HTML 使用 CSP sandbox 保留脚本交互，但不授予同源访问能力，并禁用摄像头、麦克风和定位。

## 请求保护

- 二级池上传和删除执行同源校验；保持 `src/lib/server/bond-ledger.ts` 的校验边界。
- 市场点评定稿保存和热点页面当前不是独立账号系统；写入只做同源校验。同源不等于鉴权，若页面开放给不可信用户，必须先补独立身份与授权模型。
- 融资择时整体结论和卖方生成按已授权内部写操作处理，执行同源校验并保留追加历史；当前同样不是独立账号鉴权。
- 文件上传必须维持类型、大小、日期和内容校验；失败时不得留下被标记为成功的数据库记录。
- 资金日报上传执行同源校验，但当前与其他内部写接口一样没有独立账号鉴权；不要把管理页入口本身视为权限控制。
- `/api/credit` 的 PATCH 按内部已授权写操作处理：执行同源校验、Zod 输入校验、参数化增量更新和单事务提交。当前与其他内部写接口一样不等于独立账号鉴权；若站点开放给不可信用户，必须先补身份与岗位授权。

## 数据与日志

- D1 不保存文章正文；热点只读取结构化摘要和关键词。
- Worker 日志记录事件、状态、范围、Provider 尝试次序、任务类型、effort、reasoning summary 模式、返回摘要条数与字符数、Prompt Cache token 计数、加密推理存在性、输出长度和 Gateway log ID，不记录 token、连接串、推理摘要正文、完整 AI 输入输出、完整文章正文、授信源文件路径或 Excel 内容。
- 对外 5xx 使用稳定的公开错误文案；详细堆栈只进入服务端日志。
