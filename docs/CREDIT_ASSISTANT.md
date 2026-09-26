# 授信公开材料与 AI 侧栏

原授信助手页面由全站 AI 侧栏取代。`/credit-workbench/assistant`、`/credit-assistant` 和 `/trading-research/credit-assistant` 重定向到门户并打开侧栏。侧栏中的浏览器 ToolLoopAgent 调用已鉴权的 `/api/ai/responses` 和 `/api/mcp`，可选择只读的 `credit_public_materials`、`credit_public_search` 工具。问答不会向客户发送消息。

## 公开资料边界

材料目录只枚举 R2 `eastmoney/credit/public/` 下的单层 PDF，原件链接使用 URL 编码后的文件名。搜索调用 Cloudflare AI Search `credit` 的 `search()`，最多取 50 个线上片段，并只返回仍在该公开目录中的文件片段，最终工具结果最多 12 个。检索片段没有可核验页码时仅标记“AI Search 检索片段”，不虚构页码。旧 `credit/catalog/`、`credit/originals/`、`credit/search/` 不进入浏览器 Agent 的检索结果。

AI Search 数据源仅索引 `credit/public/**`；中文关键词使用 trigram 和 `or` 匹配，检索开启重排并取消默认阈值。当前 OCR 对部分大 PDF 超时，实例保持关闭。更新材料时只上传确认可公开的 PDF，核对索引完成状态并通过线上 AI Search MCP 抽查。

## 浏览器 Agent

对话、模型工具循环和本地历史在浏览器运行，历史按登录用户隔离。模型调用使用固定的共享 AI Gateway 模型入口；浏览器携带当前用户的同源会话，模型服务凭据只在 Worker。Ask 模式只开放只读工具；Act 模式使用写操作前确认。答复应核对来源中的主体、报告期、母公司或合并口径和单位；证据不足时说明缺口。

## 历史会话兼容

原 CreditAgent HTTP/DO 会话继续提供历史读取、问答和附件下载，不再有独立页面入口。旧接口对每个问题直接调用 AI Search 一次，把检索片段和最近六轮对话交给一次 `credit_answer` 生成答复；它不读取本地语料目录，不做多轮搜索规划或独立复核。会话按已验证的 `user.auth0Id` 隔离，SSE 可恢复运行中或终态结果。

附件下载只访问 `credit/public/` 下的单层 PDF，支持 Range。新链接用文件名；旧会话已保存的 24 位文件 ID 通过公开目录映射到同一 PDF。登录和请求来源校验沿用 Gateway 与 Dashboard 边界，响应使用 `private, no-store`。

| 接口 | 用途 |
| --- | --- |
| `POST /api/ai/responses` | 已鉴权的 Responses 流式模型入口 |
| `POST /api/mcp` | 已鉴权的业务工具与公开授信资料工具 |
| `GET /api/credit-assistant/session` | 历史当前会话 |
| `GET /api/credit-assistant/session/events` | 历史问答 SSE |
| `POST /api/credit-assistant/session` | 提交 `{ "question": "..." }` |
| `POST /api/credit-assistant/session/new` | 提交 `{}` 开始旧接口新会话 |
| `GET/HEAD /api/credit-assistant/files/:filename-or-legacy-id` | 公开 PDF 下载和 Range |

## 验证

本地运行 `pnpm check:quick` 和直接相关的 Node 与浏览器测试。合并队列执行完整 Dashboard CI。上线后使用程序化 HTTP 核对鉴权、模型响应、公开来源与 PDF 下载；不使用浏览器做权限登录。旧会话答复可用 `scripts/evaluate-credit-assistant.mjs` 抽样核对，但不等同于浏览器 Agent 的验收。
