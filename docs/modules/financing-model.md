# 融资择时模型

入口：`/financing-model`。公共规则见 [文档分流](../INDEX.md)；仅在任务涉及本模块时读取。

## 接口

- `GET /api/financing-model`：返回最新 quant 模型快照、当前有效整体结论、最近卖方观点和最近 100 个可选模型日期版本；模型快照包含实际 LCR/NSFR、六类 SHAP 驱动结构、Top 因子贡献、四种品种相对各自同类债中位数的预测偏离、完整训练样本区间与样本外验证指标；无模型运行返回 404。
- `GET /api/financing-model?run=<uuid>`：读取指定运行并同时返回可选版本清单；模型基础字段保持不变，当前整体结论可由 PATCH 增量更新。
- `PATCH /api/financing-model/conclusion`：增量更新目标 `model_run` 的当前整体结论；请求含 `runId`、`verdict`、`preferredWindow`、`narrative`，不修改模型基础结论。
- `GET /api/financing-model/decisions`：读取历史择时决策记录；日期、历史分位和发行建议来自对应模型运行，按模型日期倒序返回。
- `POST /api/financing-model/decisions`：按 `runId` 新增或覆盖一条人工记录；`decisionAction` 必填，`outcome` 可在结果形成后补录，不设置状态字段。
- `POST /api/financing-model/sell-side`：按 `runId` 使用 AI Search 与 AI Gateway 生成并追加卖方逻辑汇总及 4–5 家逐机构观点，成功为 201。
- `PATCH /api/financing-model/sell-side`：追加人工卖方逻辑汇总修订；请求含 `runId`、`logicSummary`，保留原检索口径与来源证据。

## 业务规则

- 页面默认展示最新 `model_run`，并允许按模型日期切换历史运行；同一模型日期只保留一条模型记录，重复上传覆盖模型字段和有序明细，保留当天稳定 runId、人工结论、决策记录和全部卖方快照；晚到的较早生成结果不会覆盖较新结果。
- 人工编辑过的整体结论优先展示；未人工编辑时，整体结论标题跟随该运行的正式发行建议 `recommendation_label`，避免与融资窗口判断冲突，基础结论正文和模型原始字段保持不变。
- 驱动结构雷达图围绕中性值 50 自适应显示范围以提高类别辨识度；图中和 tooltip 使用的支持度原值不做放大或重算。

- 正式发行建议按各债券类型与期限组的历史预测分位三等分：P≤33⅓ 为“建议发行”，33⅓<P≤66⅔ 为“建议等待”，P>66⅔ 为“暂缓发行”；分组不足时沿用全局历史预测分布。该规则统一用于主结论、品种方案、未来窗口和仪表盘，不强制实际日期数量各占三分之一。
- 新运行的模型验证按样本外预测最低三分之一评估推荐样本；旧运行保留当时实际验证指标，不据新分档虚构历史胜率或节约值。
- 页面前两行按 1:1 对齐；品种推荐/模型推荐与未来发行窗口/模型验证统一按 3:1 对齐。模型推荐拆为品种、建议和两项数值；样本区间以两行 `年/月` 展示。
- 卖方检索直连研究库 `https://research.hasbai.xyz/mcp` 的 `search` 工具，保留最近七日、研报类型及最多 50 条的硬过滤。

## 数据流

quant pipeline → 本地结构化结果 → Neon `financing_model.model_run` 标量列、原生数组及有序明细表 → dashboard 重建最新运行。人工结论通过 PATCH 增量更新同一条 `model_run` 的当前结论列；卖方观点由页面手动触发，Worker 使用模型日期最近七个上海自然日的 AI Search 证据，经 AI Gateway 严格 Schema 归纳为单段逻辑汇总及 4–5 家逐机构观点后追加保存。人工编辑逻辑汇总时保留原逐机构观点和检索证据，并追加新快照。

## 存储：Neon：融资择时模型

Worker 通过同一 `HYPERDRIVE` 访问 `financing_model` schema：

- `model_run`：quant pipeline 按模型日期覆盖的结构化模型记录；标量直接落列，完整训练样本量与起止发行日独立于样本外验证指标保存，校验迭代、分组均值和优选日期使用 PostgreSQL 原生数组，当前整体结论与模型基础结论分别落列。
- `model_run_market_driver`：每次运行的有序市场驱动因子，主键 `(run_id, ordinal)`。
- `model_run_driver_group`：六类正式特征组的局部 SHAP 发行支持度与权重，主键 `(run_id, ordinal)`。
- `model_run_product_scenario`：3Y/5Y 公募债与次级债四种方案相对各自同类债中位数的同批预测、排序及推荐标记，主键 `(run_id, ordinal)`。
- `model_run_forecast_window`：每次运行的有序未来发行窗口，主键 `(run_id, ordinal)`。
- `timing_decision_record`：每次模型运行至多一条人工决策记录，只保存决策操作和结果；模型日期、历史分位与发行建议从 `model_run` 派生，不设状态列。
- `sell_side_snapshot`：AI Search 检索与 AI Gateway 归纳后的卖方逻辑汇总及人工修订追加快照，读取最新一条。

规则：

- migration 只放 `financing-model-migrations/`，使用 `pnpm financing-model:db:migrate` 应用。
- `model_run` 不保存原始 JSON；dashboard 从结构化列和有序明细表重建前端快照，quant 不写人工结论、历史决策记录和卖方观点。
- 人工结论只增量更新目标 `model_run` 的 `conclusion_*` 与 `conclusion_updated_at`；模型基础结论列保持不变。生成的卖方观点和人工卖方逻辑汇总继续追加保存。
- 历史择时决策记录按 `run_id` upsert；决策操作必填，结果允许后补，二者均由人工输入，不从模型预测自动生成。
- 卖方快照只保存结构化观点、检索口径和源文档 key，不保存 AI Search 返回的完整正文。
