# 文档分流

先完整读取仓库 `AGENTS.md`。按任务读取公共规则，再按目标路径读取唯一模块文档；不要一次加载所有文档。跨模块任务只加读实际影响的模块，已经读过的文件不重复加载。

| 任务 | 公共规则 |
|---|---|
| UI、组件、图表、响应式、打印 | [DESIGN](../DESIGN.md) |
| 模块放置、依赖、共享运行时 | [ARCHITECTURE](ARCHITECTURE.md) |
| 业务不变量 | [DOMAIN](DOMAIN.md) + 目标模块 |
| SQL、schema、事务、migration | [DATABASE](DATABASE.md) + 目标模块 |
| load/actions、API、错误与分页 | [API](API.md) + 目标模块 |
| Access、Auth0、权限、Secret | [SECURITY](SECURITY.md) + [管理模块](modules/management.md) |
| 本地开发、测试、Git、发布 | [DEVELOPMENT](DEVELOPMENT.md) |

| 页面或模块 | 专题入口 |
|---|---|
| / | [门户](modules/portal.md) |
| /market-briefing | [市场点评](modules/market-briefing.md) |
| /trading-research/market-hotspots | [市场热点](modules/market-hotspots.md) |
| /trading-research/policy-tracking | [政策跟踪](modules/policy-tracking.md) |
| /market-briefing | [今日聚焦](modules/market-focus.md) |
| /secondary-bond-pool | [二级池](modules/secondary-bond-pool.md) |
| /financing-model | [融资择时模型](modules/financing-model.md) |
| /fund-report | [资金日报](modules/fund-report.md) |
| /credit-workbench | [授信工作台](modules/credit-workbench.md) |
| 客户主数据、融资/授信关联 | [客户与授信关联](modules/clients.md) |
| /management、/profile、/management/people、/management/financing-profile | [管理中心与账号](modules/management.md) |
| /financing | [融资仪表盘](modules/financing-overview.md) |
| /financing/projects、/financing/projects/[id] | [融资项目](modules/financing-projects.md) |
| /financing/sop、/financing/sop/[id]、/financing/sop/reminders | [融资 SOP 与提醒](modules/financing-sop.md) |
| /financing/data、/financing/debts/[id] | [融资台账与数据后台](modules/financing-data.md) |
| /financing/liability-report | [负债周报](modules/liability-report.md) |
| `/trading-research` 共享业务装配 | [交易研究工作台](TRADING_RESEARCH_WORKBENCH.md) |
| `/credit-workbench/assistant` 与授信材料 | [授信问答](CREDIT_ASSISTANT.md) |

公共文档只维护跨模块规则；页面字段、业务公式、图表、特定 action、查询预算与例外放在模块文档。一个事实只保留一个权威位置，其他位置使用链接。`docs/history/` 只供历史迁移排查，不是当前部署说明；原 financing checkout 为历史归档，不再作为源码或规范来源。
