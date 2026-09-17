# 消息投递

`/management/messenger` 显示渠道、来源、状态、收件人、发送尝试与人工重试。Gateway 的 messenger.delivery:read/retry 分别控制查看和操作，Dashboard 从已验证用户派生审计 actor。

MESSENGER / MESSENGER_ADMIN 分别绑定独立 Worker messenger 的 Messaging / MessengerAdmin。D1、Queue、Resend/Telegram 凭据和重试归 messenger 所有；Dashboard 不直连渠道。市场点评使用 Workflow 实例结果键；融资提醒使用 rule/target/period 键。入队成功不等于渠道送达。

融资历史保留原表，新增 queued 表示已交给 messenger；provider_message_id 在 queued 行保存 messenger ID，详情和最终结果在消息投递页。旧 sent 行保持原 Provider ID。CLI 只支持 dry-run，实际扫描由 Worker Cron 执行。

验证：Node 契约、真实 D1 的 messenger 单测、Gateway 权限矩阵、CI 的独立消息组件交互测试。生产页面只通过 Gateway，禁止使用浏览器做权限登录验收。
