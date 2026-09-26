# Dashboard MCP

业务 MCP 上游为 `https://eastmoney.hasbai.xyz/api/mcp`，统一客户端入口仍为 Cloudflare Portal `https://mcp.hasbai.xyz/mcp`。Portal 的 `dashboard` 上游使用逐用户 Auth0 OAuth（`on_behalf=true`），工具名自动加 `dashboard_` 前缀。

全站 AI 侧栏的浏览器端 ToolLoopAgent 通过同源 `/api/mcp` 读取当前用户可见工具并执行；Ask 只加载只读工具，Act 中的修改或生成操作仍须在面板逐次确认。`credit_public_materials` 和 `credit_public_search` 仅访问 `credit/public/` 当前 PDF 清单及其 AI Search 命中片段，片段不标注虚构页码。原 `ask_credit_assistant` 和 `credit_session` 已从 MCP 目录退出，旧 HTTP/DO 仅保留历史兼容。

## 实现与权限

- SvelteKit `src/routes/api/mcp/+server.ts` 使用项目已有 Cloudflare Agents 的 `createMcpHandler` 和 MCP SDK v2；兼容 2026-07-28 发现协议及旧版初始化/Streamable HTTP。Svelte 官方开发文档 MCP 不提供本站业务能力。
- 每次请求创建独立 server，使用 Gateway 注入的 `locals.user`；没有共享用户 token、持久 MCP 会话或新的公网 Worker。
- Gateway 只在 `/api/mcp` 和 `/data/mcp` 接受专用 Portal client token；网站普通 REST、管理接口和 Quant 权限保持原边界。Cookie 调用保留同源检查，无 Origin 的 Bearer MCP 客户端可调用；带外站 Origin 仍拒绝。
- 工具目录通过私有 IDENTITY `/mcp/policies` 批量查询 Gateway 的真实路由权限。执行时经 `/mcp/dispatch` 再检查当前权限及 token 到期时间，再调用 `GatewayDashboard` 原接口。权限变化后旧工具目录不能继续授权写入。
- REST 输入 Schema 尽可能直接复用业务 Zod；融资页面读取使用 SvelteKit 数据协议，写操作使用网站原 named action。原业务校验、主键、版本冲突、RLS、本人任务和授信材料保密规则继续生效。
- MCP 不接受任意 URL、身份、请求头或 SQL。私有桥接禁止 MCP 递归、外部地址、个人凭据和消息投递接口；客户端不能公开访问桥接。

## 工具范围

事实来源为 `src/lib/server/mcp-catalog.ts`；`tools/list` 只列当前用户获准工具，各输入字段由 Schema 展示。

| 领域 | 查询 | 修改与生成 |
|---|---|---|
| 市场研究 | 定稿、热点、政策、研报/新闻/点评、跟踪版本、经济指标 | 保存定稿、关联研报、编辑点评、AI 今日聚焦/热点/政策点评/跟踪点评 |
| 授信 | 报表、日历、客户、本人客户问答会话 | 新增/修改机构、AI 授信问答 |
| 二级池 | 台账清单、区间周报、导入状态 | 按日报日删除台账 |
| 融资择时 | 模型报告、决策历史 | 更新结论、保存决策、AI 卖方观点与总结编辑 |
| 交易流程 | 配置、本人当日进度 | 保存配置、更新本人进度 |
| 融资业务 | 总览、项目/任务、SOP、客户、投资人、台账、负债周报 | 项目创建/更新/删除、任务维护、SOP 节点维护、客户维护、白名单台账增删改 |
| 资金日报 | 历史列表、指定日期 HTML | 文件上传沿用网站 |

二级池查询的 `start`/`end` 读取结构化周报；Excel 原件下载/上传、附件/PDF 二进制传输沿用网站。MCP 不新增手动消息发送工具。AI SSE 只把终态业务结果交给 MCP，错误或流中断返回 `isError`。输入上限 1 MiB，响应上限 8 MiB；不自动重试写入或生成，连接中断时应先读取当前记录/历史再决定是否重试。

所有非只读操作具有 `readOnlyHint=false`、`destructiveHint=true`、`idempotentHint=false`，AI 具有 `openWorldHint=true`。这些是客户端提示，不代替服务端授权。客户端执行修改和生成仍应根据用户明确意图选择工具。

## 验证与配置

- 本地 `node --test tests/mcp.test.mjs` 覆盖实际 MCP SDK 工具发现/调用、目录过滤、输入校验、命名 action 编码、Svelte 数据解码、AI SSE 成功/错误/中断和响应限长。
- 构建后 `GATEWAY_CHECKOUT=<gateway-worktree> node scripts/verify-mcp-integration.mjs` 覆盖实际 Gateway → 构建 SvelteKit → 私有授权桥接 → 原业务 handler，验证页面读取、交易进度写入回读、named action 校验和权限撤销；外部数据使用内存夹具。
- Gateway `tests/dashboard-mcp.test.mjs` 覆盖用户/机器/匿名与 CSRF 边界、凭据移除、当前权限撤销、路由/命名 action 再授权及拒绝外部/递归目标。
- Gateway 先发布授权桥接，再经 Dashboard 合并队列验证和 Git 自动部署。Portal 配置与程序化 Auth0 验收见 [Gateway MCP](../../gateway/docs/MCP.md)。
- 真实门户验收：Gateway 的 Keychain 任务凭据子进程运行 `scripts/configure-mcp-portal.mjs dashboard`，再运行 `scripts/verify-managed-mcp.mjs --dashboard --check-catalog`。只对测试账号逐用户授权；不替换 Data/研究库配置。
