# 工具参考

对应插件 **0.20.0 开发版（未发布）**；工具集合沿用 0.19.0，表达诊断通过面板接口提供。挂载后先提供 `zhizhang_enable`；当前启用层包含以下 52 个工具。表格直接取自发行代码的名称、description 和参数定义，参数类型及必填项以宿主展示的 schema 为准。

流程示例见[快速开始](QUICKSTART.md)，概念见[作品生命周期](COGNITION.md)。表中只列参数名，不表示每项都必填。旧候选缺目标基线时需当前 `expected_revision`；扫描、审读与定稿是不同动作。

## 作品、根基与章节

| 工具 | 用途 | 参数名 |
| --- | --- | --- |
| zhizhang_project_create | 创建织章作品目录。默认写作链：chapter_brief(lean)→stage→accept（内置扫描）。不生成正文。 | title、genre、premise、key、working_dir |
| zhizhang_project_open | 打开一部作品并记住为本会话当前作品，返回状态摘要。 | work、working_dir |
| zhizhang_project_list | 列出存储根下全部织章作品（key、标题、章节数、字数、更新时间）。 | working_dir |
| zhizhang_status | 查看当前作品状态：根基摘要、章节进度与字数、下一步建议。上下文压缩后先调它恢复现场。 | work、working_dir、recovery |
| zhizhang_foundation_get | 读取作品根基（锁定/已发生/人物/读者知情/计划/未结伏笔/文风）。 | work、working_dir |
| zhizhang_foundation_set | 部分更新作品根基字段。只改传入的键。定稿后可用它追加 happened / threads。 | work、working_dir、locks、happened、characters、readerKnowledge、planned、threads、style、pace |
| zhizhang_foundation_append_happened | 向根基 happened 追加一句本章后果（短行；按 chapter 去重）；修订后可显式 replace=true 更新该章记录。accept 不覆盖作者已有记录。 | work、working_dir、chapter、text、title、replace |
| zhizhang_outline_get | 读取某章章纲（含 situationLens / livedScene / stateLens）。 | work、working_dir、chapter |
| zhizhang_outline_set | 写入/合并某章章纲。写前定调：处境透镜、亲历重心、状态透镜。续写章接着前章后果换压力。不生成正文。若章节不存在则创建空章。 | work、working_dir、chapter、title、pov、targetWords、locks、knowledge、synopsis、conflict、beats、ending、situationLens、livedScene、stateLens |
| zhizhang_chapter_list | 列出作品章节清单（id、标题、状态、字数）。 | work、working_dir |
| zhizhang_chapter_read | 读取某章正文与章纲。续写或审校前先取现场。 | work、working_dir、chapter |
| zhizhang_chapter_save | 作者显式落盘或定稿改 status。创作默认请走 candidate 链。大正文（超过旁路字数阈值）须 confirm_bypass=true，否则拒绝。可省略 content 仅改 status/title/position（须章已存在）。定稿正文修改须 force=true，保留历史并降回草稿。 | work、working_dir、chapter、title、content、status、position、force、review_summary、review_result、reviewed_by、acknowledge_revision、expected_revision、confirm_bypass |

## 写作上下文、候选与汇编

