# 授信工作台

入口：`/credit-workbench`。公共规则见 [文档分流](../INDEX.md)。

## 按日截面与存储

Worker 通过 `HYPERDRIVE` 访问 Neon `credit` schema，migration 只放 `credit-migrations/`。

- `credit.diff` 是唯一授信业务事实表：`id` 定位变更；`institution_name` 标识主体；`effective_on` 为业务生效日；`created_at` 自动记录创建时间；`created_by` 使用已验证的 Auth0 user id。旧快照没有作者，迁移行的 `created_by` 留空，不伪造历史身份。
- 同一字段按 `(effective_on, created_at, id)` 降序取最近非空值。数值零、布尔 false 和空字符串均是有效值；NULL 表示未变。真正清空某字段时，该字段名写入 `cleared_fields`，截面重建将其作为一次明确的空值变更。
- `total` 保存授信总额；六项 `*_limit` 保存债券投资、收益凭证、法透、两融收益权转让、同业拆借、其它的额度；各项 `*_detail` 保留额度说明。四项人工已用值保存在 `bond_investment_used`、`legal_overdraft_used`、`margin_income_rights_used`、`other_used`。
- `detail` 为原 `notes` 的授信额度自然语言描述；`notes` 供人工备注，迁移时保留原 `usage_details` 文本。机构性质、状态、保密协议、期限、经办机构、申请部门、经办人和投资偏好同样按字段记录差异。
- `institution`、`item`、`institution_event` 和相应旧视图、刷新函数已经移除。期限事件和金额变化从 diff 与融资台账计算，不再维护事件事实表。
- `credit.state_as_of(date)` 重建 SQL 截面；应用使用相同的排序和清空语义重建响应。可查询首个有记录的业务日期起的任意日期，无需该日恰有导入记录。默认日期为上海时区今天。
- 页面与导入仅调用 `credit.append_diff`。同一事务内取得授信写锁，比较类型和金额精度归一后的当前值，只追加实际变化；同日重导或重复保存不增加无效行。补录历史从该业务日期向后生效，后续已明确修改的字段继续覆盖历史值；期限组合同时校验受影响的后续截面。

### 历史修订

正常操作不更新、删除 diff 行。数据库触发器拒绝 DELETE，拒绝普通 UPDATE。确需人工修订错误历史时，在受控事务内显式 `SET LOCAL credit.correct_history='on'` 后按主键 UPDATE；触发器自动更新 `updated_at`，创建时间、创建人和主键仍不可改。历史修订须检查受影响截面，不通过删除再导入替代。

`0008_credit_diff.sql` 将所有既有快照逐字段转成差异，保留显式清空；旧报表中机构消失的日期转成撤销变更。静态客户归属继续保留。

## 已用额度

`institution_client` 保留静态一对多客户关联，归属规则见 [客户与授信关联](clients.md)。

- 收益凭证、同业拆借按截面日期调用 `financing.credit_usage_as_of(date)` 读取存续本金，元转亿元；不在 diff 中重复存一份融资已用值。
- 总已用为六项有效值之和。客户未关联时，融资已用、总已用及可用保持缺失，不能当零处理；四项人工使用额的空值沿用合计时按零处理的口径。
- 授信总额和机构数量统计仍只纳入 `approved`。到期事件用于提醒，不自动替用户撤销机构状态。
- 原 Excel 融资分项值仅在导入时与融资台账比较并输出警告；不再存 `importedTotalUsed` / `importedUsedAmount`。核对脚本输出当前派生额和缺失关联，原始报表差额在导入阶段核对。

## 接口与维护

- `GET /api/credit?date=YYYY-MM-DD&month=YYYY-MM` 返回所选日期截面、前期汇总、周报事件、六个月批复和日历。`month` 可省略，默认所选日期所在月；返回该月及周边日历格中的额度与已用事件。非法日期/月为 400，早于历史覆盖起点或无记录为 404，连接异常为 503。
- 周环比优先采用七天前的截面；历史不足七天时取更早的最近变更日。周报事件覆盖比较期间内的新增、续作、扩额、缩额、到期和撤销；续作与扩额同时发生时只记扩额。首次历史导入作为基准，不虚构当日新增批复。
- `PATCH /api/credit` 以 `reportDate`（本次变更业务日）、`institutionName` 和 `changes` 追加变化。`changes.institution` / `changes.items` 仅传修改字段。用户 ID 由 `locals.user.auth0Id` 注入，客户端不能指定作者或审计字段。
- `POST /api/credit` 使用相同结构新增机构，至少包含机构性质、状态、保密协议状态。主体重复返回 409；成功后可继续维护全部详情。
- 两项融资已用及总已用只读。所有写入校验同源、身份与 `credit.institution:update` 权限；GET 使用 `credit.institution:read`。所有响应 `Cache-Control: no-store`。

## 导入

Excel 暂时保留本地导入，浏览器不解析、不上传源文件。

```sh
pnpm credit:import -- --file /absolute/path/授信周报.xlsx --date YYYY-MM-DD --dry-run
pnpm credit:import -- --file /absolute/path/授信周报.xlsx --date YYYY-MM-DD --user-id 'auth0|已核实的用户ID'
```

dry-run 核对模板、机构数、一览表/周报口径与工作簿总额差异。实际导入返回 `addedDiffCount`，金额比较与写入在同一事务完成；缺席机构不会被自动删除或撤销，撤销需明确状态。来源报表不会覆盖已存在的静态客户关联。先验证目标连接，再写入；不要将源文件提交 Git。

## 页面与日历

四个侧栏入口为授信一览表、日历、周报、问答，继续复用 `WorkbenchShell`。前三页复用 `CreditView.svelte`，保留现有机构排序、筛选、详情自动保存和周报打印版式。

- 顶栏用日期输入选择任意截面；一览表“新增机构”建档，详情维护所有字段和六项额度、四项人工已用。详情显示本次变更业务日期。
- 日历支持全部、到期、额度变动、已用变动筛选，切月重新请求对应区间，所有事件均可见。
- 额度事件格式：`授信新增/授信到期/授信扩额/授信续作/授信缩额/授信调整/授信撤销 · 总额亿元`。仅分项额度或授信描述变化也显示授信调整；已被续作替换的旧到期日不再提醒。
- 已用按业务日、机构、具体分项显示净变化：`同业拆借 · + 1 亿元`、`收益凭证 · - 2 亿元`；不显示合计变动。融资部分读取实际生效、到期、结清、关闭日期；人工部分读取 diff 日期。
- 周报保留编号快讯、近六个月新增/续作/扩额批复和按银行性质合并单元格的明细附表。分项额度和已用变化在日历展示，不另列周报快讯。

默认验收为类型检查、单元/数据库回归与构建；真实迁移需核对旧三期所有主体字段、分项及有效使用额。浏览器与截图检查仅在明确要求时执行。
