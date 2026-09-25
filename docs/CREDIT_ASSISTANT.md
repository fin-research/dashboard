# 授信助手

入口为 `/credit-workbench/assistant`；旧 `/credit-assistant` 和 `/trading-research/credit-assistant` 重定向到该入口。面向内部同事生成供客户使用的答复和资料来源，不自动向客户发送消息。

## 公开资料边界

唯一问答语料为 R2 `eastmoney/credit/`：`originals/` 存公开原件，`search/` 存供 AI Search 索引的 Markdown，`catalog/corpus.json` 存当前公开目录与本地全文证据。公开材料仅限原件路径位于顶层 `定期报告/`、路径与目录一致的文件；审计或披露标签本身不扩大公开范围。准备脚本只解析这个目录，上传脚本再次按此路径筛选，Worker 加载目录时拒绝任何非公开文档或悬空证据。旧 R2 `credit` 桶不再绑定到生产 Worker。

AI Search `credit` 的数据源为 R2 `eastmoney`，只包含 `credit/search/**`，排除原件与目录；发布脚本只允许该前缀下的顶层 `定期报告/` 公开材料。原件、搜索文本和目录分别验证 SHA-256；目录发布和索引完成分别验收。搜索返回的 key 去掉 `credit/` 前缀后必须匹配当前目录中的搜索文件，否则不能作为答复证据。AI Search 只调用 `search()`，不调用其生成回答接口。每次检索请求 50 个结果；最多 3 轮、每轮最多 3 个并行查询，总共选入 12 个完整片段。

线上迁移先运行 `node scripts/migrate-public-credit.mjs` 只读盘点，再使用 `--apply` 复制并校验公开对象、发布公开目录、切换 AI Search 数据源并启动索引。代码经合并队列和 Cloudflare Git 发布、线上读取及检索验证通过后，运行 `--apply --remove-source` 从旧 `credit` 桶删除已迁出的公开对象并更新旧目录；旧桶的其余资料不进入新问答链路。后续更新使用 `scripts/prepare-credit-corpus.py` 和 `scripts/upload-credit-corpus.mjs`，只发布公开目录。材料原件、全文和本地证据不提交 Git。

## 问答与会话

界面是单一聊天流，底部直接输入问题，无机构选择、协议标签、材料目录或预设案例。Enter 发送，Shift + Enter 换行，中文输入法确认不发送。空输入拒绝，请求体保留 1 MiB 上限。答复的附件卡片直接下载原件；有确切 PDF 页码的全文来源可打开原页，AI Search 片段仅标记为检索片段，不虚构页码。

按已验证的 `user.auth0Id` 派生一份用户级 CreditAgent SQLite Durable Object 会话；客户端不能提交用户 ID。不同用户隔离，同一用户跨浏览器恢复会话。新对话在同一 DO 中归档原会话，再清空当前上下文。旧的按用户加机构命名的 DO 保留历史，不自动并入公开会话，也不作为新会话的模型上下文。

提交后 `schedule()` 持久化问答任务。统一 AI SSE 只发送纯文本 `progress` reasoning summary、完整终态 `result` 会话或 `error`；不发送正文增量、原始 reasoning、工具 JSON 或引文 ID。summary 在全局 AI 面板显示，聊天只显示当前活动、用时、可展开的处理记录和完成答复。断线重新连接 events，不重复提交。运行中可以起草下一条；刷新后可查看或重试失败问题。

服务端先判断问题范围并规划检索；仅索取原件可直接选当前目录的文档 ID。其他问题经语义检索取证，AI Search 无结果或不可用时回退当前公开目录的全文关键词检索。每次语义检索最多等 60 秒，失败后本轮不反复等待。模型只看公开目录、当前读取证据和该用户公开会话历史。范围外固定回答“我只能回答授信业务、公司数据及相关资料问题，无法处理与这些内容无关的请求。”资料不足明确列出缺口，不猜测受限或未披露数据。

所有生成与复核共用 `src/lib/server/ai-gateway.ts`：`credit_answer` 固定 `custom-codex/responses`、`gpt-5.6-luna`、`xhigh`、单次尝试。当前提示词在 `src/lib/server/credit-assistant.ts`。模型最多 8 个决策步骤；连续 2 步没有新增证据/计算时仅答复。独立复核最多 2 次；一轮总时限 12 分钟。会话最多 30 轮或约 1 MiB 已保存内容，达到上限提示新建会话。

模型输出、检索结果以同一 DO 的 `credit_run_cache` 检查点保存，不进入 HTTP/SSE。键包含本轮 ID、目录版本、完整输入、Prompt 和 Schema；不跨用户或问题复用。Agents SDK 恢复定时任务时复用已成功持久化的外部调用；尚未持久化的调用可能重做，429 仍不自动重试。活动记录最多 64 条，连续相同事件去重。SSE 心跳每 20 秒检查实例状态，完成即关闭。

## 证据与运行追踪

PDF 按实际页码定位；扫描页标注 OCR。Word 保留段落与表格顺序，Excel/XLS 保留工作表、行、单元格、单位、公式及缓存值。正式审计和披露优先；文件修改时间不代表报告期。答复每段必须引用已读取的连续原文；引用、附件和计算输入只接受当前目录中的 ID。四则运算用 Decimal 和有界语法，输入数值须出现在原文中。复核校验主体、合并范围、报告期和单位；模型复核不代替人工核验。

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

转换与目录测试：`uv run tests/test_credit_materials.py`。本地快速检查：`pnpm worker:typegen`、`pnpm check:quick` 及受影响授信问答单元测试。完整类型、Python/Node、构建、浏览器组件和截图比较由合并组 `Dashboard CI` 验收；有意视觉变化先生成并审阅 macOS CI 截图候选。程序化线上联调只用根目录 `.env` 中的 `test@18.cn`；不使用浏览器做权限登录。`scripts/evaluate-credit-assistant.mjs` 支持 `--base-url=https://eastmoney.hasbai.xyz` 和 `--case=...`，问答结果写入未跟踪 `.credit-local/evaluations/`，仍须逐份核对答复和来源。发布、候选与 CI 流程见 [DEVELOPMENT](DEVELOPMENT.md) 和 [TESTING](TESTING.md)。
