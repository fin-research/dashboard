# 管理中心与账号

入口：`/management、/profile、/management/people、/management/financing-profile`。公共规则见 [文档分流](../INDEX.md)；仅在任务涉及本模块时读取。

## 接口

- `GET /auth/verify-email`：公开的注册邮箱验证提示页，返回 200、`no-store, private` 和 `Referrer-Policy: no-referrer`。提示用户检查邮件，完成验证后从 `/auth/login?returnTo=%2Fprofile` 开始新登录；查询中的邮箱、错误文本和 Auth0 事务状态均不反射到页面。
- `GET /auth/session`：返回当前 Access 会话；匿名用户的 `user` 为 `null`，供页面跳转和上传前检查。所有身份响应禁止缓存。
- `GET /profile`：需登录，展示个人资料、邮箱、密码重置入口、只读角色权限和原有浏览器个性化设置。
- `GET /api/profile`：仅返回当前账号的姓名、邮箱、邮箱验证状态、已分配角色与权限；不返回管理令牌、身份提供方凭证或内部 metadata。
- `POST /api/profile`：JSON 请求体上限 4 KiB，严格只接受 `action=name` 与 `name`（1–50 字），或 `action=email`、`email`（18.cn 邮箱）与 `confirmed=true`，或 `action=password`。不得指定用户 ID、角色、权限或自定义字段。
- 姓名更新回传服务端确认的姓名；邮箱更新清除验证状态、请求验证邮件并回传 `logout=true`，前端完成统一退出；密码操作只向当前账号请求 Auth0 密码重置邮件。
- 同源浏览器请求收到 HTTP 401 时统一整页跳转 `/auth/login`，保留当前安全页面路径、查询和锚点；403 保持权限错误。SvelteKit 页面数据请求返回框架的登录重定向协议，直接页面请求返回 303。登录接口及 Cloudflare 路径不能作为回跳目标。
- Auth0 上游管理凭证失效映射为 503，不冒充当前用户未登录。

## 业务：人员与账号

- `people` 是责任人、业务角色和系统访问的统一主档。
- 业务角色为 `admin`、`handler`、`reviewer`。登录账号由可选的 `auth0_user_id` 明确关联 Auth0；原 `people.id` 和业务归属保持不变。
- 登录标识为唯一邮箱；个人设置可改显示姓名、头像和密码，邮箱由管理员维护。
- 停用人员不能登录或作为有效业务人员；系统必须至少保留一个启用中的管理员。
- 角色权限按 `project_manage`、`own_task_update`、`sop_manage`、`people_manage`、`data_manage`、`report_generate`、`permission_manage` 七类配置；内部测试初始状态为三种角色全量授权。
- 人员和登录账号由具有“人员与账号”权限的角色维护；不能停用或删除当前用户，且系统必须保留至少一个启用中的管理员账号。

## 页面：Identity and Navigation

- 人员与权限使用同一人员主档承接项目责任、业务角色和可选登录账号，不建立第二套人员列表。
- 人员页以三张角色卡配置七类权限；每张卡独立全选、清空和保存，显示已授权数量，移动端自然堆叠且不产生页面级横向滚动。
- 没有 `permission_manage` 时只展示明确的只读说明；没有具体管理权限时，对应页面隐藏写入控件，服务端仍独立校验。

## 统一管理入口

`/management` 为 Dashboard 管理中心，`?upload=1` 保留旧资金日报上传书签。全站个人信息、邮箱、密码和显示偏好由 `/profile` 管理。`/management/people` 承接原融资人员、Auth0 账号关联、启停、角色和七类权限管理；`/management/financing-profile` 仅在页面展示融资人员名称和头像维护，登录密码入口跳往 `/profile`。

旧 `/financing/people`、`/financing/settings` 使用 307 跳转到对应管理页，保留查询与 POST body。人员主档仍为 `financing.people`，不能按邮箱自动关联。管理中心与个人信息只需中央 Access 登录；人员管理及融资人员资料额外经过原融资身份和权限校验。用户无融资关联时仍能使用其他 Dashboard 模块。

管理页的 `+layout.server.ts` 使用 `financing:identity` 和 `financing:permissions` 依赖，账号修改仍只返回服务端确认的增量。
