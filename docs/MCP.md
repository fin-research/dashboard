# Dashboard MCP

客户端直接连接 `https://eastmoney.hasbai.xyz/api/mcp`，不经过 Cloudflare MCP Portal，不加 `dashboard_` 前缀。

## 连接

- 协议：Streamable HTTP。
- 认证：正常 Auth0 用户登录取得的本站 API access token，以 `Authorization: Bearer <token>` 发送。ID token 不可用。
- Gateway 校验用户身份与权限，Dashboard 只接收私有入口注入的身份。
- 当前不提供 MCP OAuth discovery 或动态客户端注册，不能仅填写 URL 自动登录。支持自定义 Bearer header 的客户端可直接连接。

Codex 配置：

```toml
[mcp_servers.eastmoney]
url = "https://eastmoney.hasbai.xyz/api/mcp"
bearer_token_env_var = "EASTMONEY_ACCESS_TOKEN"
```

`EASTMONEY_ACCESS_TOKEN` 由客户端环境提供。不要把 token 写入配置文件或提交到仓库；过期后重新登录取得。

## 发布范围

当前仅发布 `credit_report`，输入为可选的 `query.date`、`query.institutionId`。该工具固定调用 `/api/credit?view=masked`，读取 `credit.masked_as_of`，机构标识只保留 ID。完整机构资料、客户名称与自由文本不进入返回结果。

```json
{"name":"credit_report","arguments":{"query":{"date":"2026-10-26"}}}
```

其余 catalog 定义保留待审核，但不注册、不出现在 `tools/list`，直接调用也会拒绝。`health`、公开材料清单与检索同样不发布。其他工具完成脱敏审核后再逐项发布，不提供旧名称或前缀别名。站内 AI 侧栏共用此端点，遵循同一发布范围。

## 实现与权限

- SvelteKit `src/routes/api/mcp/+server.ts` 使用现有 Agents `createMcpHandler` 与 MCP SDK，每次请求创建独立 server。
- `src/lib/server/mcp.ts` 的发布白名单限定工具范围，Gateway 的 `/mcp/policies` 检查当前用户真实路由权限。无授信读取权限时目录为空。
- 执行经 IDENTITY 私有 `/mcp/dispatch` 再检查当前权限及 token 到期时间，然后调用原业务接口。权限撤销后旧目录不能继续授权。
- 不接受任意 URL、身份、请求头或 SQL，不转发用户 token，不新增公网 Worker 或认证旁路。
- 请求上限 1 MiB，响应上限 8 MiB。业务接口的输入校验与脱敏字段白名单继续生效。

字段与数值口径见[授信工作台](modules/credit-workbench.md#接口与维护)。Auth0 与 Gateway 边界见[共享认证](../../eastmoney/docs/AUTH.md)。

## 验证

- `node --test tests/mcp.test.mjs tests/credit-masked.test.mjs`：实际 SDK 发现/调用、精确单工具目录、所有未发布工具拒绝、输入校验、脱敏 SQL/接口与字段白名单。
- 构建后 `GATEWAY_CHECKOUT=<gateway-worktree> node scripts/verify-mcp-integration.mjs`：真实 Gateway → 构建 SvelteKit → 私有授权桥接，检查单工具目录、未发布工具拒绝、参数校验与权限撤销；外部服务使用内存夹具。
- 生产只读验收使用 Gateway 既有程序化正常登录，携带 API Bearer 直连本端点，核对目录仅 `credit_report` 并执行查询。禁止浏览器权限验收。
