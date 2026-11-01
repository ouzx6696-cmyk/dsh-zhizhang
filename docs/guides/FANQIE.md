# 番茄长篇模式

## 1. 结构
- 代码都在 `packages/fanqie`：引擎（`engine/`：作品存储、`fanqie_*` 创作工具链、硬规则）、写作层（forge 方法、章纲/旧账检查、编辑审读、门禁）、写作台接口（`workbench/`）。`writer_enable mode=fanqie` 一次挂上引擎与写作层。
- 作品数据（根基、章纲、正文、候选、拆书库）只有一份，默认在 `<会话目录>/.writer/`。写作层直接用引擎的存储层与作品选择（`works.ts`）；落盘一律走引擎工具。编辑审读回报是写作层自己的文件，存在作品目录 `writer-reviews/<章 id>/`。
- forge 三件套（inspiration-forge 规划、inspiration-forge-library 拆书、novel-writer 写作与编辑）原文放在 `packages/fanqie/skill/forge/`，**一字未改**。
- 原文里的落盘指令（自有目录、init_project.py、archive_draft.py）在取用时由 `fanqie_forge_get` 前置的对照表改道到引擎工具。这样原文可以随上游升级整体替换。
- forge 的五个检查脚本通过 `fanqie_bridge.py` 包成统一 JSON 契约；脚本本身不改，同输入同输出。

## 2. 字段映射
引擎章纲与 forge 章纲接口（check_outline.py 的 BLOCKS / FIELDS）一一对应：

| 引擎 outline 字段 | forge 章纲 | 检查 |
|---|---|---|
| synopsis | 1. 剧情梗概 | 非空、无显式占位 |
| conflict | 2. 核心冲突与看点 | 同上 |
| beats | 3. 情节推进节点 | 同上 |
| ending | 4. 章末落点 | 同上 |
| pov | 视角 | 同上 |
| targetWords | 目标篇幅 | >0；番茄常见区间 1500–6000 字外只提示 |
| locks | 锁定事实 | 同上 |
| knowledge | 人物知识边界 | 同上 |
| situationLens / livedScene / stateLens | （引擎独有：处境透镜、亲历重心、状态透镜） | 不检查，由引擎自己的 brief 约束 |

forge 的"节奏档位"在引擎里对应作品级 `pace`（`fanqie_foundation_set` 的 pace 参数），本插件不另设字段。

## 3. 正文体检合并（ADR）
- **决定**：合并为一个入口 `fanqie_style_lint`。引擎语感雷达照旧给命中、签发 lintPassToken；其后附「forge 正文体检」（manuscript_linter：超长段、七类套话，台词命中只计数）。与雷达已命中片段重叠的套话不重复列出。
- **理由**：两边各报一遍会重复提示；放进同一个工具后一次看全。规则本身都不改，命中仍只是"值得回看的位置"。
- **实现**：`engine/tools/audit.ts` 调 `forge.ts forgeLint`；追加文本不影响雷达命中数与 lintPassToken；Python 不可用时只附一行"追加体检暂不可用"。

## 4. 编辑子代理
- 主写手用 DSH 自带 `subagent` 派出编辑；编辑调用 `writer_enable mode=fanqie role=editor`。
- 编辑能读、能出**编辑候选**（`fanqie_candidate_edit_brief/stage`），不能采纳、定稿、改根基或章纲、入库。
- 回报固定走 `fanqie_review_report`：结论、四类硬伤（关键剧情与落点、本书硬约束、人物认知、正文接续）、L1–L3 定位、是否完整回读、实际改动范围。回报绑定正文 SHA-256（首尾换行归一），正文一改即过期。存在作品目录 `writer-reviews/<章 id>/<时间>.json`。

## 5. 定稿门禁
- `fanqie_chapter_save status=final` → 作者确认；任何 `force=true` → 作者确认。都锁定不可关。
- `fanqie.requireEditorPass: true` 时，定稿前还须有"通过"且与当前（或本次提交的）正文版本匹配的审读回报。两道：对话里由门禁 `fanqie.finalize_requires_review` 先拦（免得作者确认完才被拒）；引擎内部 `finalizeGuard` 兜底，写作台点「定稿」也经过它。
- 审读通过不自动获得定稿权：门禁顺序是先查审读、再请作者确认。

## 6. 引擎与写作层的衔接
引擎（`engine/`）与写作层同在 `packages/fanqie`，直接调用，不经钩子：
| 位置 | 调用 |
|---|---|
| `fanqie_chapter_save status=final`（engine/tools/works.ts）与写作台 `POST /chapter/finalize` | `review.ts finalizeProblem`：requireEditorPass 时要当前正文的"通过"回报 |
| 写作台读单章 `GET /chapter` | `review.ts chapterReviewInfo`：最新回报摘要、是否过期、定稿条件 |
| `fanqie_style_lint` 三种扫描（engine/tools/audit.ts） | `forge.ts forgeLint`：forge manuscript_linter，去掉与语感雷达重复的命中后追加 |
| 引擎解析数据根（engine/work-store.ts ensureStorage） | `core/sessions rememberSession`：记最近的主会话（子代理不记） |

启用：`writer_enable mode=fanqie` → `mountFanqie`（先 `mountEngine`，再挂写作层工具、补充规则与门禁）。

## 7. 写作台投递
- 番茄长篇三种动作：`continue`（续写下一章：按章序第一章还没正文的；都写过就是新的一章）、`review`（派编辑审读本章）、`revise`（按最新回报修改）。
- 今日头条四种动作：`new`（新写一篇，附言当题材）、`continue`（按当前状态推进下一步）、`review`（派编辑红笔并质检）、`revise`（按最近质检与编辑意见修改）。
- 作者附言 ≤300 字原样附在末尾。发出的是普通用户消息，以【写作台】开头，mode=queue（Agent 忙时排队，不打断）；requestId 由写作台生成，宿主按它去重。
- 目标会话：最近在该数据目录（长篇按引擎数据根，头条按头条数据目录）调用过写作工具的主会话。没有会话、或宿主没有 sessionController（headless）时，按钮置灰并写明原因。
- 未做：模型深度调用；按作品而非按数据目录区分会话。
