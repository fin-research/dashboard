# 接口约定

代码与运行时 Schema 是接口事实来源。本文件记录路由职责和稳定契约，不复制完整响应结构。

## 外部数据服务 `/data/*`

市场点评浏览器携带同源 Access 会话直接请求独立 Data Worker 的 `/data/*`；服务端通过私有 DATA binding 读取。行情 REST 资源 GET/HEAD 由 Data 校验 Access JWT，不逐资源查询 Auth0 Management API。旧 `/api/market-resources/*` 保留为验证 Access 登录的限定兼容通道。

除基础配置和 Choice 外，所有 REST 资源都支持 `fields=a,b` 顶层字段投影；未知字段为
422。列表资源直接返回 JSON array，不再读取 `data`、`list` 等上游 envelope。响应必须
先通过 `src/data-contracts.ts` 或服务端局部 Zod Schema，不能用 TypeScript 断言猜测上游
结构。

- `GET /data/config`：默认报告配置。
- `GET /data/omo?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`、`GET /data/cfets?date=YYYY-MM-DD&source=DR|DIBO`：OMO 与资金利率原始映射。
- `GET /data/cfets-histories?bondCode=DR001&endCapitalTime=...&limit=100`：DM 单个资金利率的倒序分页历史，供研究数据回填和增量任务使用。
- `GET /data/bond-top-case?date=YYYY-MM-DD`、`GET /data/futures-latest`、`GET /data/margin?date=YYYY-MM-DD`：国债、期货与两融原始映射。
- `GET /data/industry?date=YYYY-MM-DD`：行业、主要指数、成交额及可用交易日。
- `GET /data/primary-issues?date=YYYY-MM-DD&startDate=YYYY-MM-DD`：一级发行原始映射。
- `GET /data/today-trades?limit=300`、`GET /data/favorite-quotes?limit=100`、`GET /data/bond-infos?codes=...`：今日成交、收藏报价与批量债券基础信息原始映射。`codes` 由本次两份行情的 `bondUniCode` 合并去重后动态生成；`fields` 只取连接、展示和类型筛选需要的 `bondUniCode,bondShortName,comShortName,bondType,bondOfferingType`。
- `GET /data/stock-summary?date=YYYY-MM-DD`：A 股收评标题、时间与前两段。
- `GET /data/news?date=YYYY-MM-DD&important=true&pageSize=40` 与 `GET /data/news/{id}`：今日聚焦的 DM 新闻列表和正文。
- `POST /data/graphql`：以 nullable 顶层字段薄映射全部公共数据资源，参数、`fields` 投影
  和 DTO 与对应 REST 相同；不包含市场点评筛选、合并或口径换算。市场点评继续使用分段
  REST，避免多字段 CPU 累计并保证单资源失败只影响对应模块。

本地 Vite 完整保留 `/data` 前缀并代理到 `DATA_PROXY_TARGET`。线上由独立数据服务处理，Dashboard Worker 不注册这些路由。

原始资源字段变化必须与 `src/api.ts` 请求编排、`src/market-report-resources.ts` 加工、`src/report-view.ts`、`src/text-report.ts` 及相关测试同步。不要恢复 `/data/market-report/*` 或 GraphQL 市场报告聚合，也不要为视觉版或文字版增加单独的数据源。

Data 错误响应保留安全诊断字段，前端错误消息展示接口路径、HTTP 状态、错误码、数据源、
处理阶段及限长后的 Schema issue。市场点评的原始资源请求相互隔离：单个请求失败只记录
该资源 issue，并在依赖它的模块显示“数据缺失”，其他模块及文字版继续生成；只有报告
定稿本身损坏或最终共享 Schema 无法成立才进入整页错误。`stock-summary` 当日尚未发布时
返回 404，页面以空股市段落继续加载其他模块；稀疏 OMO/CFETS/期货数值和今日成交收益率
以 `null` 表示，不转换为 0。

研究辅助浏览器只调用 Dashboard `GET /api/economic-indicators` 读取 Neon。Choice `GET /data/choice/edb` 与 DM `GET /data/cfets-histories` 只供首次本地全历史回填和每日定时增量任务使用，页面加载不消耗上游查询额度。

浏览器在当天直接读取 Data REST 市场数据；历史日期先通过 Dashboard REST 读取完整人工定稿，无定稿时再按所选日期读取可回溯的 Data REST 市场数据并在页面 warning；不支持日期参数的期货最新、今日成交和收藏报价不会进入历史重生成结果。今日聚焦、研究辅助、热点快照、融资择时模型、二级池台账和资金日报仍各自属于一个明确业务资源，不在薄 GraphQL 中增加业务聚合。

## Dashboard Worker `/api/*`

## 通用约定

- JSON 错误使用 `{ "error": "可公开信息" }`；服务端日志可记录诊断信息，但不得包含 Secret 或完整敏感输入。
- 动态生成和台账 JSON 响应使用 `Cache-Control: no-store`。
- 融资择时模型读取、人工结论、历史决策记录、卖方生成和卖方修订响应同样使用 `Cache-Control: no-store`；写接口执行同源校验，但当前不等同于账号鉴权。
- 日期参数使用严格 `YYYY-MM-DD`；起止日期必须同时提供且起始不晚于结束。
- route handler 只做解析、校验、错误映射和服务调用；业务逻辑放入 `src/lib`。
- 兼容跳转 `/bond-ledger` 固定以 308 指向 `/bond`。

具体页面规则和接口见 [模块索引](INDEX.md)，不在公共文档重复维护。

## 融资与管理路由

`/financing/*` 属于 Dashboard 的真实路由子树，SvelteKit 全局 base 仍为空；URL 使用 `src/lib/financing/app-paths.ts`。`/management/people` 统一配置角色权限，个人资料使用 `/profile`；旧融资资料入口重定向。

页面 load 仅返回所需数据，通用预取使用 tap，固定工作台导航允许 hover。普通 mutation 返回单个确认实体或删除 ID，增强表单使用 `update({ reset: false, invalidateAll: false })`；身份与提醒只按 dependencies 定向失效。负债周报的显式生成按新快照版本刷新，具体例外见模块文档。

内部数据接口保持 `/financing/data/token`、`/financing/data/api/*`、`/financing/data/import`、`/financing/data/import/[id]`。Auth0 模式不向浏览器返回 Neon JWT。字段、表、主键与分页仍使用原白名单；请求身份在事务内设置并执行 RLS。

全站业务 GET/HEAD、API 写入及 named actions 均由 `permission-policy.ts` 登记和检查，门户及身份 bootstrap 除外。权限目录见 `src/lib/permissions.ts`；请求传入的权限、角色、人员身份或来源标记不能代替服务端授权。