| 工具 | 用途 | 参数名 |
| --- | --- | --- |
| zhizhang_candidate_stage | 【默认链】暂存候选到 candidates/（不写 chapters/）。可同章多次 stage（多草稿）；可选 draft_label / variant_group。下一步：candidate_accept（内置扫描，编辑可选）。统一整理见旁路 unify_*（须 multiDraft 开启）。 | work、working_dir、chapter、content、note、draft_label、variant_group |
| zhizhang_candidate_edit_brief | 【默认链·可选编辑】取出编辑过稿 brief（默认 polish-depolish）。Agent 按 brief 改写正文后调用 edit_stage；按真实授权采纳或保留候选；A/B/C 兼容可用，采纳不代表定稿。技能：docs/skills/web-novel-master-optimizer.md | work、working_dir、mode、candidate、should_land、situation |
| zhizhang_candidate_edit_stage | 【默认链·可选编辑】将编辑后正文暂存为新候选（editOf=写手候选；不写正式章）。随后按授权采纳或保留候选；A/B/C 兼容可用。禁止本工具内 accept。 | work、working_dir、parent、content、mode、note |
| zhizhang_candidate_edit_decide | 【默认链·可选编辑】用户对编辑候选显式选 A/B/C。A=一次确认应用编辑并 accept（须 confirm_accept_after_edit=true，采纳时自动扫描；已有过期凭据须重扫）；B=仅确认候选、正式章不变；C=拒编辑。禁止静默 A。 | work、working_dir、candidate、choice、confirm_accept_after_edit、mode、expected_revision、force、lint_pass_token、skip_brief、strict_lint、require_payoff、strict_human、strict_novel |
| zhizhang_chapter_drafts | 【旁路·多草稿】列出某章待采纳候选（含 draftLabel）；可选带近期已采纳。不要求 multiDraft 开启。下一步：选稿 candidate_accept（内置扫描），或开启后 unify_brief。 | work、working_dir、chapter、include_accepted |
| zhizhang_candidate_unify_brief | 【旁路·多草稿】取出统一整理 brief（须 multiDraft 开启）。合并 ≥2 条同章待采纳；省略 candidate_ids 则取本章全部待采纳。下一步：整理正文 → unify_stage。 | work、working_dir、chapter、candidate_ids |
| zhizhang_candidate_unify_stage | 【旁路·多草稿】将统一整理正文暂存为新候选（source=unify，unifyOf=父 ids；不写正式章）。须 multiDraft 开启。下一步：candidate_accept（内置扫描）。 | work、working_dir、content、candidate_ids、note、draft_label |
| zhizhang_candidate_accept | 【默认链】采纳候选到章节草稿。默认需要 chapter_brief 依据；采纳内置扫描，已有过期扫描凭据须重扫。编辑路径 A 可传 accept_after_edit + confirm_accept_after_edit；采纳、内容审读与定稿分开。旁路：skip_brief / strict_* / require_payoff / force。 | work、working_dir、candidate、mode、expected_revision、force、lint_pass_token、skip_brief、strict_lint、require_payoff、strict_human、strict_novel、accept_after_edit、confirm_accept_after_edit |
| zhizhang_assemble | 【旁路·定稿交付】按章序汇编 markdown 成稿到 manuscripts/<书名>.md。完书口径：多数章 final 后跑（only_final=true 只收 reviewed/final）。章有改动重跑即覆盖。 | work、working_dir、only_final、output |
| zhizhang_chapter_brief | 【闭环·写作】开写简报。默认 lean：只吃 craft（写法+状态）+ 幕 + 上一章正文（n≥2 全文）+ 毒点 + style_contract；保留关键经历和转向节点，不灌 mind/卡全文。card_ids 可来自 combo。下一步：创作 → candidate_stage → candidate_accept（内置扫描）。 | chapter、work、working_dir、brief_mode、include_body、extra_assets、card_ids、skip_cards |

## 参考分析与正式参考库

