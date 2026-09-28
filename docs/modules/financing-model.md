# 融资择时模型

入口：`/trading-research/financing-model`，兼容 `/financing-model`。当前结果契约为 `issuance-forecast-v1`，当前包为 `issuance-coupon`，旧结果不兼容读取、不迁移或重算，原始归档及人工记录保留。方法与选型由 [Quant](../../../quant/docs/ISSUANCE_OPTIMIZATION.md) 维护。

## 接口

- `GET /api/financing-model`：只读取最新新版模型快照、有效整体结论、卖方观点及最近100个新版模型日期。返回当前及未来发行日票面、四组期限/券种情景、市场路径、真实TreeSHAP、逐年逐期限验证；不等待独立业务指标，无新版数据返回404。底层预测契约中的区间、净节约与等待风险保留，页面不展示。
- `GET /api/financing-model?run=<uuid>`：指定新版运行及版本清单；旧相对利差运行不被转换为票面预测。
- `GET /api/financing-model/business-metrics?run=<uuid>`：按指定运行的发行人与行情日期读取 LCR、NSFR、资金缺口和主体利差；页面在模型快照显示后独立加载，版本切换时废弃旧请求。指标失败不阻塞已发布的模型结果。
- `PATCH /api/financing-model/conclusion`：以`runId`增量更新人工`verdict/preferredWindow/narrative`，保留模型基础结论。
- `GET /api/financing-model/decisions`：历史人工决策与结果；旧运行的历史分位可保留，新运行该字段为null，页面不展示旧分位。
- `POST /api/financing-model/decisions`：按`runId`保存必填`decisionAction`及可后补的`outcome`。
- `POST /api/financing-model/sell-side`：追加最近七日研究库逻辑汇总及4—5家机构观点；SSE遵循统一`progress/result/error`，普通JSON成功201。
- `PATCH /api/financing-model/sell-side`：追加人工`logicSummary`修订，保留逐机构观点和来源证据。

DTO位于`src/lib/issuance-model.ts`，读取在`src/lib/server/issuance-model-repository.ts`；人工编辑和历史记录复用既有repository。旧DTO仅供历史人工记录，不再作为当前模型API或页面入口。

## 业务规则

同一模型日期保留稳定runId；较新成功结果更新模型字段和明细，保留人工结论、择时记录及全部卖方快照。乱序旧结果不覆盖新结果，明细失败整次事务回滚。人工编辑结论优先展示，恢复模型内容使用基础结论。

预计票面以百分数表示；净节约和SHAP为bp。预测差额以首个可发行日为基准，不增加等待成本或策略门槛；金额为年化万元。贡献直接使用统一模型的树或线性贡献，正值推高票面，负值降低票面；票面基准加全部贡献必须还原首个发行日票面。条形图展示绝对值最大的八项，并保留有贡献的宏观、一级、二级代表项；完整贡献保存并由API返回。不能将贡献改号为旧发行支持度。

发行建议由Quant同一票面模型的预测路径生成：可发行日期按预测票面选最低25%，向上取整并保留边界并列，连续可发行日期合并区间。最早日期已在集合内则“尽快发行”，否则“等待”。不增加独立暂缓模型或P40/2bp门槛。原人工动作记录保留。未人工编辑的结论显示首日票面与较低区间，人工正文原样保留。四品种布局和顺序不变，逐方案调用同一个模型，不分别加载模型包。
第一张卡为整体结论：右上角三档标签、债券品种及预计票面，结论正文始终为可编辑文本框；有 `model.conclusion:update` 权限时 650ms 防抖及失焦保存，无权限时只读，不显示编辑按钮。第二张卡为业务指标：LCR/NSFR 从 `public.quant_input` 的 `company` 本地工作簿序列按模型行情日期截断；资金缺口使用 `company_report.static_gap_1m` 的资金日报口径，单位亿元，不与旧资金计划缺口混用。三者显示当期值与截至当期的经验历史分位。主体利差从 `bond_issuance` 的同发行人 AAA 普通固息无权债池与 `bond_history` 同日估值/余额/剩余期限计算，匹配同日 AAA 证券公司债曲线并按正余额加权；最近60个可匹配行情日中只用完整利差计算分位。任何预期活跃券余额未知、正余额券估值/期限或曲线缺失时当日利差为空。各分位至少20个有效观测才显示；卡片只显示“历史P”，不附日期。业务指标仍独立查询，不因模型改造改变来源，也不是一级可执行票面。

