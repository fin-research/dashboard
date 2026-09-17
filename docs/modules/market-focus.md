# 今日聚焦

入口：`/market-briefing`。公共规则见 [文档分流](../INDEX.md)；仅在任务涉及本模块时读取。

日常生成由 `market-briefing` Workflow 的 `generate-focus` 步骤执行，直接消费七个并行模块之一 `collect-focus-news` 整理完成的 DM 新闻材料；AI 步骤不重新取材，adapter 关闭内部重试，由 step 配置统一管理。页面只显示已归档聚焦。以下 POST 为旧客户端兼容接口，新版页面不再调用。

日常 Workflow 今日聚焦不依赖权益模块，也不取股票收评；新闻列表、详情、筛选和组装都在 `collect-focus-news` 内完成。以下旧 POST 兼容接口仍保留股票收评与 DM 新闻合并取材。

## 接口

- `POST /api/market-briefing?date=YYYY-MM-DD`：日期缺省时使用上海时区当天。
- 无效日期为 400；上游、模型或配置错误按路由映射为 5xx。
- Dashboard Worker 通过 `DATA` Service Binding 读取股票收评和 DM 新闻；详情最多 5 个并发，避免同一 invocation 的外连等待槽被耗尽。
- 模型通过 provider-specific Responses API 调用，启用 `web_search`、使用今日聚焦专用 `max` reasoning effort，并将 AI Gateway 请求超时设为 300 秒；联网证据仅用于补充、核验给定材料未充分解释的关键行情和驱动。

## 业务规则

- Dashboard Worker 通过 `DATA` Service Binding 分别请求 `/data/stock-summary`、`/data/news` 和 `/data/news/{id}`，在本项目拼接新闻素材后调用统一 AI Gateway 适配器；生成时启用 Responses `web_search` 和今日聚焦专用 `max` reasoning effort，输出仍为两条纯文本。
- 新闻筛选、详情合并与提示词格式属于 Dashboard Worker 契约；更改时必须同步检查 `data` 与本项目测试。
