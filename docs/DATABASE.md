# 数据与存储

Schema 和字段以 migration 与代码为事实来源。本文件只记录长期边界和一致性规则。

## R2

Worker 只绑定私有 `eastmoney` R2 bucket，并通过固定小写前缀隔离对象：

- `bond-ledger/YYYY-MM-DD.xlsx`：二级池台账定稿。同日重新上传覆盖当天对象；上传解析阶段暂存于 `bond-ledger/.pending/<uuid>.xlsx`，Workflow 成功后归档并删除临时对象。页面统计不得通过下载 R2 文件重新计算。
- `market-briefing/YYYY-MM-DD.json`：市场点评人工定稿快照，只包含规范报告字段、今日聚焦和定稿时间，不含原始上游响应；只有显式保存定稿才覆盖当天对象，当天普通加载不读写 R2，选择历史日期时读取并校验该日完整定稿。
- `fund-reports/YYYY-MM-DD.html`：资金日报。同一天再次上传会替换该日报；读取路由不得接受任意对象 key。

资金日报当前不需要 D1/Neon 索引：上传文件名已经提供日期，公开 URL 和 R2 key 都可由日期直接确定；历史列表只枚举 `fund-reports/` 固定前缀并过滤严格日期文件名。需要审批或同日报告的版本历史时再增加独立元数据模型。

## 变更检查

- D1：本地应用 migration，运行热点快照和证据测试。
- Neon：在 PostgreSQL 兼容环境应用对应 schema migration，检查约束、索引、事务回滚和追加顺序。
- 二级池导入解析变化：先运行只读回填盘点；只有明确授权并使用 `--apply` 才写入。
- 授信导入解析变化：先运行 `pnpm credit:import -- --file <xlsx> --date YYYY-MM-DD --dry-run`；确认目标环境后去掉 `--dry-run` 写入。

## 统一 Worker 下的数据库边界

| 领域 | Schema | Migration | 运行时边界 |
|---|---|---|---|
| 二级池 | `bond` | `postgres-migrations/` | 二级池 repository |
| 授信 | `credit` | `credit-migrations/` | 授信 repository |
| 融资模型 | `financing_model` | `financing-model-migrations/` | 模型 repository |
| 融资业务 | `financing` | `financing-migrations/` | `src/lib/server/financing/` |
| 公共经济观测 | `public.edb` | `edb-migrations/` | 增量同步写入，业务只读 |

同一个 Hyperdrive binding 不合并业务 schema。融资请求通过 `locals.database` 至多创建一个 Client，在 middleware 的 finally 中关闭；其他模块继续使用其既有 repository。日期字符串解析器只绑定融资 Client，禁止全局修改 pg 的 type parsers。数据库连接、临时身份与事务状态不能跨请求复用。

融资 migration 原样迁入并沿用 `financing.schema_migrations`，此次仓库合并不重建表、不重放已执行 migration，也不复制生产数据。数据后台的 RLS、审计、字段白名单及台账继承结构见 [融资数据模块](modules/financing-data.md)。

## 日期与时间戳

融资上传原始文件中的无时区时间以 UTC+8 为准。`date` 是业务自然日，不做时区转换。`timestamp without time zone` 在融资 Client 的解析边界显式补 `+08:00`；`timestamptz` 保留来源明确的 offset 和微秒精度，不能再补 Z 或重复平移八小时。页面显示固定为 `Asia/Shanghai`。

不得调用全局 `pg.types.setTypeParser`。融资 Client 使用自己的 parser 配置，其他 schema 保持默认语义。乐观锁用的 `updated_at` 不转成丢失微秒的 JavaScript Date。SQLite 本地维护脚本按字段类型补全缺失时区，已有数据库历史不因代码合并批量改写。Excel 的业务日期继续按 `cellDates:false` 提取日历日期；用 UTC 做 date 加减只是日历算法，不能把它当原始 timestamp。