| 工具 | 用途 | 参数名 |
| --- | --- | --- |
| zhizhang_reference_analyze | 对指定片段准备轻量分析，或核对并保存已完成的分析与迁移包；默认不保存、不入公共库、不自动启动规划。本工具不调用模型。 | text、question、report、quotes、transfer_json、save、working_dir |
| zhizhang_library_import | 【闭环·库 1/9 交书】导入小说原文到拆书库。传 text 或 file（file 可写本地书源目录里的文件名）。不拆书、不写卡。下一步 2/9：library_plan（Auto 10% / Full 须同意）。 | title、author、text、file、reading_range、working_dir |
| zhizhang_library_plan | 【闭环·库 2/9 抽样计划】Auto 默认按字数 10% 分层抽样（前 10 章 + 后 3 章 + 等距）；Full 全量须先看成本回执，再由作者明确同意（confirm_full + confirm_token）。写 analyses/<id>/plan.json + plan.md。 | source、mode、ratio、batch_chars、confirm_full、confirm_token、reset、note、working_dir |
| zhizhang_library_dissect_brief | 【闭环·库 3/9 取批次】有 plan 时按 batch 取本批原文；无 plan 时按 from/count 取。不代写。下一步 4/9：facts_stage 逐章白描。 | source、mode、from、count、batch、max_chars、working_dir |
| zhizhang_library_card_stage | 【闭环·库 6/9 出卡】暂存卡。v2 模块须 layer+dimension+readerWant/emotionArc/dramaticUnit/replaceables/mustNotCopy/transfer/failWhen+evidence；可选 steps（三步公式）/bannedDiction（反AI腔词表）。旧卡仍走 axis+mechanisms+body。下一步：读软警告 → card_accept。 | title、source、body、reading_range、steps、bannedDiction、mechanisms、human_feel、book_craft、axis、mind、handoff、kind、layer、dimension、readerWant、emotionArc、dramaticUnit、replaceables、mustNotCopy、transfer、failWhen、evidence、tags、working_dir |
| zhizhang_library_card_accept | 【闭环·库 7/9 采纳】显式采纳卡入库（v2 校验 5 项 + 证据回溯）。未 accept 不得当已入库。下一步 8/9：library_report → 9/9 combo（audit 为诊断旁路）。 | candidate、working_dir |
| zhizhang_library_list | 【闭环·库·辅助】列出源与已采纳卡；可按书/轴过滤。主链见 product_map 工作流。 | what、source、source_ids、source_title、axis、recovery、working_dir |
| zhizhang_library_search | 【闭环·库·辅助】检索已采纳卡（可按书/轴/标签；query 多词=同时满足）。组包走 9/9 combo_suggest。 | query、source、source_ids、source_title、axis、tag、working_dir |
| zhizhang_library_audit | 【闭环·库 8/9 机械面审计】审计已入库卡：证据引文能否在原文核对、正文「声称原文」的引文能否回溯、证据章号是否对得上、readingRange 是否占位、mind 是否疑似设定复述。只诊断，不改卡；机械面通过≠卡能用，判断面须真读。 | card、source、axis、working_dir |
| zhizhang_library_combo_suggest | 【闭环·库 9/9 组包】推荐 1 book + N scene（可跨书）card_ids。下一步：inspire_start(card_ids) 或 chapter_brief(card_ids)。 | source_ids、source_title、craft_count、query、prefer_mind_source、working_dir |
| zhizhang_library_card_get | 【闭环·库·辅助】读已采纳卡全文（axis + craft/mind 证据）。确认后可 combo 或直接注入 brief。 | card、working_dir |
| zhizhang_library_facts_stage | 【拆书 4/9 事实层】提交逐章白描事实（谁做了什么、结果；没写的动机进 unknowns）。校验字面引文与来源；心理/评价词仅提示，不误拒原作对白。下一步：structure_stage 聚合。 | source、facts、items、working_dir |
| zhizhang_library_structure_stage | 【拆书 5/9 聚合层】提交剧情条 / 节奏表 / 人物弧光。kind=plot\|rhythm\|character。剧情条六项齐；节奏含铺垫/释放/反应/衔接。 | source、kind、payload、working_dir |
| zhizhang_library_report | 【拆书 8/9 报告】把事实/剧情条/节奏/人物/模块确定性拼成 report.md（固定 19 节），并自动附 L0 量化底座（分卷/高频词/热力/锚点/爽点密度）。不代写分析；覆盖率低会标早期观察。 | source、benchmark、notes、working_dir |
| zhizhang_library_card_discard | 【库·清理】按 id 删卡（文件 + 索引）。confirm=true 才执行。用于撤掉不合格旧卡。 | card、confirm、working_dir |

## 原创规划

