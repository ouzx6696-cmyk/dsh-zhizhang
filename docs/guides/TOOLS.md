# 工具清单

返回值统一为 JSON 对象：成功 `{ok:true, ...}`，业务失败 `{ok:false, code, message}`，code ∈ INVALID_ARGS / NOT_FOUND / CONFLICT / GATE_DENIED / SCRIPT_FAILED / TIMEOUT / OUT_OF_ROOT / NO_AGENT。

## 入口

| 工具 | 参数 | 说明 |
|---|---|---|
| writer_enable | mode, role | 全局唯一可见的写作工具。mode=toutiao 挂头条工具、总则、门禁；mode=fanqie 挂长篇引擎工具与硬规则 + 写作层工具、补充规则、门禁；role=editor 为编辑子代理。一个会话只能一种模式、一种角色，冲突返回 CONFLICT |

# 今日头条（mode=toutiao）

| 工具 | 参数 | 说明 |
|---|---|---|
| toutiao_method_get | id | 按当前方法方案取方法/模板/语料：overview、s1-hot … s7-delivery、template-card、template-delivery、corpus-*；`list` 列当前方案全部；`原版:id` 强制读原件；`user:相对路径` 取作者自备资产 |
| toutiao_profile | action, profile, name, base, note, from_dir, method, text, file | 方法方案：list / show / use / create / save / reset / rename（见 [PROFILES.md](PROFILES.md)）；编辑子代理不挂 |
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
| 模式隔离（全局） | toutiao_* / fanqie_* | 会话模式已定时拒绝另一模式的工具 | 否 |

## 编辑子代理
编辑角色可用：toutiao_method_get、toutiao_rules、toutiao_article_list、toutiao_article_get、toutiao_draft_get、toutiao_draft_stage、toutiao_edit_record、toutiao_qa_check、toutiao_feedback_read。

# 番茄长篇（mode=fanqie）

挂上两组工具，名字都以 `fanqie_` 开头：

- **引擎**（packages/fanqie/src/engine，50 多个）：作品与项目（`fanqie_project_*`）、根基与章纲（`fanqie_foundation_*`、`fanqie_outline_*`）、写作链（`fanqie_chapter_brief` → `fanqie_candidate_stage` → `fanqie_candidate_accept`）、审读与定稿（`fanqie_chapter_save`）、检查（`fanqie_style_lint` 等）、拆书库（`fanqie_library_*`）、灵感（`fanqie_inspire_*`）、方法资产（`fanqie_method_list/get`，12 项，含编辑过稿 `edit`）、产品地图与调度（`fanqie_product_map`）。逐项说明见 [engine/TOOLS.md](engine/TOOLS.md)。
- **写作层**（packages/fanqie）：

| 工具 | 参数 | 说明 |
|---|---|---|
| fanqie_forge_get | id | 按当前方法方案取长篇方法（默认方案 17 份：overview、plan-*、library、write-chapter、scene、prose、rhythm、continuity、platform、edit、revise、templates-*、examples-*）；不给 id 看当前方案目录，`list` 看全部；原版 forge id 自动对到默认方案同类方法；`原版:id` 强制读原件（附工具对照表）；`user:相对路径` 取作者自备资产 |
| fanqie_profile | 同 toutiao_profile | 长篇的方法方案管理；编辑子代理不挂 |
| fanqie_outline_check | work, chapters, mode | 章纲 8 字段、占位、章序；readiness / format |
| fanqie_ledger_check | work, chapters, include_previous | 跨章数字与相对时间对照（默认连带上一章） |
| fanqie_library_scan | file, top, keywords | 拆书测绘（文件须在会话工作目录内） |
| fanqie_quote_check | source, analysis / analysis_text, min_chars | 拆解稿引文逐字核对 |
| fanqie_review_report | work, chapter, verdict, hard_issues, levels, optional, reread_full, changed_scope, strengths | 编辑审读回报，绑定当前正文 SHA-256；有硬伤或未完整回读不能判"通过" |
| fanqie_review_get | work, chapter | 最新回报与是否过期 |

正文体检合在 `fanqie_style_lint` 里（语感雷达后附 forge 正文体检，重复命中去掉）。审读回报写在作品目录 `writer-reviews/<章 id>/`。

`work` 可填作品 key 或标题；省略时（本会话上次打开的作品 → 只有一部时用它）；`chapters` 可填章 id、序号或 "3-5"。

## 长篇门禁（拦同一会话里的 fanqie_* 调用）
| id | 角色 | 拦什么 | 行为 | 可关闭 |
|---|---|---|---|---|
| fanqie.finalize_requires_author | 写手 | fanqie_chapter_save status=final | 请作者确认 | 否 |
| fanqie.force_requires_author | 写手 | 任一 fanqie_* 带 force=true | 请作者确认 | 否 |
| fanqie.finalize_requires_review | 写手 | 同上定稿 | `requireEditorPass` 时无"通过"且版本匹配的回报则拒绝（写作台定稿由引擎内部同一条件约束） | 是（默认未开） |
| fanqie.editor_readonly | 编辑 | 采纳、定稿、改根基/章纲、入库、开书等写入类工具 | 拒绝 | 否 |
| 模式隔离（全局） | — | toutiao_* ↔ fanqie_* | 拒绝 | 否 |

# 写作台接口（只接受本机，或按 workbench 配置的局域网与令牌）
- 番茄长篇：`/api/writer/*`（projects、works、snapshot、chapter、candidate、candidate/accept、chapter/review、chapter/finalize、revision/acknowledge、diagnostics/*、unify/prepare、agent/deliver），见 [WORKBENCH.md](WORKBENCH.md)。
- 今日头条：`GET /api/writer/toutiao/articles`、`GET /api/writer/toutiao/article?root=&id=`、`POST /api/writer/toutiao/adopt {root,id,confirm}`、`POST /api/writer/toutiao/deliver {root,id?,action=new|continue|review|revise,note?,requestId?,confirm}`。
