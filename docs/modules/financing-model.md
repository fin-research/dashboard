# 融资择时模型

入口：`/trading-research/financing-model`，兼容 `/financing-model`。当前契约为 `issuance-forecast-v1`，模型为 `issuance-lgb-v1`。方法与选型由 [Quant](../../../quant/docs/RATE_RESEARCH.md) 维护。

## 接口

- `GET /api/financing-model`：最新新版模型快照、有效整体结论、卖方观点及最近100个新版模型日期。返回当前及未来发行日票面和区间、市场路径、真实TreeSHAP、逐年逐期限验证，以及独立的业务指标；无新版数据返回404。底层预测契约中的净节约与等待风险保留，页面不展示。
- `GET /api/financing-model?run=<uuid>`：指定新版运行及版本清单；旧相对利差运行不被转换为票面预测。
- `PATCH /api/financing-model/conclusion`：以`runId`增量更新人工`verdict/preferredWindow/narrative`，保留模型基础结论。
- `GET /api/financing-model/decisions`：历史人工决策与结果；旧运行的历史分位可保留，新运行该字段为null，页面不展示旧分位。
- `POST /api/financing-model/decisions`：按`runId`保存必填`decisionAction`及可后补的`outcome`。
- `POST /api/financing-model/sell-side`：追加最近七日研究库逻辑汇总及4—5家机构观点；SSE遵循统一`progress/result/error`，普通JSON成功201。
- `PATCH /api/financing-model/sell-side`：追加人工`logicSummary`修订，保留逐机构观点和来源证据。

DTO位于`src/lib/issuance-model.ts`，读取在`src/lib/server/issuance-model-repository.ts`；人工编辑和历史记录复用既有repository。旧DTO仅供历史数据与兼容测试，不再作为当前模型API或页面入口。

## 业务规则

同一模型日期保留稳定runId；较新成功结果更新模型字段和明细，保留人工结论、择时记录及全部卖方快照。乱序旧结果不覆盖新结果，明细失败整次事务回滚。人工编辑结论优先展示，恢复模型内容使用基础结论。

预计票面以百分数表示；净节约和SHAP为bp。净节约以首个可发行日为基准，扣除等待成本；金额为年化万元。SHAP直接使用真实树贡献，正值推高票面，负值降低票面；票面基准加全部贡献必须还原首个发行日票面。展示绝对值最大的八项，完整贡献保存并由API返回。不能将贡献改号为旧发行支持度。

发行建议仍由已发布的Quant模型生成；页面将“可按资金计划发行”明确显示为“尽快发行”，“可择机等待”显示为“等待”，“暂缓发行”原样显示。未经人工编辑的旧模型结论正文同步改为对应的三档业务结论，不再呈现窗口净节约或等待概率；人工正文原样保留。无法识别的模型动作不猜测为三档之一。此映射只是业务标签，不替代模型或制造已验证的择时收益。旧分位三等分、六维支持度、四品种相对中位数推荐及旧胜率不再用于当前结论。

第一张卡为整体结论：右上角三档标签、债券品种及预计票面，结论正文始终为可编辑文本框；有 `model.conclusion:update` 权限时 650ms 防抖及失焦保存，无权限时只读，不显示编辑按钮。第二张卡为业务指标：LCR/NSFR 从 `public.quant_input` 的 `company` 本地工作簿序列按模型行情日期截断，显示当期比率与截至当期的经验历史分位；主体利差从 `bond_issuance` 的同发行人 AAA 普通固息无权债池与 `bond_history` 同日估值/余额/剩余期限计算，匹配同日 AAA 证券公司债曲线并按正余额加权。任何预期活跃券余额未知、正余额券估值/期限或曲线缺失时利差为空；业务指标不是当前 LightGBM 的预测输入，也不是一级可执行票面。

整体结论与业务指标上下排列；因子贡献合为一张卡，左侧雷达汇总全部真实树 SHAP 的绝对贡献强度，右侧保留当前单因子 SHAP 正负条形图。未来发行窗口/模型验证按3:1展示，窄屏保持顺序单列；未来窗口只展示票面及区间。窗口明细、决策录入和卖方生成仍使用标题旁操作。模型验证区分票面MAE与市场变化MAE；2026为已观察研究参考期，不标作新独立测试。

卖方检索沿用研究库`https://research.hasbai.xyz/mcp`，最近七日、研报类型、最多50条；模型上下文只包含票面、净节约、风险、市场路径和SHAP，不再混入旧分位驱动。

## 数据流与存储

Data维护原始行情和真实定价字段 → Quant LightGBM推理 → R2冻结结果 → `financing_model.publish_online_result`原子发布 → Dashboard从结构化表重建新快照。页面GET只读，不触发训练、推理或写库。

| 表 | 归属内容 |
|---|---|
| `model_run` | schema_version=4的日期、方案、来源版本、基础/人工结论；旧模型行保留历史 |
| `issuance_run` | 截止日、决策、风险、SHAP基准、验证及日历来源 |
| `issuance_forecast` | 有序发行日票面、区间、净节约、成熟标签与样本数 |
| `issuance_market_path` | 完整自然日市场路径、报价/发行日、carry来源日 |
| `issuance_shap` | 全部特征值及原始SHAP，主键run_id/ordinal |
| `issuance_validation` | 各年各期限样本数、MAE/RMSE、同口径不变基准 |
| `timing_decision_record` | 人工操作与事后结果 |
| `sell_side_snapshot` | 研究库观点与人工修订的追加快照 |

旧`model_run_market_driver/driver_group/product_scenario/forecast_window`仅保存历史。数据库不保存原始模型JSON；原始证据保存在R2。Quant不写人工结论、决策或卖方观点。

## 线上发布与验收

`0008_issuance_forecast.sql`由Dashboard维护，通过`pnpm financing-model:db:migrate`应用。发布只接受真实`cloudflare-workflow`、`issuance-lgb-v1`来源与匹配的R2归档key；校验模型有效期、输入/标签日期、市场路径及SHAP加法与票面一致性。旧契约发布被拒绝。

Quant工作日08:30运行，归档`quant-trial/runs/{date}/{instanceId}/result.json`后发布。默认本地CLI不写生产；维护补发只能使用已验证的实际Workflow归档。迁移顺序为Data输入 → Dashboard表/API/页面 → Quant新包/Worker → 实际Workflow与生产API核验。模型发布和重训规则见 [线上推理](../../../quant/docs/ONLINE_INFERENCE.md)。

测试包含PGlite真实migration/发布/回滚/人工内容保留、DTO/API及桌面/手机浏览器组件截图。组件夹具测试不等于生产鉴权E2E；生产链路以实际Workflow、数据库和程序化HTTP证据验收。
