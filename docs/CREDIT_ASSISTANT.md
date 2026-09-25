# 授信助手

入口为 `/credit-workbench/assistant`；旧 `/credit-assistant` 和 `/trading-research/credit-assistant` 重定向到该入口。页面保留一条用户对话流，没有机构选择和材料目录。

## 检索与答复

每个问题直接调用 Cloudflare AI Search `credit` 的 `search()`，最多取 50 个线上索引片段；不读取本地语料目录，不查询客户或保密协议，不做范围分类、多轮搜索规划、计算工具或独立复核。搜索结果与最近六轮对话交给一次 `credit_answer` 模型调用生成答复。模型沿用共享 AI Gateway 的单次尝试策略。

答复可引用 AI Search 片段并附上对应原始 PDF；数字和口径在片段中不足以确认时直接说明缺口。检索片段没有可核验页码时不生成页码。AI Search 实例仅索引 `credit/public/**`，当前用 trigram 关键词索引、`or` 匹配；OCR 对部分大 PDF 超时，实例保持关闭。线上检索可通过 `https://eastmoney-credit-search.hasbai.xyz/mcp` 的 `search` 工具核对。

## 会话与文件

登录身份只用于隔离会话。客户端只提交 `{ "question": "..." }`；用户级 CreditAgent 保存对话，新对话归档上一条对话。SSE 的 `progress` 是当前处理摘要，`result` 是完整终态会话；中断后重新连接当前会话。问答不向客户发送消息。

附件下载只接受 `credit/public/` 下的单层 PDF 文件名，支持 Range；链接来自 AI Search 返回的文件 key。不提供材料目录接口，也不依赖旧 `credit/catalog/`、`credit/originals/` 或 `credit/search/` 文件。

| 接口 | 用途 |
| --- | --- |
| `GET /api/credit-assistant/session` | 当前登录用户的会话 |
| `GET /api/credit-assistant/session/events` | 运行中的 SSE 或终态会话 |
| `POST /api/credit-assistant/session` | 提交 `{ "question": "..." }` |
| `POST /api/credit-assistant/session/new` | 提交 `{}`，新建对话 |
| `GET/HEAD /api/credit-assistant/files/:filename` | 公开 PDF 下载和 Range |

登录与请求来源校验沿用 Gateway 和 Dashboard 的通用边界；不再做授信客户级权限或保密协议判断。所有响应使用 `private, no-store`。

## 验证

本地运行 `pnpm check:quick` 和授信助手直接相关的 Node 测试。合并队列完整运行 Dashboard CI。上线后用程序化 HTTP 验证一次问答的正文、来源与 PDF 下载，并用线上 AI Search MCP 对照检索结果；不能把索引状态正常等同于答复验收通过。
