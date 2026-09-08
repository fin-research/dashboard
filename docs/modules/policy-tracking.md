# 政策跟踪

入口：`/trading-research/policy-tracking`。公共规则见 [文档分流](../INDEX.md)；仅在任务涉及本模块时读取。

## 接口

- `GET /api/policies?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&category=...`：读取 ingest Workflow 已聚合的政策时间轴，包含 `important` / `related` / `general` 重要性、原始政策资讯、已关联研报和一对一点评；不调用 AI。
- `GET /api/policies/articles?q=...`：按标题、机构或摘要检索可关联 article。
- `PUT /api/policies/{id}/articles`：人工确认完整研报 ID 集合；未选择的现有自动关系记为人工排除，后续 Workflow 不覆盖。
- `POST /api/policies/{id}/commentary`：用户手动触发。Worker 通过 `DATA` Service Binding 以最多 5 路并发读取已关联研报正文（可为空），与政策资讯一起调用启用 Responses `web_search` 的 AI Gateway，并保存使用政策点评专用 `max` effort 生成的政策点评初版，成功为 201。
- `PUT /api/policies/{id}/commentary`：保存标准化点评字段的人工修订。
- `GET /api/news/{id}`：按 DM `sentiment_id` 读取已聚合政策资讯的标题、时间、DM 原文、政策原文链接与关联政策；对应统一新闻资讯页面 `/news/{id}`。
- `GET /api/articles/{id}`：读取研报 D1 元数据、已关联政策，并通过 `DATA` Service Binding 读取正文；对应独立页面 `/articles/{id}`。
- `GET /api/commentaries/{id}`：按点评 ID 读取标准化点评与对应政策；对应独立页面 `/commentaries/{id}`。
