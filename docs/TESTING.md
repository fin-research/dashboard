# Dashboard 测试与视觉回归

测试取舍遵循[项目组测试规范](../../eastmoney/docs/TESTING.md)。自 2026-09-17 起，本地推送前执行 `pnpm check:quick` 和改动直接相关的轻量单元测试，完整覆盖率、浏览器测试及构建验收由 GitHub CI 执行；纯文档修改仅检查差异，本地排障可运行所需检查。下方审计记录保留历史执行环境，覆盖率只代表注明的执行范围。

## CI 命令

准备合并时，GitHub merge queue 在合并组提交上运行完整 `Dashboard CI`；普通分支 push 不运行，PR 创建/更新仅检查队列门禁，main 合并后不重复运行。Python/Node 覆盖率与类型/构建/视觉两条任务并行，统一门禁只接受两项均成功；类型检查在构建任务前置，构建阶段只打包；`test:coverage` 已运行完整 Node 测试集，不再重复调用 `test`。本地可下载 CI 证据并使用报告查看命令；推送、CI 等待与核验由子代理负责，详见 [DEVELOPMENT](DEVELOPMENT.md#默认验证与合并)。

```bash
pnpm check:quick
pnpm test:ci-tools
pnpm check:visual-coverage
pnpm test:python
pnpm test:coverage
pnpm exec vite build
pnpm build:visual
pnpm exec playwright install chromium
pnpm test:visual
pnpm test:visual:report
```

`test:coverage` 使用 Node 24 内置 coverage，输出控制台表格和 `coverage/lcov.info`。只统计 Node 加载的 `src/**/*.ts`、`src/**/*.js`，排除 generated；未加载源码、Svelte 与 CSS 不在分母内，不能把总数视为全仓或 UI 覆盖率。Python 授信材料脚本单列，不混入 Node 数量。

## 自动视觉验收

`tests/visual` 使用 Playwright 1.62.0 Chromium，固定上海时区、中文 locale、日期、动画偏好和业务响应。CI 先构建 SvelteKit 生产包，再用 `pnpm build:visual` 编译独立 harness。`prepare-visual-build.mjs` 按生产 route node 的 stylesheet 顺序复制原样压缩 CSS 和资源，删除 harness CSS，记录 SHA-256；浏览器等对应生产 CSS 加载后才挂载组件，通过 8877 的静态 preview 运行，不再使用开发服务器。不加载 SvelteKit hooks、服务端 load、Gateway、数据库、Auth0 或业务环境文件。页面链接通过这个测试入口装配相应组件，因此是浏览器组件集成测试，不是生产路由 E2E。

当前场景：门户、交易总览与管理、交易流程及展开/编辑态、授信总览/日历/周报/失败态、研究辅助、二级池非空与空态、市场点评、融资时点/时段控件及重置，融资择时非空报告，以及 Maia 多选、弹窗、日历筛选与热点键盘交互。桌面 1440×900、手机 390×844 都运行。固定夹具覆盖实际图表与表格，不访问真实业务网络；未注册请求与浏览器异常会失败。

工作台业务截图只取 `.tr-workspace`，使页头和侧栏修改不改变各业务页基线。交易、授信、融资、管理四个一级工作台分别截取 `.tr-drawer`；只有含标签页或额外操作的代表顶栏截取 `.page-header`，另保留交易标签悬浮态。截图样式统一隐藏固定 AI 入口和浮动新增按钮，其行为仍由交互断言检查。门户、独立详情、市场点评、AI 面板与打印态没有工作台取景容器，继续采用其专用截图。合并组仍执行完整视觉套件，不按改动路径跳过测试；分区取景用于减少无关基线变化。

默认 CI 只比较已提交截图，缺少基线也失败；不自动接受新图、不重试失败。失败时生成 actual/expected/diff、HTML 报告和 trace。新增或有意改变页面时，先在本地通过快速检查并推送任务分支，在加入合并队列前手动触发独立候选 workflow；已有 PR 时也可主动触发，不必先等普通 CI 失败：

```bash
gh workflow run visual-baselines.yml --ref <task-branch>
```

候选 workflow 只运行一次完整生成（仍执行交互和覆盖清单断言），成功后输出待审工件；取消候选内部的第二次全量比较，严格比较由审阅、导入并提交后的合并组 CI 承担。下载 `visual-baseline-candidates` artifact 到工作树外，核对生成提交 SHA 和预期后，只提交有意变化的截图，在同一 PR 说明预期变化与审阅依据，再推送、加入合并队列并等待合并组 `Dashboard CI` 比较通过；代码发生变化后不得直接使用旧候选。候选任务成功不构成验收；同一分支重新生成会取消旧候选运行。日常比较由合并队列的 `merge_group` 自动完成，不需要每次人工或 AI 看图。禁止为消除差异提高容差、屏蔽业务区域或盲目更新。保留历史 `darwin` 基线；日常只维护 macOS 26/ARM64、锁定 Chromium 的 `macos-ci` 基线，不要求本地生成。合并组和手动重跑 `tests.yml` 均永不更新截图，`Dashboard CI` 不接受跳过比较的输入。系统字体/渲染版本变化须在 CI 重新确认基线。CI 保存覆盖率、HTML 报告和失败 trace 等证据 14 天。

## CI 等待与收尾（2026-09-20）

每个仓库、每次交付只由一个新子代理负责推送、候选/CI/合并和部署核验，主代理不并行查询同一运行。派发时给出任务工作树、允许提交的文件、目标 SHA、PR 与所需验收阶段；CI 失败后返回具体失败证据，由主代理修改，再派新子代理。候选待审时返回工件即可，不提前启动必然因旧基线失败的普通验收。

发现当前运行 ID 后，用仓库内命令等待一次；SHA 使用 GitHub 该运行的完整 head SHA，event 必须符合所需阶段：

```sh
node scripts/wait-ci.mjs fin-research/dashboard <run-id> <full-run-head-sha> merge_group
```

命令先核对仓库、run ID、SHA、event；对进行中的运行只启动一个 `gh run watch --interval 30`，中间重复进度不进入代理上下文，结束后只读取一次终态证据。默认最多等待20分钟（可追加1–1800秒），两次元数据请求各限15秒；不启动或重跑CI。退出0只表示该运行成功，1表示失败/取消/跳过/证据不匹配/API不可读，2表示仍待完成。返回2或API失败时保留运行链接和明确状态，不把未完成当通过，也不立即循环重开watch；只在新的状态证据或明确继续要求下恢复。

工具返回进程/执行cell仍在运行时，只续等同一进程；每次使用工具支持的较长等待（本地执行最多60秒），禁止每几秒调用`gh run view`/`gh pr checks`，禁止重启watch或把日志中的重复进度当成新证据。主代理仅等待子代理完成，不读取同一日志、不重复验收。

失败时只下载当前运行的失败job日志、对应截图/trace一次；区分代码缺陷、测试假设、预期视觉变化与runner/API故障。未修改代码/基线/环境且无临时基础设施故障证据时，不盲目重跑；同一问题修复后仍失败，应先重新判断根因。

停止条件：所需普通验收成功、PR合并已确认，以及本任务涉及的部署结果/版本已核对后立即回报并结束；不再额外跑测试、下载已成功的整套artifact或扩展至无关页面。CI/文档工具变更不追加业务登录或浏览器专项验收。回报只需PR、代码/合并SHA、各必要run链接与结论、部署证据及实际未验收项；候选成功和轻量入队成功都不得报告成完整CI通过。

## 视觉变更的提交前准备

先判断是否改变页面视觉，列出影响的页面、状态和设备；更新 `visual-coverage.json` 的对应场景。无意视觉变化时不更新 baseline，差异须先定位根因。需要更新时，由交付子代理先推送功能分支，**先生成候选、后加入合并队列**，不要等待比较失败才补截图。普通分支 push、PR（含草稿）更新及 main push 不触发完整验收；合并队列必须执行完整视觉比较，PR 的轻量绿色门禁不算验收通过。

```sh
gh workflow run visual-baselines.yml --ref <task-branch>
gh run download <candidate-run-id> -n visual-baseline-candidates -D <outside-checkout-directory>
# 主代理核对候选与旧图及变化范围后执行；不会自动提交。
pnpm visual:baseline:import <outside-checkout-directory> --reviewed
```

工件记录生成 SHA、run ID、各 CI PNG 的 SHA-256。导入要求工作树干净、HEAD 与生成 SHA 一致，并验证路径和校验和；代码变化后必须重新生成。候选严禁直接写 main，不自动提交，不替代随后合并组的普通比较。既有 PR 内有视觉变更时主动生成候选，最终只接受最终合并组提交的严格比较成功；不要为避免红灯关闭必需检查。

## 并发与证据隔离

不同 Actions job 在独立托管 runner/checkout 运行，固定端口和工作树内输出目录不会跨任务共享；候选 artifact 由运行 ID、源码 SHA 和 PNG 校验和绑定。入队前只导入当前任务、当前源码的已审候选，不导入另一个任务的整个截图目录。合并队列串行产生最终合并结果；如果共享样式或布局组合后发生差异，应按差异修复或重新审阅候选，不通过放宽容差、重复重跑或关闭门禁消除失败。

候选与普通验收分开：生成一次、审阅导入、最终合并组严格比较一次；普通 CI 保持零自动重试。只有已复现抖动或明确排障需要时才安排额外稳定性复跑，并记录原因，不把多轮复跑作为日常流程。依赖/浏览器缓存共用配置但不包含图片、生产输出或测试结果。覆盖率工件为 `unit-evidence`，截图、HTML、trace 和生产 CSS 清单为 `visual-evidence`。

## 页面覆盖清单门禁

`visual-coverage.json` 是页面、URL 场景、状态、设备、测试标题与活跃 CI 截图的可检查清单。`check:visual-coverage` 比对真实页面文件；新增页面、清单遗留项、缺少证据或 baseline 会失败。候选准备只允许暂缺 PNG，不能绕过清单与测试要求。Dashboard 另核对现有导航 registry 的动态视图；Financial 另核对 Shell 的 URL 分支，新 view/URL 不会因复用同一页面组件而漏掉。

全量 CI 设置 `VISUAL_COVERAGE_GATE=1`，reporter 再核对声明的测试确实在指定设备执行并通过；截图条目必须逐一实际执行清单所列文件名的 `toHaveScreenshot`，单纯 `page.screenshot`、跳过或删去测试不计作覆盖。`test-results/visual-coverage.json` 保留清单、豁免及结果。该清单不是代码覆盖率，单个正常态不代表所有状态；已有缺口必须写明豁免原因，不计入已覆盖，修改相应页面时重新评估。常规有覆盖页面不需要新增重复测试。局部排障可不启用全量门禁，不替代 CI。

## 审计与替换

原基线 559 Node 测试、97 文件，源码测试约 13.8k 行。Node TS/JS 的观测行覆盖 84.51%、分支 80.13%；未包含所有源码。主要缺口是交易图表（13.43% 行）、一级发行（24.53%）、二级池图表（35.95%）与负债报告数据（18.99%）。图表现在有真实浏览器补充，但这不改变 Node 分母。

- `home-portal.test.mjs` 原为页面/CSS 正则，迁至门户链接行为及截图。
- `trading-research-workbench.test.mjs` 的普通工作台布局、渲染、图表挂载、标题和已退役界面文案检查迁至视觉场景；共享卡片约束缩为一个架构守卫，保留交易金额/经济指标口径与报告特有约束。
- `shadcn-contract.test.mjs` 检查 Maia 配置、品牌色、旧框架移除和 Runes 边界；已有管理草稿 DOM 测试保留，多选重复打开、焦点恢复、取消拦截与日历多组筛选由 `ui-contracts.spec.mjs` 在真实浏览器中验证。Sonner 消息去重、关闭与计时暂停由挂载组件测试覆盖。
- `financing-model`、`financing/network-efficiency`、`financing/form-state`、`financing/liability-report` 仍含源码守卫。其增量保存、服务端预取和报告口径并未被当前视觉场景完整替代，保留这些保障，后续随对应功能改动优先迁为 handler/DOM 行为测试，不再扩写同类正则。
- 保留 happy-dom 的日期输入、请求竞争、草稿/失败恢复、portal 清理，以及权限/SQL/迁移测试；这些不是截图能够替代的验证。

尚未纳入截图的页面包括管理/个人资料、完整融资项目与 SOP 路由、资金/负债报告、政策详情。热点弹层使用浏览器交互校验；融资模型的 Darwin 基线保留为迁移前历史；当前票面/净节约/SHAP页面按新契约生成并审阅macos-ci候选，由合并组严格比较。当前场景不是 62 个页面的全覆盖，不用空态代替这些业务验收。

本轮浏览器回归捕获并修复 ScheduleFields 模式切换后原生重置的竞态：等待 Svelte 的默认值恢复结束后再还原配置。553 项 Node 测试、5 项 Python 测试及生产构建已通过；覆盖率观测行 84.46%、分支 80.17%。

最终本机视觉验收：32 项通过；不更新基线复跑 32 项通过，`--repeat-each=2` 的 64 项通过。已提交基线包含二级池成功空态（无错误提示）与通过勾稽的非空报告。

合并 Data 经济指标迁移后再次验收：534 Node 测试通过，行 84.13%、分支 80.57%；构建与32项视觉通过。原553项记录对应迁移前范围。

## Maia 迁移验收（2026-09-16）

本机通过 533 项 Node 测试、Svelte/Worker 类型检查、生产构建与 `git diff --check`。48 项浏览器用例中 47 项通过，1 项手机端鼠标矩形选择按原规则跳过；Maia 多选、取消拦截、焦点恢复、日历筛选与热点选项卡另复跑两次。普通工作台基线经目视核对后更新；市场点评、授信周报、二级池非空/空态及融资择时报告的桌面与手机原视觉基线保持。资金日报继续原样返回独立 R2 HTML，未注入应用 CSS。未将本轮浏览器组件验证表述为生产鉴权或全部路由 E2E。

CI 候选运行 `35066481194` 通过 5 项 Python、533 项 Node coverage、构建与 47 项浏览器用例。macos-ci 的市场点评、授信周报和二级池非空/空态候选与迁移前基线逐字节相同，未更新；普通工作台及新增融资择时 CI 基线经与本机截图对照后提交。覆盖率为已加载 TS/JS 的行 84.41%、分支 80.71%，不代表全仓或 Svelte/CSS 覆盖率。

## CI 合并门槛迁移（2026-09-16）

PR #1 的首次检查 `35086092645` 捕获交易流程展开截图的测量竞态：资金划拨标题换行后实测高度为 76px，旧截图中的后续节点仍按 52px 估算高度定位。测试现在等待实际节点底部与下一节点的间距达到图布局契约，再截图。经检查该次 CI 的 actual/expected/diff，只将桌面 `workflow-expanded.png` 更新为实测后的位置（交易所后续节点下移 24px），其它区域和截图容差未改。基线来源为该失败运行的浏览器实际截图。

后续 push 检查 `35104628577` 的间距断言超时，确认动画期间的 ResizeObserver 测量被直接丢弃，布局可能一直停留在估算高度。WorkflowCanvas 现在保存动画期间的最新高度，在动画完成或中断时应用，维持原有布局和动画规则。后续普通 CI 仍须完整比较通过。

## 跟踪点评工作台

新增原文句界与来源校验、检索硬过滤、D1真实SQLite版本归档/乐观锁、历史导入幂等与缺项保持测试；浏览器组件场景覆盖历史稿、保存冲突保留输入、生成与取材原句。浏览器组件场景默认在 CI 运行，不代表生产鉴权验收。

## 通知中台与PWA验收

候选运行 35251986142 对应 902b84d；主代理核对桌面/手机交易流程的actual/expected与候选，旧页面即时提醒浮层和编辑器浏览器提醒开关已迁入统一通知设置，流程顺序/节点布局不变。仅更新 workflow、workflow-expanded、workflow-editor、workflow-branch 共8张 macos-ci基线，其余逐字节一致。候选通过不替代PR与main完整CI。

## 生产 CSS 与覆盖门禁迁移（2026-09-18）

候选运行 [35300448142](https://github.com/fin-research/dashboard/actions/runs/35300448142) 对应 `afb3044f08a62c9fcd8c66c541f0cf81779e3a64`：6 项 CI 工具回归通过；生成和不更新复跑均为 67 通过、1 项既有手机鼠标框选跳过。原样生产 CSS 的 SHA-256 与路由映射保存在候选证据 `visual-dist/production-css.json`。

目视对比发现 Schedule fixture 的 ModuleCard 原先未出现在 SOP 路由 CSS 内；已补入该组件的生产 chunk 并增加 padding 行为断言，未接受丢失内边距的候选。最终 44 张 CI 图新增 desktop/mobile 消息投递；生产 CSS 下门户/手机总览的 ghost 按钮背景与开发环境不同，布局和业务数据未改，其余差异为局部图标或细微栅格化。主代理核对后按当前 SHA 导入，历史 darwin 图不改。消息管理截图覆盖首屏，滚动区下方详情仍依赖交互断言，不表述为全部内容截图覆盖。候选成功仍须随后普通 PR/main 比较通过。

清单登记 34 个页面模块；正常态与已有异常/展开状态分列。28 个路由模块明确保留尚无页面场景的豁免，3 个动态视图待补；这些均不是已覆盖。融资 schedule 是独立控件场景，不充当完整融资路由验收。
