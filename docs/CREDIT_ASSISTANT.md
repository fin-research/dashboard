# 授信问答

入口：`/credit-workbench/assistant`，归属首页一级授信工作台；`/credit-assistant` 和 `/trading-research/credit-assistant` 重定向到新入口。面向内部同事生成供客户使用的答复和资料来源，不自动向客户发送消息。

界面为单一聊天流，不展示问答/材料双模块、材料目录或预设提问案例。用户在底部输入框提问或索取文件，答复内的附件卡片直接下载原件（`?download=1`）；全文证据有明确 PDF 页码时来源链接可打开原页，AI Search 片段仅标记检索片段并链接原件，不虚构页码。Enter 发送、Shift + Enter 换行，中文输入法确认不会触发发送。问题无业务字数上限，仍拒绝空输入；HTTP 请求体保留 1 MiB 的内存保护上限。

提交后由 SSE 推送会话状态和模型正在生成的正文，UI 分开展示“问题判断、检索材料、生成答复、证据复核”四阶段及当前进度。正文从 Responses 的 output_text 增量中提取 answer.paragraphs 的文字，不显示结构化工具 JSON、引文 ID 或 reasoning 内容；模型复核或更正后由完成答复替换草稿。仅任务进行中保持 SSE 连接，结束即关闭；中断后重连先收到当前快照，不重复提交问题。正在生成时可起草下一条消息；进行中和失败的问题保存在会话中，刷新后仍可查看或重试。

输入框上方的“客户名称”必须通过授信库搜索并点击候选机构（也支持方向键、Enter）完成选择，展示已签署或未签署的保密协议状态。机构与协议状态来自服务端授信库。选择、提交及新的会话读取/下载请求按既有数据库查询核对，客户端或对话中自述已签署不能授权。一次生成使用提交时确认的客户协议快照，生成结束不再重复查询协议和材料目录。切换客户恢复该用户对应客户的会话。

## 保密规则

- 仅原件路径与目录一致且位于顶层 `定期报告/` 的文件可公开；其他目录及未识别旧路径全部需要保密协议，审计/披露标签不代表可公开。只有布尔值 `true` 可以访问保密材料。
- `定期报告与审计` 改名为 `定期报告`；`风险控制指标监管报表专项审计报告2025.pdf` 移至 `风控与监管指标/2025年/`；`风控与监管指标/历年汇总/监管指标.xlsx` 移至 `定期报告/财务与监管指标.xlsx`。其他风控统计文件仍保密。
- 未签署机构的模型上下文仅含公开目录、公开原文和当前仍可提供的同机构历史答复；AI Search 的受限结果只用于服务端判断材料是否存在，不进入生成或复核上下文。明确索取受限原件时无需模型即可拒绝；工具读取、附件、引文或计算输入引用受限 ID 时直接拒绝。公开证据不能完整回答且存在受限检索结果时返回统一拒绝答复。
- 拒绝答复固定为“该机构尚未签署保密协议，请提交授信流程签署保密协议之后方可提供该数据。”，不携带数据、引文、计算、附件或原始模型的补充说明。
- 每份答复记录客户和模型接触的文档范围，覆盖正文、附件、未引注说明及历史上下文。正在生成的答复与流式输出沿用提交时的权限，不在完成时复查；后续新的会话读取、复制、下载和追问仍按当时状态处理，撤销协议、文件退出目录或调整为保密会阻止后续提供受限历史。已签署机构生成时接触过保密目录的答复会保守地按保密历史处理。
- 原件链接携带 `institutionName` 和 `turnId`，保密文件仅在当前登录用户对应客户会话的该轮答复确实提供过附件或来源，且机构当前已签署时允许读取。其他用户拿到同一个链接不能读取该用户的保密附件。直接拼 ID、旧会话链接、HEAD 和 Range 均遵守同一规则，校验通过前不读取原件字节。公开材料仍须通过全站登录校验。

