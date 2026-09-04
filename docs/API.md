# 接口约定

代码与运行时 Schema 是接口事实来源。本文件记录路由职责和稳定契约，不复制完整响应结构。

## 外部数据服务 `/data/*`

浏览器或 Dashboard Worker 通过同源 `/data/*` 访问独立 Data Worker：

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

### 市场点评

- `GET /api/market-report?date=YYYY-MM-DD`：读取并校验该日期完整 R2 定稿。无定稿返回 404 `REPORT_NOT_FINALIZED`，浏览器据此回退到 Data REST 原始资源重新生成。
- `PUT /api/market-report?date=YYYY-MM-DD`：仅在用户手动保存时，同源接收浏览器已加工并经 Schema 裁剪的规范报告与今日聚焦，覆盖当天对象；完整文字版不得写入 R2，原始上游响应不得写入 R2，序列化快照上限为 512 KiB。

当天普通加载不调用 GET，也不读取 R2；选择早于上海当天的历史日期时优先读取完整定稿，仅 `REPORT_NOT_FINALIZED` 触发原始资源回退。
保存成功后的定稿时间由 PUT 响应更新当前页面状态。

### 市场热点

- `GET /api/rag/hotspots`：返回最近快照；无快照为 404；不接受范围参数。
- `POST /api/rag/hotspots`：生成并追加快照，成功为 201。
- 滚动请求：`{"mode":"rolling","rollingCount":20}`，数量必须为 8–100 的整数。
- 日期请求：`{"mode":"range","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}`。

### 政策跟踪

- `GET /api/policies?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&category=...`：读取 ingest Workflow 已聚合的政策时间轴，包含 `important` / `related` / `general` 重要性、原始政策资讯、已关联研报和一对一点评；不调用 AI。
- `GET /api/policies/articles?q=...`：按标题、机构或摘要检索可关联 article。
- `PUT /api/policies/{id}/articles`：人工确认完整研报 ID 集合；未选择的现有自动关系记为人工排除，后续 Workflow 不覆盖。
- `POST /api/policies/{id}/commentary`：用户手动触发。Worker 通过 `DATA` Service Binding 以最多 5 路并发读取已关联研报正文（可为空），与政策资讯一起调用启用 Responses `web_search` 的 AI Gateway，并保存使用政策点评专用 `max` effort 生成的政策点评初版，成功为 201。
- `PUT /api/policies/{id}/commentary`：保存标准化点评字段的人工修订。
- `GET /api/news/{id}`：按 DM `sentiment_id` 读取已聚合政策资讯的标题、时间、DM 原文、政策原文链接与关联政策；对应统一新闻资讯页面 `/news/{id}`。
- `GET /api/articles/{id}`：读取研报 D1 元数据、已关联政策，并通过 `DATA` Service Binding 读取正文；对应独立页面 `/articles/{id}`。
- `GET /api/commentaries/{id}`：按点评 ID 读取标准化点评与对应政策；对应独立页面 `/commentaries/{id}`。

### 今日聚焦

- `POST /api/market-briefing?date=YYYY-MM-DD`：日期缺省时使用上海时区当天。
- 无效日期为 400；上游、模型或配置错误按路由映射为 5xx。
- Dashboard Worker 通过 `DATA` Service Binding 读取股票收评和 DM 新闻；详情最多 5 个并发，避免同一 invocation 的外连等待槽被耗尽。
- 模型通过 provider-specific Responses API 调用，启用 `web_search`、使用今日聚焦专用 `max` reasoning effort，并将 AI Gateway 请求超时设为 300 秒；联网证据仅用于补充、核验给定材料未充分解释的关键行情和驱动。

### 资金日报

- `POST /api/fund-report`：上传单个 UTF-8 HTML，文件名末尾必须为 `YYYYMMDD.html` 或 `YYYY-MM-DD.html`；成功为 201。
- 请求体为原始 HTML 文件，`X-Fund-Report-Filename` 传 URL 编码的原文件名，`X-Fund-Report-Size` 传文件字节数。
- Worker 将文件保存为 R2 `fund-reports/YYYY-MM-DD.html`；同日报告再次上传会覆盖并在响应中返回 `replaced: true`。
- `GET /fund-report`：以 `Cache-Control: no-store` 返回按日期倒序排列的历史资金日报列表。
- `GET /fund-report/YYYY-MM-DD.html`：从 R2 返回 HTML；无该日报为 404。

