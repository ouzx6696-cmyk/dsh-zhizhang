# 任务与交接

先确定本次最终产物，再进入相应流程。已有充分材料可以直接使用；阶段完成不会自动授权下一阶段。下表工具名省略 `fanqie_` 前缀。

| 本次目标 | 入口与路径 | 完成后的状态 |
| --- | --- | --- |
| 回答一个参考问题 | `reference_analyze(text, question)`，再提交 report、quotes、transfer；save 可选 | 工作区分析，不自动入公共库 |
| 建立可复用参考库 | `library_import → library_plan → dissect_brief → facts/structure → card_stage → card_accept → report` | 有来源的已采纳卡及分析报告 |
| 发展原创规划 | `inspire_start → forge_brief → stage → accept(apply=true)` | 采用根基或全书/卷/幕/章纲，不自动写正文 |
| 写作一章 | `chapter_brief → 创作与回读 → candidate_stage → candidate_accept` | 当前工作稿 |
| 审读与定稿 | `chapter_read → chapter_save(status=reviewed, expected_revision=已读版本) → status=final` | 当前版本通过且在授权内的定稿 |
| 修订 | 读现行稿 → 核基线 → 准备并应用修改 → 核相关影响 → 重审 | 唯一现行稿及独立历史副本 |
| 汇编 | `assemble` | Markdown 输出，章节状态不变 |

## 参考怎么进入规划

工作区分析保存原文片段、来源哈希、报告、逐字引文和迁移包。用 `inspire_start(reference_ids=[...])` 明确选择它，不必先入正式参考库。公共库卡则使用 `card_ids`。

迁移包回答：原作创造什么体验，具体怎么做到，哪些条件必须重造，哪些内容不能照搬，何时会失效。`experience / steps / recreate / discard / failWhen` 不要求凑固定数量。

正式卡的 `craft` 辅助场面写法，`mind` 辅助作品设计；这是一种用途分类。没有 mind 卡不阻止材料充分的规划，也不要求先补库。

## 规划怎么进入正文

全书、卷、幕与章纲只有明确应用后才成为现行规划。章纲复用现有 Outline，作者完整 Markdown 可放在 `synopsis`，不另建一份可分别编辑的权威稿。简报按章节关联注入必要材料，不把全库卡片或整书索引无差别塞入上下文。

绑定现有作品的规划会话记录起始依据。作品或所选参考后来变化，应用前重新核对；旧会话不会静默重设基线。

## 哪些是可选项

- `style_lint` 和三种 audit：提前定位问题；采纳已内置扫描。
- 编辑：按真实问题与作者授权处理，A/B/C 是兼容采用范围交互。
- `brief_mode=full`：确实需要较厚材料时使用，默认 lean。
- 多草稿与统一整理：显式开启后使用，默认关闭。
- 直接 `chapter_save`：用于明确保存、状态操作或旁路写入；较大正文需 `confirm_bypass=true`。

`skip_brief` 只能显式跳过简报门禁，不能绕过候选记录的真实版本冲突。`force` 只允许修改定稿正文，也不能代替基线核对。

汇编的 `only_final=true` 当前包含 `reviewed` 和 `final`。若交付要求全章定稿，应先核目录和实际审读依据。中断处理见[数据与恢复](DATA.md)。
