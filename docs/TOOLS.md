> 0.4.0：同时提供 toutiao_enable、fanqie_enable、zhizhang_enable；织章原生工具保留 0.20.0 返回格式，以下 JSON 约定仅适用于 writer 工具。织章完整工具清单见 packages/zhizhang/docs/TOOLS.md。

# 工具清单（dsh-writer 0.4.0）

返回值统一为 JSON 对象：成功 `{ok:true, ...}`，业务失败 `{ok:false, code, message}`，code ∈ INVALID_ARGS / NOT_FOUND / CONFLICT / GATE_DENIED / SCRIPT_FAILED / TIMEOUT / OUT_OF_ROOT。

| 工具 | 参数 | 说明 |
|---|---|---|
| toutiao_enable | role | 挂载到当前会话（全局唯一可见的头条工具）；role=editor 时只挂红笔/质检 9 个工具 |
| toutiao_method_get | id | 取方法/模板/语料：s1-hot … s7-delivery、template-card、template-delivery、corpus-* |
| toutiao_rules | — | 现行质检规则 Markdown |
| toutiao_hot_fetch | top, vertical, relevant | 抓热榜 |
| toutiao_article_create | slug, date, title_hint, line, genre | 新建文章 |
| toutiao_article_list | status | 列表 |
| toutiao_article_get | id, include_draft | 详情 |
| toutiao_card_set / toutiao_card_patch | id, card / patch | 立项卡写入与预检 |
| toutiao_headline_set | id, main, alts | 标题矩阵，34 字上限 |
| toutiao_draft_stage / toutiao_draft_get | id, text, role, note / id, rev | 稿件版本；写手只能记 writer/author，编辑会话自动记 editor |
| toutiao_edit_record | id, rows | S5 三联表 |
| toutiao_qa_check | id, mode | 质检并绑定哈希 |
| toutiao_status | id, to, note | 状态流转（含门禁） |
| toutiao_delivery_save | id, markdown | 交稿单 |
| toutiao_ledger_add / toutiao_ledger_show | id / last | 台账 |
| toutiao_feedback_append / toutiao_feedback_read | original, revised, motive / — | 作者反馈 |

## 门禁
| id | 工具 | 行为 | 可关闭 |
|---|---|---|---|
| toutiao.accept_requires_qa | toutiao_status → 已验收 | 无有效过线质检则拒绝 | 否 |
| toutiao.deliver_requires_author | toutiao_status → 已交稿 | 向作者请求确认 | 否 |
| toutiao.max_return_rounds | toutiao_status → 验收退回 | 第 3 轮起请求确认 | 是 |
| toutiao.delivery_requires_accepted | toutiao_delivery_save | 非已验收则拒绝 | 否 |
| toutiao.editor_pass | toutiao_status → 待验收 | `requireEditorPass: true` 时，写手版不能直接送验收 | 是（默认未开） |
| 体裁隔离（全局） | toutiao_* / zhizhang_* | 会话体裁已定时拒绝另一体裁工具 | 否 |

## 编辑子代理
编辑角色可用：toutiao_method_get、toutiao_rules、toutiao_article_list、toutiao_article_get、toutiao_draft_get、toutiao_draft_stage、toutiao_edit_record、toutiao_qa_check、toutiao_feedback_read。

# 番茄长篇（fanqie_*）

触发：`fanqie_enable`（role=writer|editor），或会话里 `zhizhang_enable` 成功后自动挂载（`autoMount`）。全部工具**只读织章数据**，不写织章文件；审读回报写在 `outputs/fanqie/reviews/`。

| 工具 | 参数 | 说明 |
|---|---|---|
| fanqie_enable | role | 挂载长篇工具、补充段落与门禁；回执告诉你织章是否已启用 |
| fanqie_method_get | id | forge 方法原文（加织章工具对照表）；不给 id 看常用目录，`list` 看全部 |
| fanqie_outline_check | work, chapters, mode | 织章章纲 8 字段、占位、章序；readiness / format |
| fanqie_ledger_check | work, chapters, include_previous | 跨章数字与相对时间对照（默认连带上一章） |
| fanqie_library_scan | file, top, keywords | 拆书测绘（文件须在会话工作目录内） |
| fanqie_quote_check | source, analysis / analysis_text, min_chars | 拆解稿引文逐字核对 |
| fanqie_review_report | work, chapter, verdict, hard_issues, levels, optional, reread_full, changed_scope, strengths | 编辑审读回报，绑定当前正文 SHA-256；有硬伤或未完整回读不能判"通过" |
| fanqie_review_get | work, chapter | 最新回报与是否过期 |

`work` 可填织章作品 key 或标题，只有一部作品时可省略；`chapters` 可填章 id、序号或 "3-5"。

## 长篇门禁（拦同一会话里的织章工具）
| id | 角色 | 拦什么 | 行为 | 可关闭 |
|---|---|---|---|---|
| fanqie.finalize_requires_author | 写手 | zhizhang_chapter_save status=final | 请作者确认 | 否 |
| fanqie.force_requires_author | 写手 | 任一 zhizhang_* 带 force=true | 请作者确认 | 否 |
| fanqie.finalize_requires_review | 写手 | 同上定稿 | `requireEditorPass` 时无"通过"且版本匹配的回报则拒绝 | 是（默认未开） |
| fanqie.editor_readonly | 编辑 | 采纳、定稿、改根基/章纲、出写手候选、入库、导入、开书、组装 | 拒绝 | 否 |
| 体裁隔离（全局） | — | toutiao_* ↔ zhizhang_* / fanqie_* | 拒绝 | 否 |