## 方案

在 Dashboard 的自定义 Worker 内使用 Cloudflare Agents SDK。`authorizeRequest` 返回的已验证 `user.auth0Id` 与客户名称经 SHA-256 生成固定 DO 名称；不能从用户输入、Header 或 Cookie 接受用户 ID。相同用户和客户在不同浏览器恢复同一份会话，不同用户或客户隔离。浏览器只在 localStorage 保存上次选择的机构名称，不保存答复/材料；每次内容访问仍需登录。

通过 `schedule()` 持久化到 SQLite Durable Object alarm 后执行问答，SSE 订阅阶段和正文；断线不终止任务，重新连接恢复当前快照。阶段与完成答复通过 `setState` 保存，正文增量仅在 DO 内存中合并，每 100ms 最多推送一次，不逐 token 写 SQLite；实例重启后进行中的临时文字重新生成，完成答复与问题不丢失。旧队列迁移仍先写幂等定时任务再移除旧队列记录。“新对话”在同一个 DO 的 `credit_conversation_archive` 表中归档现有对话后清空当前上下文，保留客户。此前随机 Cookie 对应的 DO 不自动归属任何用户，也不删除原存储。

```text
本机材料 ── 只读解析 / OCR ── R2 credit
                              ├─ originals/ 原件
                              ├─ search/ 分类目录/原文件名.md ── AI Search credit 自动分片
                              └─ catalog/corpus.json 当前有效资料目录与全文

工作台 ── /api/credit-assistant/* ── CreditAgent
                                     ├─ 问题范围判断 → 范围外固定拒答
                                     ├─ AI Search 混合检索 → 直接引用片段 + 原件卡片
                                     ├─ 全文回退 / 引文校验 / Decimal 计算
                                     └─ AI Gateway custom-codex → gpt-5.6-luna / max
                                         └─ SSE 正文与阶段 → 独立证据复核 → 完成答复
```

R2 保留原始文件名和分类目录，例如 `originals/定期报告/2025年度/公司审计报告.pdf` 与 `search/定期报告/2025年度/公司审计报告.pdf.md`。AI Search 只调用 `search()`，不调用其生成回答接口。其返回片段可直接作为来源和计算输入，使用文档、对象 key 与文本摘要生成稳定来源 ID。对象 key 必须映射到当前权限允许的材料目录（`searchFiles`，旧 `searchKey` 兼容），不能自由构造下载地址；不为引用重新检索全文、不改写或截取返回片段。引用和计算涉及的原文件自动生成附件卡片，无需模型额外列入 attachments。索引同步与目录发布仍分别验收；直接引用索引片段不代表已核对最新原件中的页码或文本一致性。

AI Search 没有可用结果、不可用或超时时，才使用 Worker 内存中的全文关键词检索。该过程不执行 D1 查询，但占用执行计算；R2 目录读取、DO 请求/持续连接与会话 SQLite 存储分别产生对应资源用量。SSE 仅在运行时保持连接、完成即关闭，以减少空闲持续连接用量。

每次语义检索等待最多 60 秒，超时即用当前全文证据继续并显示提示。模型上游返回 HTTP 429 时，结束本次任务并提示服务繁忙或额度受限；不自动改用其他 Provider。

本功能根据用户明确指定使用 `credit_answer` 任务类型，固定 `custom-codex/responses`、`gpt-5.6-luna`、`reasoning.effort=max`，不切换 Provider。其余业务也统一使用 codex，可重试失败时仅重试同一 Provider 一次。所有生成请求和复核请求复用 `src/lib/server/ai-gateway.ts`，使用既有 `CF_AIG_TOKEN` Secret 和 Gateway BYOK。

