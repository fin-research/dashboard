# 市场点评

入口：`/market-briefing`、`/market-briefing/text`。业务计算与原有报告 Schema 保持一致，生成由 Dashboard `market-briefing` Workflow 持有。

## 定时生成

- Dashboard 共两项 Cron：`0 * * * *` 为每小时整点融资提醒（支持任意提前小时，不能缩成每日一次）；`0 9 * * MON-FRI` 为北京时间工作日 17:00 市场点评。Cron 使用 UTC。Data 午夜同步、Ingest 采集分别由各自 Worker 持有。
- `MARKET_BRIEFING` 绑定 `MarketBriefingWorkflow`，平台名称固定 `market-briefing`。实例 ID 为 `market-briefing-YYYY-MM-DD`，同日重复 Cron 不重复创建。
- Cron 在创建 Workflow 实例前判断 workday；`knownMarketClosure(reportDate) === true` 时立即返回，完全不进入 Workflow。Workflow 内不再判断或返回非交易日 skipped 状态，当前内置2026年公告。`fetch-industry` 要求 DATA `/data/industry` 的 `tradingDates` 包含当天，否则视为行情滞后，由 step 重试并失败，不能误判假期。未知年度只允许有当日行情证据时生成；每年须按交易所公告更新休市日。
- 所有 `step.do` 及其并行、依赖关系直接写在 `worker/market-briefing-runner.ts`，不使用创建 step 的 loader 或 collector 封装。无依赖的行情和新闻列表各为独立 `fetch-*` step 并发执行。股票收评只请求一次，供报告与 AI 共用；一级发行等待行业数据中的上一交易日；债券基础信息等待今日成交和收藏报价后去重批量查询一次；新闻详情等待列表，每条独立 step、最多五条并发。新闻和收评齐备后启动 `generate-focus`，不等待其他行情。各 step 返回最小 DTO 或 AI 结果，通过 Workflow 检查点向下游传递，不在中途写报告。
- 数据步骤最多重试 3 次，30 秒起指数退避，单步超时 3 分钟；AI 步骤最多重试 2 次，1 分钟起指数退避，单步超时 15 分钟，AI adapter 显式关闭内部重试（本工作流的共享 AI 默认规则例外）。采集、AI、保存和通知的重试均只由 Workflow step 配置负责，业务代码不执行重试循环。
- 等所有并行步骤完成或耗尽重试，在唯一 `aggregate-and-save-r2` step 内使用共享 `buildReportData` 与报告 Schema 汇总并保存原 `market-briefing/YYYY-MM-DD.json`。任何必需请求失败不归档残缺报告，也不把失败伪装成零行情。
- 当日成交、期货及报价不支持历史重放；每个未完成的采集 step 校验上海当天，跨日恢复未完成采集会失败，不能以当前行情冒充历史报告。已完成数据步骤与归档步骤可由平台恢复。
- 最后统一执行唯一 `notify-result` step：等待前面的并发请求、AI 和归档结果完成，在此 step 内判断结果、组装通知并通过 Resend 发给 `MARKET_BRIEFING_RECIPIENTS`（当前 `shiyue@18.cn`）。不设成功/失败通知分支或独立 step。通知完成后生成错误继续使 Workflow 失败；邮件自身重试不重新生成报告，也不删除已归档报告。
- 邮件使用 `FROM_EMAIL=no-reply@hasbai.xyz` 和专用 Secret `MARKET_BRIEFING_RESEND_API_KEY`；不启用融资提醒的独立 `RESEND_API_KEY`。统一使用 `market-briefing/<instanceId>/result` 幂等键。`accepted` 仅代表 Resend 接受，不代表收件箱送达。

## 读取与页面

- `GET /api/market-report?date=YYYY-MM-DD` 只读取并校验指定日期的 R2 定稿，512 KiB 上限不变；缺失返回 404 `REPORT_NOT_FINALIZED`，损坏返回 503。
- 不带 date 时，服务端按上海当前时间选日：17:00 前从交易日数据选择严格早于当日的最近交易日；17:00 起严格读取当日报告。日历失败或观测日期落后于已确认的上一交易日返回 503；不会因为报告缺失而改读更早日期。选择非交易日的报告也会明确报错。
- 前端打开、换日期和刷新只 GET 定稿，绝不请求原始行情、不触发 AI、不回退现场生成。数据不存在显示整页错误和重试操作。文字版与视觉版消费同一已归档规范数据，今日聚焦和文字版只读。
- 日期、视图切换、刷新、导出图片和复制保留；导出 PNG 只下载，不上传或覆盖 R2。控件具有可辨识的主次、选中、hover、active、键盘 focus 与 disabled 状态，继续使用既有报告尺寸与品牌令牌。
- 旧 `PUT /api/market-report`、`POST /api/market-briefing` 保留兼容及原写权限，但新版页面不调用；旧 `/api/market-resources/*` 继续仅为已有客户端的公开只读兼容通道。

