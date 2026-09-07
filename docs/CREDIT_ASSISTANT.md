# 授信问答

入口：`/trading-research/credit-assistant`；`/credit-assistant` 重定向到工作台入口。面向内部同事生成供客户使用的答复和资料来源，不自动向客户发送消息。

## 方案

在 Dashboard 的自定义 Worker 内使用 Cloudflare Agents SDK，避免另建站点、复制模型适配器或增加跨 Worker 公网调用。每个浏览器的随机 HttpOnly Cookie 对应一个 SQLite Durable Object 会话。Agents 队列执行问答，浏览器轮询状态；刷新页面仍可读取完成的答复。新建会话分配新的随机标识，保留旧会话存储。

```text
本机材料 ── 只读解析 / OCR ── R2 credit
                              ├─ originals/ 原件
                              ├─ search/ 可定位 Markdown ── AI Search credit
                              └─ catalog/corpus.json 当前有效资料目录与全文

工作台 ── /api/credit-assistant/* ── CreditAgent
                                     ├─ 目录与全文精确检索
                                     ├─ AI Search 混合检索 → 回读当前目录原文
                                     ├─ 原文引用校验 / Decimal 计算
                                     └─ AI Gateway custom-codex → gpt-5.6-luna / max
                                         └─ 独立证据复核 → 客户答复、来源、附件、待确认项
```

R2 是原始证据与版本目录。AI Search 只调用 `search()`，不调用其生成回答接口；该实例显示的默认生成模型不影响授信答复模型。关键词和向量检索帮助找同义表达，全文精确检索用于科目、文件和数值定位，也在索引未完成或暂不可用时提供回退。检索结果必须匹配当前目录的 `searchKey`，并回读当前原文；旧版本和不在本资料库的命中不能进入证据。

每次语义检索等待最多 15 秒，超时即用当前全文证据继续并显示提示。模型上游返回 HTTP 429 时，会话结束本次任务并提示服务繁忙或额度受限；不自动改用其他 Provider，也不反复重试处于冷却状态的凭证。

本功能根据用户明确指定使用 `credit_answer` 任务类型，固定 `custom-codex/responses`、`gpt-5.6-luna`、`reasoning.effort=max`，不切换 Provider。其余业务继续使用现有 opencode → codex 默认策略。所有生成请求和复核请求复用 `src/lib/server/ai-gateway.ts`，使用既有 `CF_AIG_TOKEN` Secret 和 Gateway BYOK。

## 证据规则

- PDF 按实际文件页码定位，原生文本使用保留布局的提取；扫描页 OCR 后标记 `ocr`。Word 保留原文段落/表格顺序，引用“段落 N”或“表 N 第 M 行”；不虚构 Word 页码。Excel/XLS 按工作表、行和单元格地址保存，重复表头与单位上下文。XLSX 同时保留公式及缓存值，缺失缓存不当作零。
- 文件 SHA-256 与相对路径生成文档标识，原件副本保持原字节。资料库、原件和本地证据均不提交 Git。
- 正式审计和披露优先；客户历史答复、内部业务材料、待部门确认稿分别标记。文件修改时间不代表报告期。同名指标必须区分主体、合并/单体、年度列、币种、单位及纳入剔除口径。
- 每段事实答复必须引用已读取来源中的连续原文。来源标题、定位和下载地址由程序生成。资料不足时明确待补充事项；不得从现金流科目或公司常见业务推断具体出资方、银行或用途。
- 四则运算使用有界语法解析与 Decimal，不执行模型代码。每个输入都要在引用原文中找到，记录原值、单位、来源和表达式；除零、未知变量、任意常数和伪造数字会被拒绝。
- 答复另经一次模型证据复核，核对引用的语义、年度、合并范围和单位。模型复核并不等于人工核验：引用扫描页、待确认稿或历史答复会保留显式说明，对外使用前应核对相关原页和口径。
- 工具循环最多 12 步，模型复核最多 2 次。单个会话最多 30 轮或约 1 MB 已保存内容，达到上限提示新建会话。错误不会伪装成已完成答复。

## 材料准备与更新

依赖：`uv`、Poppler 的 `pdftotext`/`pdftoppm`；旧 DOC 转换需要 LibreOffice。Python 的读取依赖记录在脚本 PEP 723 元数据内。macOS 推荐 Vision OCR，以页面坐标恢复表格行；可选 Tesseract 需要中文及英文语言包。

```sh
mkdir -p .credit-local
swiftc scripts/credit-ocr.swift -o .credit-local/credit-ocr
uv run scripts/prepare-credit-corpus.py \
  --source "$HOME/Library/CloudStorage/OneDrive-个人/东方财富/授信/授信材料" \
  --ocr-command .credit-local/credit-ocr

# 先检查 preparation-report.json、重要扫描页与表格，再上传
node scripts/upload-credit-corpus.mjs
node scripts/upload-credit-corpus.mjs --apply
```