当前提示词均在 `src/lib/server/credit-assistant.ts`：范围判断 `credit-scope:v1`、主循环 `credit-assistant:v3-stream-search`、独立复核 `credit-review:v1`。范围判断覆盖授信流程及公司经营、财务、股东、融资、风控、监管资料，也允许相关连续追问与格式整理。范围外问题在材料检索前返回固定文案“我只能回答授信业务、公司数据及相关资料问题，无法处理与这些内容无关的请求。”，不附来源或文件。主循环还可通过 `refuse` 动作拒答；范围判定失败不视为允许。

## 证据规则

- PDF 按实际文件页码定位，原生文本使用保留布局的提取；扫描页 OCR 后标记 `ocr`。Word 保留原文段落/表格顺序，引用“段落 N”或“表 N 第 M 行”；不虚构 Word 页码。Excel/XLS 按工作表、行和单元格地址保存，重复表头与单位上下文。XLSX 同时保留公式及缓存值，缺失缓存不当作零。
- 文件 SHA-256 与相对路径生成文档标识，整理目录时通过前一份目录按摘要复用 ID，使既有下载链接继续有效；原件副本保持原字节。文件内容变化后产生新的 ID，旧版本退出当前资料目录。资料库、原件和本地证据均不提交 Git。
- 正式审计和披露优先；客户历史答复、内部业务材料、待部门确认稿分别标记。文件修改时间不代表报告期。同名指标必须区分主体、合并/单体、年度列、币种、单位及纳入剔除口径。
- 每段事实答复必须引用已读取来源中的连续文本（可为 AI Search 片段或全文证据）。来源标题、定位和下载地址由程序生成。资料不足时明确待补充事项；不得从现金流科目或公司常见业务推断具体出资方、银行或用途。
- 四则运算使用有界语法解析与 Decimal，不执行模型代码。每个输入都要在引用原文中找到，记录原值、单位、来源和表达式；除零、未知变量、任意常数和伪造数字会被拒绝。
- 答复另经一次模型证据复核，核对引用的语义、年度、合并范围和单位。模型复核并不等于人工核验：引用扫描页、待确认稿或历史答复会保留显式说明，对外使用前应核对相关原页和口径。
- 工具循环最多 12 步，模型复核最多 2 次，单次核对总时限 12 分钟；模型请求时限随剩余预算缩短。单个会话最多 30 轮或约 1 MB 已保存内容，达到上限提示新建会话。错误不会伪装成已完成答复。

## 材料准备与更新

先用 `scripts/organize-credit-materials.py` 按报告类别、年度和反馈机构整理本地文件。该脚本在移动前写出逐文件映射和 SHA-256 清单，拒绝目标重名，移动后复核字节；除明确指定的监管指标汇总表重命名外保留原文件名；已整理目录也会执行公开目录迁移，重复运行不再改动目标路径。转换脚本本身只读原件。

依赖：`uv`、MarkItDown（Word）、OpenPyXL/XLRD（财务表格）、Poppler 的 `pdftotext`/`pdftoppm`；旧 DOC 转换需要 LibreOffice。Python 的读取依赖记录在脚本 PEP 723 元数据内。macOS 推荐 Vision OCR，以页面坐标恢复表格行；可选 Tesseract 需要中文及英文语言包。

```sh
mkdir -p .credit-local
# 首次整理；不加 --apply 为预览，实际执行须使用另一份清单路径
python3 scripts/organize-credit-materials.py \
  --source "$HOME/Library/CloudStorage/OneDrive-个人/东方财富/授信/授信材料" \
  --manifest .credit-local/organization.json --apply
swiftc scripts/credit-ocr.swift -o .credit-local/credit-ocr
uv run scripts/prepare-credit-corpus.py \
  --source "$HOME/Library/CloudStorage/OneDrive-个人/东方财富/授信/授信材料" \
  --ocr-command .credit-local/credit-ocr \
  --previous-corpus .credit-local/previous-corpus.json

# 首次导入可省略 --previous-corpus；更新前将上一份 corpus.json 复制至该路径
# 先检查 preparation-report.json、重要扫描页与表格，再上传
node scripts/upload-credit-corpus.mjs
node scripts/upload-credit-corpus.mjs --apply --prune-previous=.credit-local/previous-corpus.json
```

