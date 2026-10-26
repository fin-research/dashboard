# 授信查询 skill

个人 skill 安装于 `~/.codex/skills/credit-query/SKILL.md`，执行本仓库 `scripts/query-credit-ai.mjs`。该脚本先调用 Gateway 的 `scripts/lib/programmatic-login.mjs`：HTTP Universal Login → 授权码 + PKCE → 签名及身份验证 → 内存 Access JWT → Bearer GET `/api/credit?view=ai`。token 不输出、不落盘。

```sh
GATEWAY_CHECKOUT=/absolute/path/gateway \
AUTH_TEST_ENV_FILE=/absolute/path/eastmoney/.env \
node --use-env-proxy scripts/query-credit-ai.mjs --date 2026-10-26
```

省略日期使用上海当天；`--institution-id 123` 按稳定 ID 筛选。脚本严格校验 API 输出，若包含非白名单字段则失败，不输出原响应。

Gateway 当前 helper 只允许项目约定的 `test@18.cn`，凭据为项目组未跟踪 `.env` 中 `AUTH_TEST_EMAIL`、`AUTH_TEST_PASSWORD`。工作树使用上方两个绝对路径变量。登录最多提交一次密码；MFA、验证码、资料或邮箱验证阻断时报告错误码，不改认证、不重试密码，也不改用管理/机器 token。401 需重新登录，403 需具备 `credit.institution:read`，不得回退完整台账、直接数据库或其它名称映射接口。

金额单位、缺失值、状态与脱敏字段见[授信工作台](../modules/credit-workbench.md#接口与维护)。工具只读取；汇总有效额度与用量时采用 `status=approved` 的同一机构集合，参与值缺失不能当零。总额为零时使用率缺失，不将各分项额度相加当总授信。
