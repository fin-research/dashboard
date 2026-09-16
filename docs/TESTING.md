# Dashboard 测试与视觉回归

测试取舍遵循[项目组测试规范](../../eastmoney/docs/TESTING.md)。以下为 2026-09-16 本地离线审计；覆盖率只代表注明的执行范围。

## 命令

```bash
pnpm test
pnpm test:coverage
pnpm test:python
pnpm exec playwright install chromium
pnpm test:visual
pnpm test:visual:report
```

`test:coverage` 使用 Node 24 内置 coverage，输出控制台表格和 `coverage/lcov.info`。只统计 Node 加载的 `src/**/*.ts`、`src/**/*.js`，排除 generated；未加载源码、Svelte 与 CSS 不在分母内，不能把总数视为全仓或 UI 覆盖率。Python 授信材料脚本单列，不混入 Node 数量。

## 自动视觉验收

`tests/visual` 使用 Playwright 1.62.0 Chromium，固定上海时区、中文 locale、日期、动画偏好和业务响应。`vite.visual.config.mjs` 在独立端口 8877 编译真实生产组件与 `app.css/styles.css`；不加载 SvelteKit hooks、服务端 load、Gateway、数据库、Auth0 或业务环境文件。页面链接通过这个测试入口装配相应组件，因此是浏览器组件集成测试，不是生产路由 E2E。

当前场景：门户、交易总览与管理、交易流程及展开/编辑态、授信总览/日历/周报/失败态、研究辅助、二级池非空与空态、市场点评、融资时点/时段控件及重置。桌面 1440×900、手机 390×844 都运行。固定夹具覆盖实际图表与表格，不访问真实业务网络；未注册请求与浏览器异常会失败。

默认命令只比较已提交截图，缺少基线也失败；不自动接受新图、不重试失败。失败时生成 actual/expected/diff、HTML 报告和 trace。新增或有意改变页面时运行：

```bash
pnpm test:visual:update
```

基线首次生成或有意改变设计时核对预期后提交；日常改代码直接运行 `test:visual`，不需要每次人工或 AI 看图。禁止为消除差异提高容差、屏蔽业务区域或盲目更新。基线按平台和视口分目录；macOS 本机与 CI 使用 macOS 26/ARM64 与同一锁定浏览器。系统字体/渲染版本变化可能需要在目标环境重新确认基线，不把跨平台差异当作业务回归。CI 运行覆盖率、构建及视觉测试并保存失败证据，首次远端执行结果必须单独确认。

## 审计与替换

原基线 559 Node 测试、97 文件，源码测试约 13.8k 行。Node TS/JS 的观测行覆盖 84.51%、分支 80.13%；未包含所有源码。主要缺口是交易图表（13.43% 行）、一级发行（24.53%）、二级池图表（35.95%）与负债报告数据（18.99%）。图表现在有真实浏览器补充，但这不改变 Node 分母。

- `home-portal.test.mjs` 原为页面/CSS 正则，迁至门户链接行为及截图。
- `trading-research-workbench.test.mjs` 的普通工作台布局、渲染、图表挂载、标题和已退役界面文案检查迁至视觉场景；共享卡片约束缩为一个架构守卫，保留交易金额/经济指标口径与报告特有约束。
- `daisyui-contract.test.mjs` 保留真实控件的样式系统架构扫描及已有 DOM 交互，移除 `fields > 90`、`dialogs === 10` 这样的历史总数锁定。
- `financing-model`、`financing/network-efficiency`、`financing/form-state`、`financing/liability-report` 仍含源码守卫。其增量保存、服务端预取和报告口径并未被当前视觉场景完整替代，保留这些保障，后续随对应功能改动优先迁为 handler/DOM 行为测试，不再扩写同类正则。
- 保留 happy-dom 的日期输入、请求竞争、草稿/失败恢复、portal 清理，以及权限/SQL/迁移测试；这些不是截图能够替代的验证。

尚未纳入截图的页面包括管理/个人资料、完整融资项目与 SOP 路由、资金/负债报告、热点/政策详情，以及融资模型完整非空报告。当前场景不是 62 个页面的全覆盖，不用空态代替这些业务验收。

本轮浏览器回归捕获并修复 ScheduleFields 模式切换后原生重置的竞态：等待 Svelte 的默认值恢复结束后再还原配置。553 项 Node 测试、5 项 Python 测试及生产构建已通过；覆盖率观测行 84.46%、分支 80.17%。

最终本机视觉验收：32 项通过；不更新基线复跑 32 项通过，`--repeat-each=2` 的 64 项通过。已提交基线包含二级池成功空态（无错误提示）与通过勾稽的非空报告。
