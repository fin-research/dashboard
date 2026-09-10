# 研究辅助与统一 EDB

入口：`/trading-research/research`、`GET /api/economic-indicators`；定时任务为 `EconomicIndicatorSyncWorkflow`，本地脚本用于首次全历史回填和受控维护。只在研究辅助、公共观测或负债周报序列任务中读取。

## 模块与依赖

| 职责 | 事实来源 |
|---|---|
| 指标契约与展示派生 | [economic-indicators.ts](../../src/lib/trading-research/economic-indicators.ts) |
| Choice / DM 增量同步 | [economic-indicator-sync.ts](../../src/lib/server/economic-indicator-sync.ts) |
| 观测查询 | [economic-indicators-repository.ts](../../src/lib/server/economic-indicators-repository.ts) |
| Cron / Workflow 编排 | [worker/entry.ts](../../worker/entry.ts)、[economic-indicator-run.ts](../../worker/economic-indicator-run.ts) |
| 本地更新 | [update-economic-indicators.ts](../../scripts/update-economic-indicators.ts) |
| 表定义 | [edb-migrations](../../edb-migrations) |

Choice EDB / DM 历史 → 首次本地回填或每日上海 00:00 增量 Workflow → `public.edb` → 研究辅助最近 18 个月快照 / 负债周报所需年度序列。前端只做展示换算、利差派生与抽样；页面和周报动作不直接请求办公网或付费上游。

## 数据口径

`public.edb` 是跨应用共享的经济与利率观测表，主键为 `(indicator_code, observation_date)`，同时保留上游发布日期 `published_date` 和同步时间 `synced_at`。Dashboard 的每日 00:00 Workflow 是唯一线上写入方，增量更新研究辅助及融资负债周报所需指标；融资应用只读，不维护平行 EDB 表或在页面/周报生成动作中请求 Choice EDB。上游已确认的异常观测必须在同步写入前按完整“指标代码、观测日、源值”精确剔除，不得在读取周报时用通用离群值规则隐藏。

字段、当前指标数量和剔除清单以同步代码为准，不在其他专题重复复制指标表。存储所有权见 [共享数据库](../../../eastmoney/docs/DATABASE.md#neon-领域与迁移所有权)；研究曲线单位与待接入范围见 [工作台研究口径](../TRADING_RESEARCH_WORKBENCH.md#研究)，负债周报使用口径见 [负债周报](liability-report.md)。

## 增量任务隔离与诊断

每日上海 00:00 的一次 Workflow 将每个 Choice EDB 请求批次及 DM 的 DR001、DR007、R007 请求分别放入并行 `fetch` step。Choice 保留既有回看窗口、代码族及每批最多 8 个指标的规则。所有 source step 在各自分支内捕获重试耗尽；某一请求失败不终止其他请求，也不重跑成功的付费查询。

每个请求最多执行 3 次（首次 + 2 次重试），采用 `limit: 2, delay: "1 minute", backoff: "exponential"`，失败后等待 1 分钟、2 分钟。成功结果各自进入独立的 Neon `persist` step，保留 advisory lock 和事务 upsert；入库重试复用已保存的拉取结果。成功空窗口保留已有历史。DM 立即入库；Choice 在相关批次完成后共用成功响应中的发布日期映射，缺失代理发布日期时不伪造发布日期。

每次失败的 step error 和结构化日志均记录 Workflow ID、步骤、尝试序号、接口及查询参数、异常类型和明细。Data 的非 2xx 响应最多保留 24,000 字符，包括其嵌套的上游状态、业务错误码和脱敏响应体；超限显式标记 `responseTruncated`。网络异常、无效 JSON 和 Schema 校验失败分别记录阶段与原因，不保存 Cookie、Bearer token 或上游签名凭据。

结束前的 `record economic indicator sync result` step 持久化每个请求的结果、入库行数和失败列表，返回 `status=complete|partial|failed`。部分失败时 Workflow 完成编排并返回 `partial`，成功数据已经入库，失败步骤及错误明细仍在实例历史中；全部失败时先保存 `failed` 汇总再使 Workflow 进入 Errored。必须检查输出 `status`，不能把平台 Completed 等同于所有数据源刷新成功。Cron 本身不重试或重复派发；已完成请求由 Workflow 保存的步骤结果复用。