| 工具 | 用途 | 参数名 |
| --- | --- | --- |
| zhizhang_inspire_start | 【闭环·灵感】开启会话：根据作者目标规划，可选已采纳参考卡。无卡时直接规划；参考按本次问题选用，不要求凑齐 mind。不写根基。 | work、goal、genre、pace、card_ids、reference_ids、craft_only、working_dir |
| zhizhang_inspire_forge_brief | 【闭环·灵感】推演简报：mind 主粮 + craft 辅 + develop/plan。不代写。下一步：inspire_stage → inspire_accept。 | session、working_dir |
| zhizhang_inspire_stage | 【闭环·灵感】暂存根基、章纲、全书、卷或幕规划候选；显式采纳后才写作品。 | session、kind、payload、working_dir |
| zhizhang_inspire_accept | 【闭环·灵感】显式采纳；apply=true 写入作品根基、章纲、全书、卷或幕规划。 | candidate、work、apply、title、genre、premise、working_dir |
| zhizhang_inspire_status | 【闭环·灵感】列会话或看详情。迷路时对照 zhizhang_product_map。 | session、work、history、candidate、recovery、working_dir |

## 诊断与审校留痕

| 工具 | 用途 | 参数名 |
| --- | --- | --- |
| zhizhang_style_lint | 【按需诊断】语感雷达：传 candidate 时扫描正文并记录版本凭据；candidate_accept 已内置扫描，无需例行先调本工具。已有过期凭据须重扫。扫 chapter/text 仅诊断，扫描不证明内容质量。 | work、working_dir、candidate、chapter、text |
| zhizhang_review_ledger | 审校留痕：action=get 列出操作记录；action=append 写入作者四维勾选或 AI 诊断笔记（五类证据范畴仅作分类，本工具不生成正文）；action=evidence_kinds 列出五类范畴名。工程文件仍为 ledger.json。 | work、working_dir、action、chapter、kind、summary、dim_locks_ledger、dim_pov_situation、dim_style_radar、dim_continuity_snap、issues_json |
| zhizhang_payoff_audit | 【旁路·诊断】兑付审计：对照章纲 ending 等与正文。Accept 已内嵌软传感；本工具仅诊断旁路。出问题或 require_payoff 时再用。不改写正文。 | work、working_dir、chapter、candidate、text、persist |
| zhizhang_human_feel_audit | 【旁路·诊断】人味软雷达（含 craftCue→stiffness_tidy，与 Accept 同口径）。Accept 已内嵌；本工具仅诊断旁路。只诊断，不签发 token；strict_human 为旁路硬拒。不作质量法。 | work、working_dir、candidate、chapter、text |
| zhizhang_novel_sense_audit | 【旁路·诊断】书感软雷达。Accept 已内嵌；本工具仅诊断旁路。只诊断，不签发 token；strict_novel 为旁路硬拒。不作质量法。 | work、working_dir、candidate、chapter、text、prev_chapter、prev_text |

## 导航、方法与快照

| 工具 | 用途 | 参数名 |
| --- | --- | --- |
| zhizhang_system_brief | 硬规则钉死（默认路径 + 旁路指针）。开写前或上下文压缩后调用。调度全图：zhizhang_product_map。 | working_dir |
| zhizhang_product_map | 【调度主入口】默认路径 vs 旁路 + 闭环三阶段 + 分喂 + 质量面。开局/迷路先看。不写库、不调模型。 |  |
| zhizhang_panel_snapshot | 导出当前作品的轻量面板快照：章节进度、处境摘要、待采纳候选、审校留痕最近条、下一步提示。format=json\|html\|both（默认 json，紧凑无缩进——这是给模型看的；HTML 仅在明确要嵌入网页时才传 html/both）。不写库、不调模型。 | work、working_dir、format |
| zhizhang_method_list | 列出可按需加载的创作方法资产 id 与一句话适用场景（不含全文）。写 plan/draft/review/revise 前用 method_get 或 chapter_brief 拉取正文。 |  |
| zhizhang_method_get | 按 id 拉取创作方法资产全文（Contract 4.0），注入当前上下文。ids 可为逗号分隔或字符串数组；未知 id 会列出但不中断已命中项。 | ids、id |
