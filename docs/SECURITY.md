# 安全边界

## Secret 与配置

- `CF_AIG_TOKEN` 只通过 Worker Secret 注入，禁止写入源码、`wrangler.jsonc`、`.env.dev`、日志或文档。
- `CLOUDFLARE_ACCOUNT_ID`、`AI_GATEWAY_ID` 和数据服务基址是非敏感配置，但仍应通过 Worker/Vite 配置读取。
- Neon 直连 `DATABASE_URL` 只供本地 migration 与回填脚本使用；本地 `pnpm dev` 通过未跟踪的 `.env.local` 注入 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`，生产 Worker 仍只读取 `HYPERDRIVE.connectionString`。
- quant 在本机使用 `DATABASE_URL` 追加融资择时模型快照；连接串不得经 dashboard 页面或 API 暴露。
- 本地需要调用模型时从 `.dev.vars.example` 创建未跟踪的 `.dev.vars`；Neon 开发直连从 `.env.local.example` 创建未跟踪的 `.env.local`。不要提交这两个文件。

## 客户端与服务端边界

- 浏览器不得取得 AI token、数据库连接字符串、D1/R2 binding 或完整二级池 Excel 数据缓存。
- `$lib/server` 模块不得被客户端代码导入。
- 生成式 AI 输出必须经 Zod Schema 或明确的文本协议校验后进入业务层。
- 融资择时卖方观点先调用固定 AI Search MCP 公共端点，仅把限长、去重后的证据交给 AI Gateway；机构、标题、日期和源 key 由检索元数据回填，不接受模型自由生成。
- R2 对象 key 和下载文件必须先由数据库记录解析，不能接受任意用户路径直读存储桶。

## 请求保护

- 二级池上传和删除执行同源校验；保持 `src/lib/server/bond-ledger.ts` 的校验边界。
- 市场点评与热点页面当前不是独立账号系统。不要把“同源”误写成“已鉴权”，也不要在未设计权限模型时暴露更高风险的写操作。
- 融资择时整体结论和卖方生成按已授权内部写操作处理，执行同源校验并保留追加历史；当前同样不是独立账号鉴权。
- 文件上传必须维持类型、大小、日期和内容校验；失败时不得留下被标记为成功的数据库记录。

## 数据与日志

- D1 不保存文章正文；热点只读取结构化摘要和关键词。
- 日志记录事件、状态、范围和可公开错误，不记录 token、连接串、完整文章正文或 Excel 内容。
- 对外 5xx 使用稳定的公开错误文案；详细堆栈只进入服务端日志。