整体结论、业务指标与四品种对比顺序排列；因子贡献合为一张卡，左侧雷达按真实非零SHAP的类别净值显示利率、信用、资金、宏观、一级、二级与日历贡献，避免同类正负贡献按绝对值重复累加。右侧显示主要因子，合并不同观察期的同名利率变化因子，并保留有贡献的宏观、一级、二级代表项。未来发行窗口/模型验证按3:1展示，窄屏保持顺序单列；窗口图和明细只展示预测票面。模型验证保留原位置和布局，显示训练事件数、标签截止日、模型当年提前30日的检验样本、预测胜率（1σ）及MAE。胜率为实际票面减预测票面不超过评价前冻结误差标准差的比例；少于30笔校准事件时为空。高估也可能成功，不能把胜率视为准确率或等待收益。API同时保留偏差与标准差。窗口明细、决策录入和卖方生成继续使用原操作。2026等已观察历史不标作独立前向测试。

卖方检索沿用研究库`https://research.hasbai.xyz/mcp`，最近七日、研报类型、最多50条；模型上下文只包含票面、净节约、风险、市场路径和SHAP，不再混入旧分位驱动。

## 数据流与存储

Data维护原始行情和真实定价字段 → Quant统一票面模型推理 → R2冻结结果 → `financing_model.publish_online_result`原子发布 → Dashboard从结构化表重建新快照。主报告 GET 只读取已发布模型与人工内容；独立业务指标 GET 另读 Data 原始输入表，两者均不触发训练、推理或写库。

| 表 | 归属内容 |
|---|---|
| `model_run` | schema_version=4的日期、方案、来源版本、基础/人工结论；旧模型行保留历史 |
| `issuance_run` | 截止日、决策、风险、SHAP基准、验证及日历来源 |
| `issuance_run.product_scenarios` | 同一首个可发行日的四组期限/券种票面估计与样本数 |
| `issuance_forecast` | 有序发行日票面、区间、净节约、成熟标签与样本数 |
| `issuance_market_path` | 完整自然日市场路径、报价/发行日、carry来源日 |
| `issuance_shap` | 全部特征值及原始SHAP，主键run_id/ordinal |
| `issuance_validation` | 各年各提前期事件数、冻结sigma、单侧胜率、MAE/RMSE、偏差及同样本基准 |
| `timing_decision_record` | 人工操作与事后结果 |
| `sell_side_snapshot` | 研究库观点与人工修订的追加快照 |

旧`model_run_market_driver/driver_group/product_scenario/forecast_window`仅保存历史。数据库不保存原始模型JSON；原始证据保存在R2。Quant不写人工结论、决策或卖方观点。

## 线上发布与验收

`0008_issuance_forecast.sql`、`0009_issuance_full_inputs.sql`、`0010_issuance_report_repair.sql`与`0011_unified_coupon.sql`由Dashboard维护，通过`pnpm financing-model:db:migrate`应用。发布只接受真实`cloudflare-workflow`、`issuance-coupon`来源与匹配的R2归档key；校验模型有效期、输入/标签日期、市场路径及SHAP加法与票面一致性。旧结果契约发布被拒绝。

Quant工作日08:30运行，归档`quant-trial/runs/{date}/{instanceId}/result.json`后发布。默认本地CLI不写生产；维护补发只能使用已验证的实际Workflow归档。迁移顺序为Data输入 → Dashboard表/API/页面 → Quant新包/Worker → 实际Workflow与生产API核验。模型发布和重训规则见 [线上推理](../../../quant/docs/ONLINE_INFERENCE.md)。

测试包含PGlite真实migration/发布/回滚/人工内容保留、DTO/API及桌面/手机浏览器组件截图。组件夹具测试不等于生产鉴权E2E；生产链路以实际Workflow、数据库和程序化HTTP证据验收。