脚本只读 OneDrive 原件；所有缓存和派生物在 `.credit-local/corpus/`。失败、未识别页和不支持文件写入 `preparation-report.json`，存在解析失败或未识别页时上传会拒绝发布目录。OCR 抽查仍是必要环节：非空文字不代表正确识别。

上传使用本机 `CLOUDFLARE_API_TOKEN` 或 Wrangler 已登录的 OAuth 凭证；可用 `WRANGLER_AUTH_FILE` 显式指定已知凭证文件。运行前 `wrangler whoami` 可刷新登录。凭证不写入输出或日志。该本地管理脚本使用 Cloudflare REST API；生产 Worker 始终使用绑定。

每份原文件默认仅生成一份 Markdown，不按页、段落或行写入 `search/` 小文件。Word 使用 MarkItDown 输出；Excel 整表保留单元格原值、表头、单位、百分比和公式缓存说明，避免默认 DataFrame 转换引入 NaN 或浮点展示尾数；PDF 将保留布局的文本与已 OCR 扫描页按原页顺序合并。只有 UTF-8 文本超过 4,000,000 字节才按段落边界拆为 `.part-001.md` 等连续文件，分段拼接必须完全还原转换结果。引用目录中的证据单元仅用于精确定位和校验，既不单独上传，也不送去 embedding。

上传按内容摘要断点续传，先生成包含新对象和待移除对象的 `upload-plan.json`。迁移时临时暂停 AI Search 索引；全部上传成功后，下载每份原件和 Markdown 核对 SHA-256，最后写入并回读核对 `catalog/corpus.json`。仅在指定 `--prune-previous` 且全部新对象验证通过后，删除前一份目录中已被替代的准确对象键；不做存储桶全量清空或前缀通配删除。迁移失败时索引保持暂停，按检查点继续上传/清理，成功后恢复原暂停状态并触发一次同步。AI Search 仅索引 `search/**`，排除 `originals/**` 和 `catalog/**`，启用中文 trigram 关键词及向量检索，关闭查询改写和回答缓存。目录发布与 AI Search 索引完成是两件事，必须分别验收。

若改变提取方法，须更新提取缓存版本并重新检查相关页；发布过程中不要同时运行另一轮材料准备或上传。目录仅包含本次源目录实际存在的文件；删除/替换源文件后重新准备与上传会使旧文件退出当前证据范围，指定 `--prune-previous` 后清理不再使用的旧对象；本地前一份目录和原件副本用于回溯。

## HTTP 与访问边界

| 接口 | 用途 |
| --- | --- |
| `GET /api/credit-assistant/materials` | 当前客户可提供的文件目录；未选择机构时仅公开材料 |
| `GET /api/credit-assistant/institutions?q=名称` | 最新授信快照中最多20个名称匹配候选及保密协议状态 |
| `POST /api/credit-assistant/session/institution` | `{ "institutionName": "..." }` 选择并恢复当前用户对应客户会话 |
| `GET /api/credit-assistant/files/:id` | 由目录解析的原件；PDF 支持页码深链和 Range |
| `GET /api/credit-assistant/session?institutionName=...` | 当前用户对应客户的会话、任务进度和答复 |
| `GET /api/credit-assistant/session/events?institutionName=...` | SSE 推送 `session` 快照及 `draft` 正文，完成后关闭 |
| `POST /api/credit-assistant/session` | 提交 `{ "question": "...", "institutionName": "..." }`，异步返回 202 |
| `POST /api/credit-assistant/session/new` | `{ "institutionName": "..." }` 在固定 DO 中归档当前对话并开始新对话 |
| `DELETE /api/credit-assistant/session` | 删除当前会话记录；进行中返回 409，UI 不提供此操作 |

