# 客户与授信关联

`public.client(id, name, fullname, type, subtype)` 保存共享客户身份，`name` 是唯一业务简称。全名允许为空；汇总客户、自然人和来源只有简称的机构不补造法律全名。一级分类为银行、理财子、券商、基金、营业部客户、其它；银行性质和券商自营/资管放在 `subtype`。

## 关联规则

- `financing.debt.client_id` 每笔最多关联一个客户，各继承子表分别安装外键、索引和触发器。原 `counterparty` 留作业务原文，不覆盖。初始回填只更新空关联，手工指定的客户优先；修改交易对手时重新识别，其他字段修改不改变人工关联。
- `public.client_alias` 保存规范化精确别名和经核实的特定产品正则。匹配顺序为精确别名/标准名、移除来源类别后的完整名称、特定产品规则；多客户命中或未知计划保持空关联。禁止仅按管理人或任意银行简称的子串猜测投资人。别名维护以数据库保存值为准，不在浏览器复制客户清单。
- `credit.client_mapping` 是后续报表沿用的规则；`credit.institution_client` 保存报告日的实际一对多关系。每个客户、每个报表日的收益凭证和拆借分别只能归属于一个授信主体。银行金市/资管分开的授信按品种分配，关闭某一品种的归属表示该主体该品种使用为零，不重复计算。
- 新增授信优先采用规则；没有规则时，仅当完整名称或 `&` 合并名称全部精确识别且不与既有归属冲突才自动关联。同日重导保留已存在的日期关联。省联社成员按人工确认清单逐一维护，运行时不按省份字符串自动扩大范围。

## 金额和历史

`financing.credit_usage_as_of(date)` 在融资领域读取已生效、报告日尚未到期/结清/关闭的收益凭证和同业拆借本金（元）。`credit.item_usage` 按关联主体求和并除以一亿元，替换两个品种的展示使用额；未关联保持 NULL。

`credit.institution_usage` 使用“原总已用 − 原两项已用 + 融资两项已用”，保留其它业务及原有未分项余额。`credit.item` / `institution` 的原导入值继续留存；`usage_reconciliation` 展示原值、融资值和差额。其它分项的人工编辑按变动额同步总已用。总额与原分项和不一致单独报告，不用某一分项凑总数。

银行与理财子分别建客户，即使授信合并也不把客户法人合并。营业部客户和具名投资产品可以有客户关联但没有银行授信，这是正常的业务范围差异。原始负债无交易对手时不创建虚拟投资人补齐关联。

## 初始化与管理员维护

先运行融资 migration（含公共客户主表及负债外键），再运行授信 migration；不要在生产执行临时 DDL。

```sh
pnpm financing:db:init -- --schema-only
pnpm credit:db:migrate
node scripts/maintain-clients.mjs /absolute/path/client-manifest.json
node scripts/maintain-clients.mjs /absolute/path/client-manifest.json --apply
node scripts/reconcile-client-usage.mjs /absolute/path/reconciliation.json
```

清单字段：`clients` 为上述主表字段（不传 id）；`aliases` 为 `alias/matchKind/clientName/notes`；`creditMappings` 为 `institutionName/clientName/yieldCertificate/interbankLending/notes`。首次运行默认为事务回滚预览，`--apply` 才保存；来源清单与真实台账核对结果放在未跟踪的运行目录，不提交业务快照。

维护清单按名称更新客户和给定别名/归属规则，不删除未提及客户或旧别名，不覆盖已有人工作出的历史关联。新增规则会补齐缺失的日期关联；改变历史归属需显式维护相应 `institution_client`，同一日期的重复品种归属会被数据库拒绝。负债详情可编辑客户 ID；修改历史金额、日期、现金流后按需要显式刷新既有月度衍生指标。

当前 Auth0 模式经 `/financing/data/api` 由 Worker 编译白名单 SQL、通过 Hyperdrive 访问融资 schema，并在事务内使用 `authenticated` 角色与 RLS；生产未开通 Neon 托管 Data API，因此无需刷新托管 schema cache。若将来重新启用托管 Data API，DDL 后须刷新缓存。公共客户表和授信内部视图不向数据后台开放，继续沿用融资写权限和审计。