### 二级池台账

- `GET /api/bond-ledger`：数据库报表日和文件状态清单。
- `GET ?start=YYYY-MM-DD&end=YYYY-MM-DD`：区间周报。
- `GET ?date=YYYY-MM-DD`：下载该日报表对应的原始 Excel。
- `GET ?workflow=<id>`：查询导入 Workflow 状态。
- `POST`：上传 Excel 到 `bond-ledger/.pending/` 并启动 Workflow，返回 202；导入成功后覆盖 `bond-ledger/YYYY-MM-DD.xlsx` 并删除临时对象。
- `DELETE ?date=YYYY-MM-DD`：删除该日数据库业务数据，保留 R2 归档。

### 融资择时模型

- `GET /api/financing-model`：返回最新 quant 模型快照、当前有效整体结论、最近卖方观点和最近 100 条可选模型运行版本；模型快照包含实际 LCR/NSFR、六类 SHAP 驱动结构、Top 因子贡献、四种品种相对各自同类债中位数的预测偏离、完整训练样本区间与样本外验证指标；无模型运行返回 404。
- `GET /api/financing-model?run=<uuid>`：读取指定运行并同时返回可选版本清单；模型基础字段保持不变，当前整体结论可由 PATCH 增量更新。
- `PATCH /api/financing-model/conclusion`：增量更新目标 `model_run` 的当前整体结论；请求含 `runId`、`verdict`、`preferredWindow`、`narrative`，不修改模型基础结论。
- `GET /api/financing-model/decisions`：读取历史择时决策记录；日期、历史分位和发行建议来自对应模型运行，按模型日期倒序返回。
- `POST /api/financing-model/decisions`：按 `runId` 新增或覆盖一条人工记录；`decisionAction` 必填，`outcome` 可在结果形成后补录，不设置状态字段。
- `POST /api/financing-model/sell-side`：按 `runId` 使用 AI Search 与 AI Gateway 生成并追加卖方逻辑汇总及 4–5 家逐机构观点，成功为 201。
- `PATCH /api/financing-model/sell-side`：追加人工卖方逻辑汇总修订；请求含 `runId`、`logicSummary`，保留原检索口径与来源证据。

### 授信管理

- `GET /api/credit`：读取最新授信报告日。
- `GET /api/credit?date=YYYY-MM-DD`：读取指定报告日；无该日期记录返回 404，无数据库连接返回 503，无效日期返回 400。
- 响应同时返回一览表口径 `summary`、周报名单口径 `weeklySummary`、上一报告日汇总、机构和分项、授信额度变动、使用额度变动及日历事件。
- 周环比基准是小于当前日期的上一可用报告日，不要求恰好相隔七天。授信额度变动和使用额度变动分开计算，新增但使用额为零的机构不进入使用额度变动。
- `PATCH /api/credit`：以 `(reportDate, institutionName)` 定位一条机构记录，`changes.institution` 仅传发生变化的主体字段，`changes.items` 仅传发生变化的分项及字段；主体与分项在同一事务内更新并重算响应。同字段并发修改以后提交者为准，不同字段自然合并；空增量或非法字段返回 400，记录不存在返回 404。
- GET 与 PATCH 均使用 `Cache-Control: no-store`。Excel 解析仍只由本地命令执行，浏览器不上传源文件。

## 通用约定

- JSON 错误使用 `{ "error": "可公开信息" }`；服务端日志可记录诊断信息，但不得包含 Secret 或完整敏感输入。
- 动态生成和台账 JSON 响应使用 `Cache-Control: no-store`。
- 融资择时模型读取、人工结论、历史决策记录、卖方生成和卖方修订响应同样使用 `Cache-Control: no-store`；写接口执行同源校验，但当前不等同于账号鉴权。
- 日期参数使用严格 `YYYY-MM-DD`；起止日期必须同时提供且起始不晚于结束。
- route handler 只做解析、校验、错误映射和服务调用；业务逻辑放入 `src/lib`。
- 兼容跳转 `/bond-ledger` 固定以 308 指向 `/bond`。
