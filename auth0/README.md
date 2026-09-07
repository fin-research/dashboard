# Auth0 中文主题与注册资料

此目录管理 `hasbai.eu.auth0.com` 的资金管理平台登录配置。继续使用 New Universal Login，Auth0 负责密码和身份验证，Access 回调与稳定账号 ID 保持原契约。

## 中文主题

- `branding/theme.json` 映射 `DESIGN.md`：品牌蓝 `#2f6fd6`、冷灰 `#f6f8fb`、白色卡片、8px 控件和 10px 卡片圆角。
- `branding/zh-CN.json` 管理登录、注册和密码重置的中文文案；其余错误及验证文案由 Auth0 内置中文翻译提供。
- 仅启用 `zh-CN`，确保英文浏览器也显示中文。主题和语言是 Auth0 租户级配置。
- `node --use-env-proxy scripts/publish-auth0-branding.mjs` 读取现状并输出计划；加 `--apply` 发布并回读验证。发布前在系统临时目录保存不含密钥的配置备份，输出备份目录。
- `node --use-env-proxy scripts/verify-auth0-branding.mjs` 用英文浏览器语言请求登录、注册页，检查实际 HTML 的中文与配色，不提交登录／注册，也不打印 Cookie 或事务 URL。这是 HTTP 检查，不是浏览器视觉验收。

## 注册字段（自定义域名就绪后启用）

Auth0 官方要求自定义域名和 Page Template 才能在新版注册页使用 Partials。尚未配置自定义域名时，保留线上原注册流程，不能提前发布要求新字段的 Pre Registration Action。

| 字段 | 必填与校验 | Auth0 存储 |
| --- | --- | --- |
| 邮箱 | `18.cn`，既有服务端校验 | `email` |
| 密码 | 既有 Auth0 密码策略 | Auth0 密码凭证 |
| 姓名 | 去除首尾空白，1–50 字符 | `user_metadata.name`；首次登录同步 `name`、`nickname` |
| 部门 | 去除首尾空白，1–100 字符 | `user_metadata.department` |

姓名作为显示用户名，允许同名用户；邮箱仍为登录标识，不增加要求唯一的 `username` 凭证。部门由 Auth0 用户详情的 User Metadata 管理。姓名和部门不授予融资角色或关联业务人员。

`eastmoney-registration.cjs` 保留邮箱域名校验，验证表单后存入资料，并设置服务端标记 `app_metadata.eastmoney_signup_profile_pending`。独立 `eastmoney-signup-profile.cjs` 在原登录 Action 前同步根级姓名；成功后清除标记。失败保留标记供下次登录重试，现有账号和之后的姓名编辑不触发重复覆盖。同步使用独立 M2M 应用，仅授予 `update:users`；密钥通过 Auth0 Action Secrets 保存，不使用或轮换 Worker 密钥。

启用顺序：

1. 确认登录域名，在 Auth0 配置并验证 Custom Domain；完成必要 DNS 配置，并确认套餐支持 Page Template／Partials。不自动购买或升级套餐。
2. 将 Access 中 `eastmoney Auth0` 的授权端点切换到已验证域名，并同步核对 issuer、token、JWKS 与退出域名；保留当前回调白名单。
3. 先通过只读登录检查确认站点入口会到达自定义域名。
4. 执行 `node --use-env-proxy scripts/publish-auth0-signup.mjs --login-domain=<已确认域名>` 查看计划，加 `--apply` 发布。脚本先配置根级姓名同步，再配置页面与字段，最后发布必填校验；保留其他绑定并拒绝覆盖不认识的草稿／页面。
5. 运行 `node --use-env-proxy scripts/verify-auth0-branding.mjs --login-domain=<已确认域名>`，再用明确授权的测试账号验收完整注册、邮箱验证和资料回读。

模板与表单仅对 `eastmoney` 应用显示。当前 `signup` 使用同页邮箱、密码表单；若改成 identifier-first，须同时迁移 `signup-id`／`signup-password` Partials，不能只切换 Auth0 prompt 设置。

## 参考

- [Auth0 自定义注册字段的前提与存储方式](https://auth0.com/docs/customize/login-pages/universal-login/customize-signup-and-login-prompts)
- [Auth0 中文文案字段契约](https://auth0.com/docs/customize/login-pages/universal-login/customize-text-elements)
- [Auth0 注册前 Action API](https://auth0.com/docs/actions/reference/pre-user-registration/pre-user-registration-api-object)
