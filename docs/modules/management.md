# 管理中心与账号

入口：`/management`、`/management/people`、`/profile`。身份与授权公共规则见 [SECURITY](../SECURITY.md)。

## 统一职责

- Gateway 负责认证、实时角色权限、账号目录与权限配置，Dashboard 只保留页面及私有服务转发。
- Auth0 管理用户、角色、角色成员、姓名、邮箱、停用状态和密码。应用不创建或维护人员表、角色表和成员关系表。
- `authorization.permission` 保存全站权限目录，代码格式为 `<domain>.<resource>:<action>`；`authorization.role_permission` 只保存 Auth0 角色 ID 与权限的授权关系。
- `/management/people` 沿用管理中心现有入口，页面名称为“角色权限配置”。角色列表实时来自 Auth0；用户及角色维护链接指向 Auth0 控制台。
- 融资项目负责人、任务执行人、周报生成人直接保存 Auth0 用户 ID；SOP 默认角色保存 Auth0 角色 ID。姓名和角色从请求内 Gateway 目录解析，不按邮箱或姓名自动绑定。
- 原融资人员、权限、审计表及运行时审计流程已移除。审计后续独立规划。

## 角色权限配置

- 读取需要 `auth.permission:read`，保存需要 `auth.permission:update`。后台按照市场研究、二级池、授信、资金日报、模型、融资、个人账号、权限管理及数据服务分组。
- 支持任意 Auth0 角色、多角色成员、权限搜索、全选、清空、分组选取、撤销修改和单角色保存。未保存选择在切换角色和保存失败后保留。
- 保存提交角色 ID、权限代码列表及版本，严格限制请求体和字段。Gateway 重新确认 Auth0 角色存在，在数据库事务中锁定角色、比对版本并保存；并发冲突返回 409，不能覆盖他人的配置。
- 清空角色保存所有权限的 `granted=false`，不会被当作“未初始化”重新授予权限。配置不向 Auth0 写入 permissions，也不使用旧融资 API permissions。
- `AUTHORIZATION_MODE=beta-open` 为当前内测模式：所有通过身份校验的登录账号均获得整个目录的权限，包括未分配角色的账号；后台保存配置但不限制其当前使用。页面明确标示该模式。
- `AUTHORIZATION_MODE=enforce` 时按当前 Auth0 角色 ID 查询授权，并合并多个角色的权限；无角色、无配置或未授予的权限默认拒绝。模式只能由部署配置切换，未知值失败关闭。

## 个人信息

- `GET /auth/session` 返回一次性前端会话快照：原有 `user`、`enabled`，以及 `account`、最小角色 `roles`、有效权限 `permissions` 和到期秒数 `expiresAt`。匿名返回 null 身份、空角色/权限，不查询 Auth0；已登录快照通过统一授权入口解析，不另建角色权限系统。不返回 JWT、Cookie、密钥或内部 metadata。
- `/profile` 和 `GET /api/profile` 使用 `account.profile:read`；`POST /api/profile` 使用 `account.profile:update`。
- 个人信息仅操作已验证的 Auth0 ID。每次读写核对当前账号、邮箱和连接；不接受目标用户 ID、角色、权限或 app_metadata。
- 修改姓名、18.cn 邮箱及密码重置仍使用原有白名单和本人确认流程。修改邮箱后要求重新登录；密码只通过 Auth0 邮件重置。
- 权限显示使用统一授权结果，内测显示当前全部有效权限，不再展示旧 Auth0 融资权限或硬编码通用权限。
- `/management/financing-profile` 和 `/financing/settings` 跳转 `/profile`；旧 `/financing/avatar` 返回 410。融资不再维护独立姓名和头像。

## 页面与入口

- 首页提供独立“管理”模块；管理总览采用角色权限、个人管理、资金日报三张入口卡片。管理使用全站工作台外壳和 daisyUI，不依赖融资模块的样式作用域。
- 角色权限页为角色目录加权限编辑区，支持角色检索、权限检索、组内选择、计数和未保存状态。宽屏分栏，窄屏角色目录在权限编辑区之前；保存条在宽屏内容区内保持可见。原有权限、版本比对和草稿保留契约不变。
- 全站个人入口显示图标、姓名和部门，只读取根 layout 的会话 context。受保护首屏直接使用服务端快照；公共页由根 layout 后台初始化一次。菜单重建、标签切换、上传前检查均复用同一快照，不再独立请求 `/auth/session`。
- 个人管理页显示姓名和只读部门，继续提供既有姓名、邮箱、密码及行情偏好操作。保存姓名后只失效 `site:session` 更新账号展示；保存角色权限后明确刷新一次当前账号快照，不失效其他业务页数据。

## 原页面登录与操作预检

- 根 layout 挂载唯一 `LoginDialog`。匿名点击受保护页面、原生表单或已登记 API 操作时，前端先读取共享会话快照；需要登录则打开站内提示框，权限不足则通过全局消息提示。
- 提示框按钮同步打开 Auth0 Universal Login 窗口，继续使用 Gateway 授权码 + PKCE。登录结束后只回传绑定事务的完成信号，根 layout 强制读取 `/auth/session` 更新姓名、部门及权限，再通过 `goto` 继续目标页面；不调用 `location.assign/reload` 或失效全部业务数据。
- 弹窗被拦截、取消、失败或超时时保留原页和输入，可重新打开；同一时刻的登录请求共用一个提示框。`postMessage` 校验本站 origin、窗口来源及事务 ID；同源 BroadcastChannel 兼容登录方隔离 opener，所有信号都必须经服务器会话核实。
- 操作预检复用 Gateway 生成的路径、方法和 named action 权限契约，不替代服务端实时授权。未发送的请求可在登录后继续；后台返回 401 时读取最多重试一次，写入不自动重发。后台 403 就地提示并更新权限快照。
- 浏览器会话和本站 Auth0 API 令牌设为 24 小时，Cookie 仍不晚于令牌到期。既有已签发会话不会被追溯延长，重新登录后生效。
