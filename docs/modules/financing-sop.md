# 融资 SOP 与提醒

入口：`/financing/sop、/financing/sop/[id]、/financing/sop/reminders`。公共规则见 [文档分流](../../AGENTS.md#context-routing)；仅在任务涉及本模块时读取。

## 业务：提醒

- 时段提醒仍以完成时点（`due_date`）为锚点，不在启动日另发提醒。
- 提醒规则作用于由 SOP 节点生成的项目任务；一条规则可关联多个 SOP 节点。
- 一条规则支持 1–20 个提醒周期，每个周期用“提前 x 天 x 小时”表示。整天周期统一在对应日期 09:00（`Asia/Shanghai`）发送；包含小时的周期相对节点到期日 00:00 倒推，并在所得实际整点发送。
- 收件人可来自任务负责人、项目负责人或指定邮箱。
- 同一 `(rule_id, target_id, period_id)` 只发送一次，同日多个小时周期分别记录。
- Resend 未配置时记录 `pending`，不能标记为已发送。
- Provider 返回 `sent` 只表示接收请求，不等于邮件已投递到收件箱。

## 数据模型

- `projects` 与 `project_tasks` 是独立融资项目体系，不引用负债。
- `sop_templates` 与 `sop_nodes` 定义模板和相对日期节点。`default_offset_days` 是计划/完成偏移；`default_start_offset_days` 为空表示时点，非空表示时段启动偏移。起止均相对计划簿记日 T，沿用自然日口径，范围 -3650 至 3650，启动不得晚于完成，可配置同日时段。
- `reminder_rules` 保存规则本体，`reminder_rule_nodes` 保存规则与 SOP 节点的多对多关联，`reminder_rule_periods` 保存可排序的多个小时级提前周期。
- `reminder_deliveries` 以 `(rule_id, target_id, period_id)` 去重，同时保存 `scheduled_for` 和实际发送结果。
- 项目删除必须使用已有事务服务，同步清理任务与提醒，不在页面拼接多次删除。

## 页面：SOP

- 节点使用左侧手柄拖拽排序，鼠标、触控和键盘共用同一原子服务端动作。
- 新增和编辑节点均可选择“时点 / 时段”；时段配置启动、完成两个偏移。模板调整作用于之后新建的项目，已有项目日期在项目详情中维护。
- 新增节点只通过右下角固定加号打开居中模态框，不保留页面常驻新增表单。

## 页面：Calendar and Reminders

- 融资日历默认周一至周五，可展开为周日开始的七列完整周；五列模式逐周跳过周末，月初为周日时仍从前一周周一对齐，所有当月工作日必须保留。
- 事件按“负债简称•事件摘要”展示并可下钻；事件过多使用“更多”入口，不缩小字号。
- 顶栏提醒展示未来 7 天与逾期节点，每条可直接进入对应项目。

## 每小时调度与交付边界

`worker/entry.ts` 的 `0 * * * *` 仅运行融资提醒。经济观测同步的午夜 Cron 已迁至 Data。提醒沿用原查询、周期、去重键和状态含义；无 Resend 配置时仍为 pending。真实发送测试需明确收件人与发件人，Provider accepted 不等于 delivered。

邮件投递通过 MESSENGER。新增 queued 为中台已入队，最终状态在 `/management/messenger` 查询；既有 sent 历史不变。

### 集中通知调度

融资提醒不再由 Dashboard 的小时 Cron 触发；Messenger 每分钟经私有 NotificationSource 调用既有业务候选查询。责任人/经办人及规则指定的本站账号形成 userIds，提交 financing 通知事件；Messenger 解析用户订阅、独立联系方式和渠道。reminder_deliveries 保留历史与逻辑通知提交 ID，queued 不表示渠道送达；规则中的历史 email 列仅保留兼容，实际渠道由个人订阅决定。

### 空闲扫描检查点

Dashboard 的 `1020_financing_reminder_checkpoint.sql` 在 D1 保存单行调度元数据，不复制 Neon 业务数据或账号资格。SQL 候选集为空且非 dry-run 时，只在下一个整点再次访问 Neon；所有周期均为整小时，原自然日、09:00 和小时倒推规则保持不变。存在候选（即使没有有效收件人）、发送失败或查询失败时，仍按分钟重试。

`/financing` 下所有写请求在动作前后同步失效检查点；generation 条件更新防止并发扫描重新写入旧空结果。数据库错误直接返回失败，不把失败缓存为空。直接 SQL / CLI 修改不经过 HTTP hooks，下一整点自动重查；需要下一分钟生效的维护操作应在修改前后运行 `UPDATE financing_reminder_checkpoint SET generation=generation+1,next_scan_at=0 WHERE id=1`（D1），不得修改 Neon 业务内容来刷新检查点。

部署必须先应用 Dashboard 的 D1 migration；无业务变更时回滚 Worker 即恢复分钟扫描，检查点表可保留。交易提醒先检查工作日及节点起止时间的五分钟窗口，仅在可能到期时扫描 Messenger 提供的 D1 trading 订阅用户名单。

私有 `/scan` 请求包含 scheduledTime 和 userIds，交易扫描直接使用去重名单；通知发送仅依据 Messenger D1 的订阅、联系方式和设备，不查询 Auth0。`/eligible` 及 Gateway 通知资格接口已删除。先部署携带 userIds 的 Messenger，再部署 Dashboard；融资业务责任人映射不属于投递权限查询，继续由融资模块维护。
