# 研究辅助与统一 EDB

入口：`/trading-research/research`、`GET /api/economic-indicators`；定时任务为 `EconomicIndicatorSyncWorkflow`，本地脚本用于首次全历史回填和受控维护。只在研究辅助、公共观测或负债周报序列任务中读取。

## 模块与依赖

| 职责 | 事实来源 |
|---|---|
| 指标契约与展示派生 | [economic-indicators.ts](../../src/lib/trading-research/economic-indicators.ts) |
| Choice / DM 增量同步 | [economic-indicator-sync.ts](../../src/lib/server/economic-indicator-sync.ts) |
| 观测查询 | [economic-indicators-repository.ts](../../src/lib/server/economic-indicators-repository.ts) |
| Cron / Workflow 编排 | [worker/entry.ts](../../worker/entry.ts) |
| 本地更新 | [update-economic-indicators.ts](../../scripts/update-economic-indicators.ts) |
| 表定义 | [edb-migrations](../../edb-migrations) |

Choice EDB / DM 历史 → 首次本地回填或每日上海 00:00 增量 Workflow → `public.edb` → 研究辅助最近 18 个月快照 / 负债周报所需年度序列。前端只做展示换算、利差派生与抽样；页面和周报动作不直接请求办公网或付费上游。

## 数据口径

`public.edb` 是跨应用共享的经济与利率观测表，主键为 `(indicator_code, observation_date)`，同时保留上游发布日期 `published_date` 和同步时间 `synced_at`。Dashboard 的每日 00:00 Workflow 是唯一线上写入方，增量更新研究辅助及融资负债周报所需指标；融资应用只读，不维护平行 EDB 表或在页面/周报生成动作中请求 Choice EDB。上游已确认的异常观测必须在同步写入前按完整“指标代码、观测日、源值”精确剔除，不得在读取周报时用通用离群值规则隐藏。

字段、当前指标数量和剔除清单以同步代码为准，不在其他专题重复复制指标表。存储所有权见 [共享数据库](../../../eastmoney/docs/DATABASE.md#neon-领域与迁移所有权)；研究曲线单位与待接入范围见 [工作台研究口径](../TRADING_RESEARCH_WORKBENCH.md#研究)，负债周报使用口径见 [负债周报](liability-report.md)。
