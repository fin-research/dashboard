# 跟踪点评

入口 `/trading-research/tracking-commentary`，归集全部 `research_commentary`（时事快评、政策跟踪、海外事件）。政策时间轴只保留关联入口；旧 `/commentaries/[id]` 支持无政策关联的历史稿。原政策生成 API 是新生成管线的兼容入口，旧人工保存接口保留。

## 数据与历史导入

不改变共享 `research_commentary` 的列、ID 或 `policy_id`；Ingest 仍按点评存在性保护政策。Dashboard migration `1017` 新增 workspace 与 revision 伴随表，不改变 Ingest 本地初始化或读写契约。workspace 保存初始来源、手写原文、原文件名/SHA256、选取的研报原句与检索范围，不保存完整研报正文。同步脚本原本只同步 article/keyword/hotspot，本模块不隐式添加线上点评下载。

`origin` 表示材料来源，`edited` 表示当前是否人工修订：导入稿编辑后仍保留手写来源；重新生成后 origin 为 AI，但手写 originalText 和文件哈希保留。数据库触发器在每次更新前归档旧版，涵盖旧政策接口；版本 API 同时返回当前稿和最近50个历史版本。生成与人工保存使用 updatedAt 乐观锁，冲突返回409，失败保留输入。

导入预览：

```sh
python3 scripts/import-tracking-commentaries.py --input '<材料目录>' --output '/tmp/tracking-commentary-import'
```

核对后使用相同命令加 `--apply --remote`。先应用 `1017`；只做按内容SHA256的幂等插入，不覆盖旧点评或人工修改。Word优先、PDF兜底，同目录同 stem 的DOCX/PDF/MD归为一篇；不同版本内容保留为不同记录。按文内日期，不使用mtime；确实缺失日期/建议保留空值。原文标题、段落、对比表完整保存，表格以安全文本单元格展示。原文件、导入SQL、manifest不进入Git。

## 撰写与取材

用户填主题、类型、事件/点评日期、研报日期范围，保存草稿后手动生成。默认最近7个上海自然日；从政策进入时以政策日期初始化范围，可修改。页面加载/筛选不调用模型。

通过研究库 MCP `search` 进行主题与固收传导两次检索，每次50条、研报类型与published_at硬过滤；合并同key，不截断返回的原文块。关联政策的已有研报正文在所选日期内通过 DATA 最多5路并发读取；政策资讯作为事实材料。无研报或材料超过250000字符明确失败，要求调整主题/日期，不编造或裁切来源。新管线不使用模型 Web Search 生成不可逐字核验的摘录。

AI Gateway使用 `policy_commentary` effort与版本化Prompt，输出选材而非正文改写：摘要和2—4点正文均为原文摘录，标题表达判断，融资建议独立撰写且必须关联已摘录来源。应用校验完整句界、逐字子串、来源ID及无行动套话；失败进入既有同模型重试一次。通过后由程序组装正文；保存源key、机构、日期、原句位置和检索文档哈希。机构/标题/时间只来自检索元数据，不接受模型填写。原文的条件和分歧不得删去，明确观点不等于虚构确定性。

接口 `/api/tracking-commentaries` GET/POST（列表/建稿）、`/[id]` GET/PUT（读取/修订）、`/[id]/generate` POST（NDJSON进度/完成/失败，15秒心跳）、`/[id]/revisions` GET。创建/修订使用既有 `research.policy_commentary:update`，生成使用 `research.policy:generate`，读取使用 `research.policy:read`；由 Gateway 登记并同步展示契约。连接中断不保证后台继续生成，用户重新打开草稿读取实际保存结果。

## 手写稿与旧 AI 稿诊断

38篇历史稿的共同优势：判断先行、边际变化清楚、传导后落到具体融资安排；会议类需要对比表，不应强制全部变成三段。4篇没有单列建议，不能导入时补写。原D1仅有1条 `policy-commentary-v3` 且 edited=1，未保留修改前AI稿，不能声称完成同题原始AI与手写稿的严格对照。提供的GPT链接未能读取内部提示词。

旧Prompt要求“吸收卖方框架后独立形成结论”，并示范“中性偏防御”“若…可…”；容易产生再概括和泛化建议。新Prompt把任务改为“选择已有判断原句”，程序直接组装，只有标题与资金部操作建议允许原创。历史数据、仓位上限和具体数值不写入风格示例，避免模型把旧判断移植到新事件。原始AI版本与人工修订分开留档，以便后续真实对照。