## 业务规则

- 今日聚焦优先使用给定新闻，联网搜索必须少用、慎用，仅在缺少形成核心判断所必需的信息时补充；材料足够时直接写作，不要求联网核验给定材料。获得必要信息后停止搜索，缺乏支持的判断保留不确定性。Web Search 工具保持可用，稳定 `instructions` 使用直接研究指令，不含日期或 skill 包装；user input 仅含新闻材料。输出格式由严格 JSON Schema `{stock: string, bond: string}` 约束，Workflow 按股、债顺序拼接 `1、` 和 `2、`。
- 利率债列表中的个别收益率缺失按 `null` 接收，保留其他有效行情；规范报告继续保留空收益率，不转为零，也不将整批国债行情标记为资源失败。
- 原始列表的空容器、空行与缺少定位字段的记录不拖累其他记录；成交笔数、两融余额、发行规模、剩余期限和债券分类允许缺失。非空错型仍由单资源错误边界处理，不能将未知科创标志当作普通公募公司债。
- 两融保留最新日期，分别计算有完整两期值的指标；行业与指数保留各自部分值，图表只绘制具备所需数值的项目。交易日缺失时一级发行仍查询报告当日，上一交易日比较留空，不猜测节假日。
- 一级发行规模缺失仍保留明细，相关合计/环比留空，文字显示“规模暂缺”；OMO 任一金额缺失时当日净额和含该日的累计留空，不把部分合计写成完整净投放。定稿 Schema 和文字反向编辑同时支持这些空值。
- OMO 文字输出按报告日过滤规范字段 `operation_date`；排序和数字格式由视觉版与文字版共享派生层统一维护。报告日没有正值投放记录时，文字版明确显示“今日未开展逆回购操作”。
- 一级发行只使用报告日和上一交易日数据。同日、同类型、同发行人的多期限合并、东财排除和缺失票息规范由共享加工层完成；视觉与文字版直接消费 `primary_issues`。
- 二级成交的债券基础信息批量补全、结构化公募公司债类型、五年期限和东财排除由共享加工层完成；普通公募公司债固定以 `bondType=37`、`bondOfferingType=1` 且 `sciTechInnoBondStatus=0` 判断，不根据简称字母猜测；视图派生层继续使用 Theil-Sen / MAD 残差过滤不可比成交。
- 东财存量债的 Bid/Ofr 只有严格大于零才视为有效报价；零值归一为空，不进入文字字段、图表散点或 tooltip，但债券本身及其估值、成交信息继续展示。
- 东财存量债成交收益率须大于零且偏离该券估值不超过 500bp，防止净价（如 100）混入收益率；收藏成交无效时仅回退有效的今日成交。均无效则成交及利差留空，债券、估值和报价保留；回退成交的利差按所用收益率与估值重算。

交易日历来源：[上交所2026年休市安排](https://www.sse.com.cn/disclosure/dealinstruc/closed/c/c_20251222_10802510.shtml)。

## 验证与恢复

2026-09-16 本地验证：类型检查、Worker 类型检查、生产构建、544 项 Node 测试、53 项浏览器用例通过；1 项手机矩形拖拽按原规则跳过。CI 候选运行 `35077845510` 通过 5 项 Python、544 项 Node、构建与 53 项浏览器用例。市场点评桌面/手机的 darwin 与 macos-ci 基线已人工对照；本轮不更新其他模块基线。

手动触发使用 `pnpm exec wrangler workflows trigger market-briefing '{"reportDate":"YYYY-MM-DD"}' --id market-briefing-YYYY-MM-DD`。运行失败时先检查失败步骤，同日可执行 `pnpm exec wrangler workflows instances restart market-briefing <id>`；仅邮件步骤失败时从 `--from-step-name notify-result` 恢复，避免重新采集或覆盖报告。跨日不能补跑实时行情。休市日期应在新年度交易所公告发布后更新 `src/lib/server/market-calendar.ts`。