所有写操作执行同源校验，请求体有传输字节上限；DO 名称仅由已验证用户和所选客户派生；下载仅接受目录中的文档 ID，不能传任意对象路径。返回 `private, no-store` 和 `nosniff`，SSE 额外使用 `no-transform`。不暴露通用 `/agents/*` 路由，不接受客户端 state 更新或任意 RPC 方法。

身份和路由权限由 Gateway 统一校验，经私有 Service Binding 进入 Dashboard，固定会话使用已验证的 Auth0 用户 ID；客户名称不等于用户身份。机构保密协议控制位于登录校验之内。页面、SSE、会话和附件均经同一私有入口；Worker 预览/直连域名关闭，默认 fetch 404。

## 验收与发布

转换测试：`uv run tests/test_credit_materials.py`（UTF-8 边界、整表数值/公式缓存、目录归类）。代码检查：`pnpm typecheck`、`pnpm worker:typecheck`、`pnpm test`、`pnpm build`、`wrangler deploy --dry-run`、`git diff --check`。新增测试覆盖精确计算、伪造数值/引用、文件路径、OCR/待确认提示、复核拒绝及指定 Provider；全站导航契约同步更新。

本地真实模型验收需要在未跟踪的 `.dev.vars` 中提供 `CF_AIG_TOKEN`。线上评估脚本复用 `programmatic-login.mjs`，仅以根目录 `.env` 的 `test@18.cn` 程序化登录，再使用固定用户/客户 DO；每例先归档该测试用户的当前对话。线上链路通过 SSE 收集阶段和正文事件，不依赖浏览器或轮询。worktree 通过 `AUTH_TEST_ENV_FILE` 指向项目组根 `.env`，不复制测试密码。Wrangler OAuth 登录不能代替 Gateway Token。模拟测试不能当作真实模型验收。

```sh
node --env-file=.env.local --env-file=.dev.vars scripts/evaluate-credit-assistant.mjs --institution=机构名称
node scripts/evaluate-credit-assistant.mjs --base-url=https://eastmoney.hasbai.xyz --institution=机构名称
# 或逐例执行 --case=material / capital / borrowing / calculation / scope
```

评估脚本将真实回答、来源和耗时写入 `.credit-local/evaluations/`，只输出步骤和摘要日志，仍需逐份核对回答。开发时请使用 `pnpm worker:dev` 启动自定义 Worker；`pnpm dev` 的 SvelteKit 开发服务器不承载 Worker 入口中的 Agents API。本地环境需先按 `docs/DEVELOPMENT.md` 配置 Hyperdrive；远程资料读取依赖 R2/AI Search remote bindings。

2026-09-07 首次实测：55 份原件、3,281 个证据块已发布至 R2，原件及目录 SHA-256 核对通过；其中 58 页使用 OCR。线上材料目录、文件下载及会话可用。四类真实问答均已发起，但 codex 上游返回 HTTP 429：该模型全部凭证处于冷却状态；因此真实生成质量尚未通过验收。恢复上游后须重新运行以上用例并逐份核验，不把该记录当成验收通过。

典型问题至少覆盖：索取审计报告、不同报告期的指标和比例计算、2025 年 30.90 亿元增资来源、50 亿元取得借款现金流的来源与用途、材料未披露的问题、错误金额前提、连续追问。

当前 Dashboard 已连接 Cloudflare Git，推送 `main` 会触发自动构建和发布；不要再手动执行部署。新增 `credit-agent-v1` SQLite Durable Object migration 随 Git 发布执行，不另改 D1 或 Neon schema。独立手动部署仍需明确授权。默认不做浏览器截图验收。

保密协议字段 `confidentiality_status` 与 API `confidentialityStatus` 统一为布尔值，只有明确的 `true` 允许提供受限材料。未签署、未知以及旧会话中的遗留字符串均不能作为授权；请求时仍回查最新数据库状态。
