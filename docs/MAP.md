# 任务地图 · 0.18.0

导航单源是 `ports/scheduler.ts`。按最终产物进入，不要求三阶段连跑。

| 任务 | 最短路径 | 停点 |
| --- | --- | --- |
| 分析片段 | `reference_analyze(text, question)` → 提交 report / quotes / transfer；save 可选 | 分析成果，不入公共库 |
| 正式拆书 | import → plan → 分批 dissect → facts / structure → card_stage → card_accept | 已采纳参考卡；Full 阅读需确认 |
| 规划 | inspire_start(goal，参考可选) → forge_brief → stage → accept(apply=true) | 当前采用规划，不自动开写 |
| 正文 | chapter_brief → 创作与回读 → candidate_stage → candidate_accept | 当前工作稿，采纳内置扫描 |
| 审读与定稿 | chapter_read → chapter_save(status=reviewed, expected_revision=已读revision) → 明确获准后 status=final | 已审字节对应的定稿 |
| 修订 | 核基线 → 候选或直接保存（定稿须 force）→ 重核影响 → 重审与定稿 | 唯一现行稿与历史 |
| 汇编 | assemble；可选 only_final | manuscripts 内的完整输出 |

`style_lint`、三种审计、厚 brief、深度编辑和多草稿均按需；多草稿默认关闭。已有过期扫描凭据仍须重扫，不能把旧凭据移到新正文。

缺准备记录时可显式 skip_brief，但不能绕开候选已记录的实际版本冲突。旧候选没有目标基线时要提供 expected_revision 或重新暂存。

作者核对修订影响后可 `chapter_save(acknowledge_revision=true, expected_revision=当前revision)`。这清除提示，不改写正文，也不使过期的审读或候选自动恢复有效。

恢复入口见 [DATA.md](DATA.md)，共同语义见 [COGNITION.md](COGNITION.md)。
