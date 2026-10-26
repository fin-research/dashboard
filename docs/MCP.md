# Dashboard MCP

客户端直接连接 `https://eastmoney.hasbai.xyz/api/mcp`，不经过 Cloudflare MCP Portal，不加 `dashboard_` 前缀。

## 连接

- 协议：Streamable HTTP。
- 认证：Auth0 OAuth 授权码 + PKCE，客户端打开正常登录页，保存并刷新本站 API access token。ID token 不可用。
- Gateway 校验用户身份与权限，Dashboard 只接收私有入口注入的身份。
- Gateway 通过公开 `/.well-known/oauth-protected-resource/api/mcp` 和 401 `WWW-Authenticate` 提供 OAuth 发现，授权服务器为 `https://auth.hasbai.xyz/`。resource 为现有本站 API 标识 `https://eastmoney.hasbai.xyz/`。
- 使用预注册 public client `M1a5PF3UJaFIZv1k4HO4IV06Z5fXQBHV`，无需 client secret；DCR 未开放。Auth0 限定 Eastmoney 组织，refresh token 轮换，最长30天、闲置7天。回调精确登记。

Codex 配置：

```toml
[mcp_servers.eastmoney]
url = "https://eastmoney.hasbai.xyz/api/mcp"
scopes = ["openid", "profile", "email", "offline_access"]

[mcp_servers.eastmoney.oauth]
client_id = "M1a5PF3UJaFIZv1k4HO4IV06Z5fXQBHV"
resource = "https://eastmoney.hasbai.xyz/"
callback_port = 53682
```

配置后执行 `codex mcp login eastmoney`。当前 Codex 回调已登记为 `http://127.0.0.1:53682/callback/DOYLirtr9DIq`，不要给端点追加斜杠或查询参数；客户端据完整 URL 计算 callback ID。该配置和回调选择已由当前 CLI 授权请求核对，登录/刷新/工具读取由程序化 HTTP 实测。

ChatGPT 连接选择 OAuth，填写同一 URL 和 client ID，client secret 留空。已登记固定回调 `https://chatgpt.com/connector_platform_oauth_redirect`；若管理页显示该连接专属 `/connector/oauth/...` 回调，先按该精确地址登记，再连接，不使用路径通配符。尚未验收 ChatGPT 界面连接。

现有 API Bearer 调用仍按正常用户权限校验；MCP 专用 client 的 token 不能用于普通业务 REST。客户端配置参考 [OpenAI MCP](https://learn.chatgpt.com/docs/extend/mcp#configure-with-configtoml)。

## 发布范围

`credit_report` 输入为可选的 `query.date`、`query.institutionId`。该工具固定调用 `/api/credit?view=masked`，读取 `credit.masked_as_of`，机构标识只保留 ID。完整机构资料、客户名称与自由文本不进入返回结果。

```json
{"name":"credit_report","arguments":{"query":{"date":"2026-10-26"}}}
```

市场研究已发布：`market_report`、`save_market_report`、`hotspots`、`policies`、`policy_articles`、`update_policy_articles`、`article`、`news`、`commentaries`、`commentary`、`commentary_revisions`、`create_commentary`、`update_commentary`、`economic_indicators`。加上 `credit_report` 共 15 个候选工具，实际目录由当前用户权限筛选。

标准点评使用统一 `/api/commentaries` 和 `commentary` 主数据。MCP 对读取、创建、修改及历史版本结果执行字段投影，不输出原稿、导入文件名、PDF 存储 key 或工作区检索元数据。修订须带 `updatedAt`，冲突返回原业务错误。

所有 AI 生成工具均从 catalog 删除，MCP 不调用另一层生成模型。网站原生成操作仍由网站显式发起。其他未审核业务工具不注册；不提供旧点评名称或前缀别名。站内 AI 侧栏共用同一目录。

## 实现与权限

- SvelteKit `src/routes/api/mcp/+server.ts` 使用现有 Agents `createMcpHandler` 与 MCP SDK，每次请求创建独立 server。
- `src/lib/server/mcp.ts` 的发布白名单限定工具范围，Gateway 的 `/mcp/policies` 检查当前用户真实路由权限。各工具分别受真实路由权限约束；市场定稿读取沿用公开只读规则。
- 执行经 IDENTITY 私有 `/mcp/dispatch` 再检查当前权限及 token 到期时间，然后调用原业务接口。权限撤销后旧目录不能继续授权。
- 不接受任意 URL、身份、请求头或 SQL，不转发用户 token，不新增公网 Worker 或认证旁路。
- 请求上限 1 MiB，响应上限 8 MiB。业务接口的输入校验与脱敏字段白名单继续生效。

字段与数值口径见[授信工作台](modules/credit-workbench.md#接口与维护)。Auth0 与 Gateway 边界见[共享认证](../../eastmoney/docs/AUTH.md)。

## 验证

- `node --test tests/mcp.test.mjs tests/credit-masked.test.mjs`：实际 SDK 发现/调用、精确发布白名单、所有未发布工具拒绝、输入校验、脱敏 SQL/接口与字段白名单。
- 构建后 `GATEWAY_CHECKOUT=<gateway-worktree> node scripts/verify-mcp-integration.mjs`：真实 Gateway → 构建 SvelteKit → 私有授权桥接，检查发布目录、未发布工具拒绝、参数校验与权限撤销；外部服务使用内存夹具。
- 生产只读验收使用 Gateway 既有程序化正常登录，携带 API Bearer 直连本端点，核对当前权限下的 15 项候选目录并执行查询，旧名称及生成工具须拒绝。禁止浏览器权限验收。
