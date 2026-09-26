# 授信助手

原页面已由全站 AI 侧栏取代。`/credit-workbench/assistant`、`/credit-assistant` 和 `/trading-research/credit-assistant` 重定向到门户并打开侧栏。浏览器端 ToolLoopAgent 可通过 MCP 的 `credit_public_materials`、`credit_public_search` 读取同一公开材料目录和检索片段；原 CreditAgent HTTP/DO 会话暂保留历史兼容，不再作为页面入口。答复不自动向客户发送消息。

## 公开资料边界

唯一问答语料为 R2 `eastmoney/credit/public/` 下直接存放的 PDF。AI Search `credit` 直接索引这些 PDF；Worker 枚举同一前缀生成附件清单，并只接受该清单中的搜索来源和下载请求。`credit/catalog/`、`credit/originals/`、`credit/search/` 的旧文件不进入新问答链路。

AI Search `credit` 的数据源为 R2 `eastmoney`，只包含 `credit/public/**`。中文关键词索引采用 trigram 和 `or` 匹配；问答检索按请求开启重排并取消默认阈值。PDF 仍由 AI Search 直接解析，不另建 Markdown 语料。OCR 转换在现有大 PDF 上超时，当前关闭。AI Search 只调用 `search()`，不调用其生成回答接口。每次检索请求最多 50 个结果；最多 3 轮、每轮最多 3 个并行查询，总共选入 12 个原始片段。检索结果没有证据时明确说明缺口。

更新材料时，只向 `credit/public/` 上传确认可公开的 PDF，核对 AI Search item 完成状态并通过 MCP `/mcp` 的 `search` 工具抽查。不要把文件夹标记、内部资料或旧目录放入索引。

## 问答与会话

界面是单一聊天流，底部直接输入问题，无机构选择、协议标签、材料目录或预设案例。Enter 发送，Shift + Enter 换行，中文输入法确认不发送。空输入拒绝，请求体保留 1 MiB 上限。答复的附件卡片直接下载原件；有确切 PDF 页码的全文来源可打开原页，AI Search 片段仅标记为检索片段，不虚构页码。

按已验证的 `user.auth0Id` 派生一份用户级 CreditAgent SQLite Durable Object 会话；客户端不能提交用户 ID。不同用户隔离，同一用户跨浏览器恢复会话。新对话在同一 DO 中归档原会话，再清空当前上下文。旧的按用户加机构命名的 DO 保留历史，不自动并入公开会话，也不作为新会话的模型上下文。

提交后 `schedule()` 持久化问答任务。统一 AI SSE 只发送纯文本 `progress` reasoning summary、完整终态 `result` 会话或 `error`；不发送正文增量、原始 reasoning、工具 JSON 或引文 ID。summary 在全局 AI 面板显示，聊天只显示当前活动、用时、可展开的处理记录和完成答复。断线重新连接 events，不重复提交。运行中可以起草下一条；刷新后可查看或重试失败问题。

服务端先判断问题范围并规划检索；仅索取原件可直接选当前公开 PDF。其他问题使用 AI Search 检索取证；无结果或不可用时明确资料缺口。每次检索最多等 60 秒，失败后本轮不反复等待。模型只看公开文件名、当前检索证据和该用户会话历史。范围外固定回答“我只能回答授信业务、公司数据及相关资料问题，无法处理与这些内容无关的请求。”资料不足明确列出缺口，不猜测受限或未披露数据。

所有生成与复核共用 `src/lib/server/ai-gateway.ts`：`credit_answer` 固定 `custom-codex/responses`、`gpt-5.6-luna`、`xhigh`、单次尝试。当前提示词在 `src/lib/server/credit-assistant.ts`。模型最多 8 个决策步骤；连续 2 步没有新增证据/计算时仅答复。独立复核最多 2 次；一轮总时限 12 分钟。会话最多 30 轮或约 1 MiB 已保存内容，达到上限提示新建会话。

模型输出、检索结果以同一 DO 的 `credit_run_cache` 检查点保存，不进入 HTTP/SSE。键包含本轮 ID、目录版本、完整输入、Prompt 和 Schema；不跨用户或问题复用。Agents SDK 恢复定时任务时复用已成功持久化的外部调用；尚未持久化的调用可能重做，429 仍不自动重试。活动记录最多 64 条，连续相同事件去重。SSE 心跳每 20 秒检查实例状态，完成即关闭。

## 证据与运行追踪

AI Search PDF 片段没有可核验页码时只标为检索片段。正式审计和披露优先；文件修改时间不代表报告期。答复每段必须引用已读取的连续原文；引用、附件和计算输入只接受当前公开 PDF 的来源 ID。四则运算用 Decimal 和有界语法，输入数值须出现在原文中。复核校验主体、合并范围、报告期和单位；模型复核不代替人工核验。

`worker/credit-agent.ts` 通过 Workers `tracing.enterSpan` 记录 `invoke_agent`、`chat`、`execute_tool`；节点只带固定标签、计数、耗时、错误类别和不透明标识，不记录用户 ID、问题、材料正文、Prompt、推理或答复。失败按模型、材料、时限等类别提示并附本轮 UUID。`credit_operation`、`credit_answer_completed` 和 `credit_answer_failed` 共享 `run_id`。

## HTTP 契约

| 接口 | 用途 |
| --- | --- |
| `GET /api/credit-assistant/materials` | 当前公开材料目录 |
| `GET/HEAD /api/credit-assistant/files/:id` | 当前目录中的公开原件；PDF 支持页码深链和 Range |
| `GET /api/credit-assistant/session` | 当前登录用户的会话与任务状态 |
| `GET /api/credit-assistant/session/events` | 进行中 SSE，结束时返回完整会话 |
| `POST /api/credit-assistant/session` | 提交 `{ "question": "..." }`；普通请求返回 202，SSE 请求直接连接任务 |
| `POST /api/credit-assistant/session/new` | 提交 `{}`，归档当前对话并开始新对话 |
| `DELETE /api/credit-assistant/session` | 删除当前会话；进行中返回 409，UI 不提供此操作 |

所有写操作校验同源。登录与权限由 Gateway 统一校验，经私有 Service Binding 进入 Dashboard；附件只接受当前目录文档 ID，不接受任意对象路径。返回 `private, no-store` 和 `nosniff`，SSE 另用 `no-transform`。不暴露通用 `/agents/*` 路由。

## 验证

本地快速检查：`pnpm check:quick` 及受影响授信问答单元测试。完整类型、Python/Node、构建、浏览器组件和截图比较由合并组 `Dashboard CI` 验收；有意视觉变化先生成并审阅 macOS CI 截图候选。程序化线上联调只用根目录 `.env` 中的 `test@18.cn`；不使用浏览器做权限登录。`scripts/evaluate-credit-assistant.mjs` 支持 `--base-url=https://eastmoney.hasbai.xyz` 和 `--case=...`，问答结果写入未跟踪 `.credit-local/evaluations/`，仍须逐份核对答复和来源。发布、候选与 CI 流程见 [DEVELOPMENT](DEVELOPMENT.md) 和 [TESTING](TESTING.md)。