脚本只读 OneDrive 原件；所有缓存和派生物在 `.credit-local/corpus/`。失败、未识别页和不支持文件写入 `preparation-report.json`，存在解析失败或未识别页时上传会拒绝发布目录。OCR 抽查仍是必要环节：非空文字不代表正确识别。

上传使用本机 `CLOUDFLARE_API_TOKEN` 或 Wrangler 已登录的 OAuth 凭证；可用 `WRANGLER_AUTH_FILE` 显式指定已知凭证文件。运行前 `wrangler whoami` 可刷新登录。凭证不写入输出或日志。该本地管理脚本使用 Cloudflare REST API；生产 Worker 始终使用绑定。

上传按内容摘要断点续传，不删除旧对象。全部上传成功后，下载每个原件核对 SHA-256，最后写入并回读核对 `catalog/corpus.json`。AI Search 仅索引 `search/**`，排除 `originals/**` 和 `catalog/**`，启用中文 trigram 关键词及向量检索，关闭查询改写和回答缓存。目录发布与 AI Search 索引完成是两件事，必须分别验收。

若改变提取方法，须更新提取缓存版本并重新检查相关页；发布过程中不要同时运行另一轮材料准备或上传。目录仅包含本次源目录实际存在的文件；删除/替换源文件后重新准备与上传会使旧文件退出当前证据范围，旧对象作为历史归档保留。

## HTTP 与访问边界

| 接口 | 用途 |
| --- | --- |
| `GET /api/credit-assistant/materials` | 当前文件目录 |
| `GET /api/credit-assistant/files/:id` | 由目录解析的原件；PDF 支持页码深链和 Range |
| `GET /api/credit-assistant/session` | 当前浏览器会话、任务进度和答复 |
| `POST /api/credit-assistant/session` | 提交 `{ "question": "..." }`，异步返回 202 |
| `POST /api/credit-assistant/session/new` | 新建独立会话 |
| `DELETE /api/credit-assistant/session` | 删除当前会话记录；进行中返回 409，UI 不提供此操作 |

所有写操作执行同源校验，请求体限长；会话 ID 仅从随机 Cookie 获取；下载仅接受目录中的文档 ID，不能传任意对象路径。返回 `private, no-store` 和 `nosniff`。不暴露通用 `/agents/*` 路由，不接受客户端 state 更新或任意 RPC 方法。

按用户决定，本期不加访问口令，也未配置 Access。随机会话 Cookie 只隔离会话，不是身份鉴权；材料目录和原件接口目前没有访问控制。后续统一接入 Access 时，必须同时覆盖 `/trading-research/credit-assistant`、`/credit-assistant`、`/api/credit-assistant/*` 以及任何 Worker 预览/直连域名，不能只保护页面。

## 验收与发布

代码检查：`pnpm typecheck`、`pnpm worker:typecheck`、`pnpm test`、`pnpm build`、`wrangler deploy --dry-run`、`git diff --check`。新增测试覆盖精确计算、伪造数值/引用、文件路径、OCR/待确认提示、复核拒绝及指定 Provider；全站导航契约同步更新。

本地真实模型验收需要在未跟踪的 `.dev.vars` 中提供 `CF_AIG_TOKEN`；Git 发布完成后也可用线上 HTTP 模式复用现有生产 Secret，每例创建独立会话。Wrangler OAuth 登录不能代替 Gateway Token。不得声称模拟工具调用或单元测试已经通过真实模型验收。

```sh
node --env-file=.dev.vars scripts/evaluate-credit-assistant.mjs
node scripts/evaluate-credit-assistant.mjs --base-url=https://eastmoney.hasbai.xyz
# 或逐例执行 --case=material / capital / borrowing / calculation
```

评估脚本将真实回答、来源和耗时写入 `.credit-local/evaluations/`，只输出步骤和摘要日志，仍需逐份核对回答。开发时请使用 `pnpm worker:dev` 启动自定义 Worker；`pnpm dev` 的 SvelteKit 开发服务器不承载 Worker 入口中的 Agents API。本地环境需先按 `docs/DEVELOPMENT.md` 配置 Hyperdrive；远程资料读取依赖 R2/AI Search remote bindings。

2026-09-07 首次实测：55 份原件、3,281 个证据块已发布至 R2，原件及目录 SHA-256 核对通过；其中 58 页使用 OCR。线上材料目录、文件下载及会话可用。四类真实问答均已发起，但 codex 上游返回 HTTP 429：该模型全部凭证处于冷却状态；因此真实生成质量尚未通过验收。恢复上游后须重新运行以上用例并逐份核验，不把该记录当成验收通过。

典型问题至少覆盖：索取审计报告、不同报告期的指标和比例计算、2025 年 30.90 亿元增资来源、50 亿元取得借款现金流的来源与用途、材料未披露的问题、错误金额前提、连续追问。

当前 Dashboard 已连接 Cloudflare Git，推送 `main` 会触发自动构建和发布；不要再手动执行部署。新增 `credit-agent-v1` SQLite Durable Object migration 随 Git 发布执行，不另改 D1 或 Neon schema。独立手动部署仍需明确授权。默认不做浏览器截图验收。
