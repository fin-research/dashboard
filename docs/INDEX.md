# Dashboard 文档分流

先完整读取 [仓库 AGENTS](../AGENTS.md)，按下面路径选择目标模块，再叠加确实涉及的专题。跨模块只加读受影响部分；已经在上下文中的文档不重复加载。跨项目执行规则和共享专题入口见 [项目组索引](../../eastmoney/docs/INDEX.md)。

## 按页面与模块读取

| 页面、API 或任务 | 唯一模块入口 |
|---|---|
| `/` | [门户](modules/portal.md) |
| `/market-briefing`、`/market-briefing/text`、`/api/market-report`、旧 `/api/market-resources/*` | [市场点评](modules/market-briefing.md) |
| 市场点评内今日聚焦、`/api/market-briefing` | [今日聚焦](modules/market-focus.md) |
| `/trading-research/market-hotspots`、旧 `/market-hotspots`、`/api/rag/hotspots` | [市场热点](modules/market-hotspots.md) |
| `/trading-research/policy-tracking`、旧 `/policy-tracking`、`/api/policies/*` | [政策跟踪](modules/policy-tracking.md) |
| `/news/[id]`、`/articles/[id]`、`/commentaries/[id]` 及同名 `/api/*` | [资讯、研报与点评详情](modules/research-details.md) |
| `/trading-research`、`/trading-research/trading`、`/trading-research/workflow`、工作台框架与兼容跳转 | [交易研究工作台](TRADING_RESEARCH_WORKBENCH.md) |
| `/trading-research/research`、`/api/economic-indicators`、EDB Cron / 回填 | [研究辅助与 EDB](modules/research-assistance.md) |
| `/secondary-bond-pool`、`/trading-research/secondary-bond-pool`、隐藏 `/bond` / `/trading-research/bond`、`/api/bond-ledger` / `/bond-ledger` | [二级池](modules/secondary-bond-pool.md) |
| `/financing-model`、`/trading-research/financing-model`、`/api/financing-model/*` | [融资择时模型](modules/financing-model.md) |
| `/fund-report`、`/fund-report/[date].html`、`/api/fund-report` | [资金日报](modules/fund-report.md) |
| `/credit-workbench`、`calendar` / `weekly` 子页、`/api/credit`、授信 Excel 导入 | [授信工作台](modules/credit-workbench.md) |
| `/credit-workbench/assistant`、旧 `/credit-assistant`、授信材料、CreditAgent、独立问答 HTTP / WebSocket | [授信助手](CREDIT_ASSISTANT.md) |
| 客户主数据、融资/授信关联、保密协议关联 | [客户与授信关联](modules/clients.md) |
| `/management*`、`/profile`、`/api/profile`、`/auth/*`、旧融资账号跳转 | [管理中心与账号](modules/management.md)；登录配置才加读 [Gateway Auth0](../../gateway/auth0/README.md) |
| `/financing` | [融资仪表盘](modules/financing-overview.md) |
| `/financing/bond-investors`、债券投资人历史维护 | [债券投资人](modules/bond-investors.md) |
| `/financing/projects*`（含 options） | [融资项目](modules/financing-projects.md) |
| `/financing/sop*`、提醒 Cron | [融资 SOP 与提醒](modules/financing-sop.md) |
| `/financing/data*`（API/token/import）、`/financing/debts/[id]` | [融资台账与数据后台](modules/financing-data.md) |
| `/financing/liability-report`、六页打印 | [负债周报](modules/liability-report.md) |
| 机构图标资产 | [机构 Logo](INSTITUTION_LOGOS.md) |

精确路由以 [src/routes](../src/routes) 和 [worker/entry.ts](../worker/entry.ts) 为准；动态工作台视图以其路由校验器为准。兼容入口复用目标模块规范，不创建第二份文档。

## 按技术影响加读

| 任务 | 仓库专题 | 跨项目变化时才加读 |
|---|---|---|
| UI / 图表 / 打印 | [DESIGN](../DESIGN.md) | 无 |
| 模块放置、共享运行时 | [ARCHITECTURE](ARCHITECTURE.md) | [共享架构](../../eastmoney/docs/ARCHITECTURE.md) |
| 业务不变量与计算 | [DOMAIN](DOMAIN.md) + 目标模块 | 无 |
| SQL、事务、日期、migration | [DATABASE](DATABASE.md) + 目标模块 | [共享存储](../../eastmoney/docs/DATABASE.md) |
| load/actions、状态码、分页 | [API](API.md) | Data 变更时读 [Data API](../../data/docs/API.md) |
| Gateway、Auth0、权限、Secret | [SECURITY](SECURITY.md)；权限发布读 [UNIFIED_PERMISSIONS](UNIFIED_PERMISSIONS.md) | [共享架构身份所有权](../../eastmoney/docs/ARCHITECTURE.md#身份与授权所有权) |
| AI 调用 | 目标模块 Prompt / Schema | [共享 AI](../../eastmoney/docs/AI.md) |
| 开发、测试、Git、发布 | [DEVELOPMENT](DEVELOPMENT.md) | 项目组 AGENTS 的并行规则 |

## 文档所有权

共享专题只记录跨模块实现规则；页面字段、公式、图表、特定 action、查询预算与例外放在模块文档。跨项目关系在项目组 docs 维护，不在本仓库再复制总架构或 schema 所有权表。

[融资合并记录](FINANCING_MERGE.md)、`docs/history/` 与 [授信需求底稿](授信管理需求文档.md) 仅按迁移排查或需求溯源读取，不作为当前运行状态。原 Financing checkout 不再作为生产源码或规范来源。

权限架构、权限范围与匿名/测试账号程序化验收 → [共享 AUTH](../../eastmoney/docs/AUTH.md)。禁止 browser；本仓库覆盖范围与命令见 AUTH 的测试表。
