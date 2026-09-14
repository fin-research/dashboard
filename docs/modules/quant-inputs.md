# 债券模型输入

Dashboard 维护原始模型输入的日常入库和 migration；Quant 维护特征工程与模型。两融模型及其 17 字段不在此流程范围内。

## 存储和口径

- `public.edb` 保存资金利率与宏观指标。资金面与 Choice ID 对应见 `src/lib/server/quant-input-contract.ts`；国开债 3Y/10Y 为 `E1701708`/`E1701714`，AAA 企业债 3Y 为 `E1000413`。DR007/R007、SHIBOR O/N/1W/3M 走 DM history；SHIBOR 读取 `lastPrice`，不使用 DR/R 的 `weightedYield`。O/N 的 DM 参数为 `ShiborO/N`，3M 的 EDB ID 为 `E1300079`；O/N、1W 的内部存储代码为 `DM_SHIBOR_ON`/`DM_SHIBOR_1W`，不是虚构的 Choice ID。
- GDP 统一为已有 `EMM00000012` 不变价同比，Quant 按真实发布日期对齐。不得将现价同比填入此 ID。部分 2019 年货币指标没有上游发布日期，`published_date` 保持 NULL；页面的发布日期查询不会使用这些行，不能据此声称具有完整历史时点版本。
- `public.quant_input` 是按 dataset/entity/field/观察日保存的原始字段表，区别于 `financing_model` 的模型结果。权益价格和全A估值在 `equity`，二级成交在 `secondary`，AAA 全市场发行统计在 `primary`，券商发行明细和发行利差在 `issue`。其字段名沿用 Choice 或明确的模型映射。数值与文本分别存储，缺失值不入库、不填零；保留来源 key、内容哈希及首次落地时间。未知发布日期不伪造。
- 金额单位：权益总市值/成交额为元；债券发行/成交和公司金额为亿元；收益率及成交占比为百分数；发行/主体利差为 bp；公司 LCR/NSFR 为小数比率。`company` 保留本地资金计划表口径，`company_report` 保存资金日报口径。
- R2 `fund-reports/YYYY-MM-DD.html` 只解析有限的静态数字，不执行 JavaScript。`company_report.static_gap_1m` 是日报的静态缺口，不能覆盖资金计划表的 `company.funding_gap_1m`。`margin_scale_previous_trade` 明确保留“截至上一交易日”标签，观察索引为报告日；未经交易日历转换不能当作报告日公司余额。日报没有主体利差，原本地历史单独保留。

## 日常更新

既有 `EconomicIndicatorSyncWorkflow` 的 EDB/DM 更新结束后执行 `worker/quant-input-run.ts`：

1. 通过 DATA binding 拉取有限窗口的权益 CSD、债券 CTR；融资统计接口返回整个请求区间的合计，因此逐日查询，不把多日汇总冒充日频数据。
2. 请求与入库分成独立 durable step，入库重试不会重复付费查询；付费输入请求不自动重试。源失败彼此隔离，保存在 `public.quant_input_sync`，不覆盖已落地值。
3. 发行利差每次最多取 64 只尚无利差的券；明确失效的代码登记为待处理并排除自动付费重试，尚未发布利差的有效新券继续增量重查，避免永久卡住下一批。
4. 分页枚举 R2 固定前缀，只下载 ETag 变化的报告。保留原 HTML，同日更正按来源更新规范化字段。

维护时可使用 Workflow 参数 `quantOnly: true` 只刷新新增输入，避免重放已有 EDB 查询。`partial` 表示仍有失败来源，不等于完整模型覆盖。Choice 的 `BondTradingStatistics` 需要账户权限；拒绝访问时仅记录失败，不能用其他债市成交口径代替。

## 一次性回填

先在数据库副本应用 `pnpm edb:db:migrate` 并验证，再对生产执行同一 migration。命令均从本仓库运行；连接通过 `DATABASE_URL` 或既有 Hyperdrive 本地环境变量注入，凭证和源文件不得提交。

```bash
# 不调用 Choice；默认盘点，--apply 只插入不存在的线上键
node scripts/backfill-quant-inputs.ts --directory /absolute/quant/data
node scripts/backfill-quant-inputs.ts --directory /absolute/quant/data --apply

# DM 全历史只需首次请求；--replay 复用已缓存数据写入生产
node scripts/backfill-quant-edb.ts --apply --dm-shibor --cache-directory /private/cache

# 2019 M2/社融显式小范围 EDB 查询结果；不自动请求其他指标
node scripts/backfill-quant-edb.ts --apply --macro-json /private/macro.json --cache-directory /private/cache

# 本地受控维护使用短期 DATA_API_BEARER_TOKEN；--replay 不再请求上游
node scripts/sync-quant-market.ts --apply --start YYYY-MM-DD --end YYYY-MM-DD --sources equity,primary,issue --cache-directory /private/cache

# 只解析已从 R2 下载的日期文件；无 --apply 时仅校验
node scripts/backfill-quant-fund-reports.ts --directory /private/fund-reports --apply
```

回填保留已有线上值；重跑不重复增加键。检查覆盖需同时核对最早/最晚观察日、字段非空数、来源状态和发布日期缺失，不能只看总行数。历史工作簿缺失的公司资金缺口与主体利差不会被伪造。
