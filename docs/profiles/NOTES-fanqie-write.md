# NOTES：fanqie-write 分组（长篇正文写作、编辑与修订）

原件：novel-writer 下 50 份 .md（SKILL、references 16 份、templates 13 份、examples 20 份），共 262063 字节。新写 11 份，见文末字节表。

## 各份来源

| 新 id | 合并了哪些原件 | 删掉的内容类型 |
|---|---|---|
| overview | SKILL、dispatch、project_layout、roles、handoff_contract 第 1–6 节、pipeline_handoff 第一节 | 五状态文件与 workspace 目录树、三技能主责表、交接字段清单、“文件存在不等于完成”式反复免责 |
| write-chapter | writing（第一至八节）、pipeline_handoff 第三至六节（派单与连写）、SKILL 第 3 节、creative-guidance 的 WRITING_GUIDANCE 对照 | archive_draft 命令与 SHA-256 手算、符号链接与路径安全、派单模板全文、外部材料一节 |
| scene | scene_craft、rhythm（原件）第一、二、三、五节、structure_craft 第四、五节中的跳步与前台后台、多人场面与公开方案（教学结论）、答案后果（局部答案部分） | 两章完整教学正文、职能标签表、“不是铁律”类声明 |
| prose | prose_craft、writing_style_default、editor_method 第三节与第六节 2、反 AI 腔对照集的病灶清单、writing 第八节附例 | 目录锚点、重复的“命中不等于要改”声明（保留一次）、默认风格的叙述者人设段 |
| rhythm | handoff_contract 第 7.1、7.4 节、rhythm（原件）第四节、serial_orientation 第五、七节、structure_craft 第六节节奏项、这座山归我了审改、三组修订 A 的兑现原则 | 四层架构、天堑前置、自增殖危机链（属规划，归 plan-structure） |
| continuity | continuity、handoff_contract 第 7.2 节、editor_method 第六节 3（核旧账）、雾港旧声铺审改（伏笔与状态推进）、current_state 模板的旧账分类 | 状态文件分区说明、跨文件事务与 hash 说明 |
| platform | fanqie_platform | 治理处置数量、连载签约后续节点与全勤档位等互相矛盾或只有二手来源的数字；来源表压成清单 |
| edit | editor_method、editor_agent 模板、roles 第四、五节、FANQIE_EDITOR_BRIEF、review.ts、tools.ts 中 `fanqie_review_report` 校验 | 成对示范 A–D（结论并入 prose 误杀防护）、目录、委派路径说明 |
| revise | revision、三组修订示例“不应接受的优化”、EDITING_GUIDANCE 对照 | workspace/revisions 备份目录、原子替换与 compare-and-swap 讨论、外部技能接收一节 |
| templates-write | writing_style、current_state、constraints、editor_agent、summary、volume_summary | 每栏后的长篇免责注释；字段改为对应根基字段 |
| examples-write | 反 AI 腔对照集场景一、二，高张力场景与审改（借你这一拳），三组修订示例 A、C | 全部完整章节正文（这座山 C001–C003、雾港 C001–C005、借你这一拳、两张车票、掌柜）、长篇“采用依据”铺垫 |

## 修正的矛盾（以代码为准）

