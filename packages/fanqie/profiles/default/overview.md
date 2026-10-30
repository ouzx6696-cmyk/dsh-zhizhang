# 长篇写作总纲：从开书到定稿

开新书、接手一部作品、或不知道下一步取哪份方法时先读本页。它给出每一步的产出、对应工具和方法 id；具体做法在各方法里，本页不重复。

## 一、流程地图

| 步骤 | 产出 | 工具 | 方法 |
|---|---|---|---|
| 0. 恢复现场 | 当前作品、进度、下一步 | `fanqie_project_list` / `fanqie_project_open` / `fanqie_status`；迷路时 `fanqie_product_map` | 本页 |
| 1. 开书与灵感 | 作品目录、题材与卖点候选 | `fanqie_project_create`、`fanqie_inspire_start` 等 | plan-foundation |
| 2. 根基 | 锁定、人物、规则、节奏档位、文风 | `fanqie_foundation_set`（`pace` 记档位） | plan-foundation、rhythm、templates-write |
| 3. 卷纲与幕纲 | 全书路线、单元因果链 | `fanqie_inspire_stage`（全书、卷、幕规划）→ 作者确认后 `fanqie_inspire_accept` | plan-structure |
| 4. 章纲 | 8 字段齐全的近端章纲 | `fanqie_outline_set` → `fanqie_outline_check` | plan-outline、templates-plan |
| 5. 写章 | 候选 → 采纳为草稿 | `fanqie_chapter_brief` → `fanqie_candidate_stage` → `fanqie_candidate_accept` | write-chapter，按需 scene、prose、rhythm |
| 6. 编辑审读 | 固定格式审读回报 | 编辑子代理或自审，`fanqie_review_report` | edit |
| 7. 修改 | 编辑候选或修订稿，重审 | `fanqie_candidate_edit_brief` → `fanqie_candidate_edit_stage` → `fanqie_candidate_edit_decide` | revise |
| 8. 核旧账 | 跨章数字、物件、知情对照 | `fanqie_ledger_check` | continuity |
| 9. 定稿 | 作者确认后的正式章 | `fanqie_chapter_save` `status=final`（弹作者确认） | write-chapter 第五节 |
| 10. 记后果 | 已发生、未结伏笔更新 | `fanqie_foundation_append_happened`、`fanqie_foundation_set` | continuity |
| 11. 发布准备 | 汇编成稿、发布前检查 | `fanqie_assemble` | platform |

拆书与参考分析走 library；连载平台节点（签约、推荐、AI 声明）见 platform。

## 二、四条贯穿规则

1. **从作者要的最终产物倒推**。有章纲就直接写，只要章纲就停在章纲；规划完成不自动开写，审读通过不自动定稿。
2. **四态分开**：已发生（定稿正文）、锁定（作者不可改）、采用（当前开写依据）、候选（未定方案）。详见 continuity。
3. **写与审分开**：先写完整章，再换编辑眼光。编辑只审和出编辑候选，不采纳、不定稿。详见 edit。
4. **谨慎只管文件和事实，不管叙事胆量**。人物可以冒险、误判、抢先；不要用“暂不确定”“只能说明”替代事件。

## 三、什么时候问作者

只问会改变结果的事：要改作者锁定或已定稿事实；关键因果在章纲和前文里定点查找后仍缺；授权范围有歧义；签约模式未知且会改变本轮交付形态（见 platform）。集中一次问清，只停依赖它的工作。

不为场数、钩子、模板空栏追问。平台未记录时按番茄长篇默认继续，交付里写一句“平台按番茄长篇默认，可改”；节奏档位未记录时按题材提建议档位，写一句“节奏按某档默认，可改”。

## 四、默认方案目录

| id | 用途 |
|---|---|
| overview | 本页：流程地图与目录 |
| plan-foundation | 开书、题材与卖点、根基（人物、规则、锁定、用户约定） |
| plan-structure | 卷纲、幕纲、长线结构与连读校准 |
| plan-outline | 幕纲拆章纲，章纲 8 字段写到多细算够 |
| library | 拆书与参考分析：有出处、可迁移、不入库不外推 |
| templates-plan | 规划类模板：根基、卷纲、幕纲、章纲 |
| examples-plan | 规划类示范：章纲颗粒度、抽象设定落成具体选择 |
| write-chapter | 写章流程：读章纲与前文、四个落点、两道自检、交付与定稿 |
| scene | 场景与情节手法：动作、对白、视角、转场、多人场面、信息释放 |
| prose | 句面与人味：反 AI 腔病型与改法、误杀防护、声线锚定 |
| rhythm | 节奏档位、爽点与钩子、卖点与对手的硬要求 |
| continuity | 连续性与旧账：四态、知识边界、伏笔、核账 |
| platform | 番茄连载要点：签约、推荐、低质治理、AI 声明 |
| edit | 编辑审读：四类硬伤与 L1–L3，回报格式 |
| revise | 受控修订：按回报改、修订层级、保留基线 |
| templates-write | 写作类模板：写作风格约定、当前状态、本书硬边界、卷末总结 |
| examples-write | 精选改前改后对照 |

文中“见 xxx”都指上表的 id。引擎另有内置短方法（`fanqie_method_get`，如 `edit`、`style_contract`），与本套一致，冲突时以工具行为为准。