1. **落盘方式**：原件要求写 `state/*.md`、`workspace/drafts|chapters/`，跑 init_project、archive_draft、ledger_check、manuscript_linter。全部换成工具：草稿走 `fanqie_chapter_brief` → `fanqie_candidate_stage` → `fanqie_candidate_accept`；定稿 `fanqie_chapter_save status=final`；当前状态改为根基字段 `happened/threads/readerKnowledge/characters/locks/planned/style/pace`；核账 `fanqie_ledger_check`；体检 `fanqie_style_lint`。
2. **编辑权限**：原件说编辑“在授权范围内改草稿”。代码（gates.ts EDITOR_DENY）禁止编辑调用 `fanqie_candidate_accept`、`fanqie_candidate_edit_decide`、`fanqie_chapter_save` 等，只能出编辑候选。新稿按代码写。
3. **定稿条件**：原件“有归档授权且审读无硬伤即可归档”。代码：`status=final` 一律弹作者确认（锁定门禁）；`requireEditorPass` 打开时还要求最新回报为“通过”且对应当前正文。新稿按代码写，并注明自审不算独立审查。
4. **审读回报**：原件回报字段松散。新稿 edit 第四节逐字段对齐 `fanqie_review_report`：`verdict` 三值、`hard_issues` 四类原文类别、`levels` L1–L3、`optional` 最多 3 条，“有硬伤或未完整回读不能判通过”。
5. **修订已定稿**：原件自建备份目录加原子替换。代码 `fanqie_chapter_save force=true` 自带历史并降回草稿，`expected_revision` 做基线核对，force 需作者确认。新稿按代码写。
6. **篇幅数字**：原件模板写“番茄社区常见约 2000–2500 字”；fanqie_bridge.py 对 1500–6000 字以外只提示。两者并存，前者标非官方。长段阈值 160 字与 forge.ts `LONG_PARA` 一致。
7. **原 rhythm.md 名实不符**：标题“写作技法”，内容多是场景组织和对白。新 rhythm 改为真正的节奏档位文件，原内容分流到 scene。
8. **“节奏档位”散落**：原件档位表在 handoff_contract 第 7.1 节，被多处引用。新稿只在 rhythm 写一次，档位存 `fanqie_foundation_set pace`（代码有此枚举）。

## 原件的明显问题

- 每句都带“不是……也不是……”式免责，同一句“命中不等于要改”在 6 份里各写一遍，模型抓不住要做什么。
- writing、pipeline_handoff、handoff_contract、roles、project_layout 五份讲同一套分工与授权，相互引用成环。
- 引用未随包的外部技能（style-polisher、author-persona-skill），并说“不声称已接通”。
- 平台页的部分数字来自二手转录且官方说法不一，原件已自认矛盾。
- 示例里有 emoji 标题、繁体错字（“退後”）、整章正文动辄 5–7KB，取用成本高。

## 判断与待核

- 编辑子代理能否看到 `fanqie_chapter_read`、`fanqie_style_lint`：tools.ts 的 EDITOR_TOOLS 只过滤写作层工具，引擎工具由 EDITOR_DENY 拦截写入类，FANQIE_EDITOR_BRIEF 也让编辑用这两个。按此推断可用，建议实测。
- aliases 中纯分工、交接类原件（dispatch、project_layout、roles）映射到 overview；handoff_contract 映射到 rhythm（其实际干货是第 7 节档位与四态）；pipeline_handoff 映射到 write-chapter。
- story_craft、structure_craft、serial_orientation、规划类模板、fanqie_outline_example、setting_choices_example 映射到规划组的 plan-foundation、plan-structure、templates-plan、examples-plan。这些内容是 novel-writer 独有的，规划组未必读过，请规划组核对是否已覆盖：四层互锁、天堑前置、自增殖危机链、章纲“能否与别章互换”判据、设定落成具体选择的示例。
- 卷末总结没有专用工具，templates-write 让它交作者，留档时压进 `happened` 卷末一条。

## 字节

| 文件 | 字节 |
|---|---|
| overview.md | 4778 |
| write-chapter.md | 5430 |
| scene.md | 5311 |
| prose.md | 6357 |
| rhythm.md | 4959 |
| continuity.md | 4658 |
| platform.md | 5552 |
| edit.md | 5603 |
| revise.md | 4350 |
| templates-write.md | 4090 |
| examples-write.md | 6301 |
| 合计（11 份） | 57389 |

原件 262063 字节 → 新 57389 字节，约 21%。方法类（SKILL 与 references 共 119500）→ 9 份方法 46998，约 39%；示例 20 份 119885 → 6301；模板 13 份 22678 → 写作类 4090（规划类模板归 templates-plan）。
