# 项目结构与文件分工

> 需要知道某个文件该往哪儿写、或某类信息该记在哪儿时查这里。**这是文件分工的唯一权威出处**，`SKILL.md` 只提供摘要与导航。

## 一、目录

```text
state/
  writing_style.md      这本书什么味道：上六节描述，第七节是写手的耳朵（口气样例）
  editor_agent.md       本书编辑入口/例外；通用方法留技能
  story_foundation.md   世界是什么：主线与承诺、结局与关键变化、人物、规则与代价
  constraints.md        硬判据入口：命名、能力边界、已定稿事实、作废项、数字口径（可链接根基与定稿）
  current_state.md      规划进度 + 定稿快照 + 待决与接续

workspace/
  volumes/              多卷作品按需使用
  acts/                 幕纲
  outlines/             章纲
  drafts/               草稿
  chapters/             已定稿正文
  plans/                复杂幕的可选拆分
  rehearsals/           卷级推演结论，按需使用
  summaries/            跨幕或跨卷导航时按需使用
  polished/             外部润色候选，不是定稿
  revisions/            授权定稿修订时的历史备份/候选，非现行事实
```

初始化脚本只创建五份状态文件和 `acts / outlines / drafts / chapters` 四个工作目录；其他目录用到再建。

**拆几场、爽点放哪、钩子怎么留不在项目里。** 这是写作技法，具体取舍按本书与章纲约定，
见 `references/rhythm.md`，不复制模板、不用每本书填一次。

`story_foundation.md` 写现行主线、人物与规则，主代理规划、补设定或派写前核相关部分；`constraints.md` 是编辑硬边界入口，可链接根基规则与定稿出处。完整规则只留一个权威版本，不抄第二份；本章必要条件仍由主代理送到章纲。

## 二、每类文件记什么

| 文件 | 用途 |
|---|---|
| `state/writing_style.md` | 风味来源表 + 句子段落对白描写的本书取值 + **第七节口气样例** |
| `state/constraints.md` | 编辑每章查的硬判据入口：命名、能力与代价边界、已定稿事实、作废项、数字口径；可链接根基现行规则与定稿出处 |
| `state/editor_agent.md` | 本书编辑配置与方法入口；通用方法在技能 references/editor_method.md，已有长文件保留 |
| `state/story_foundation.md` | 主线与承诺、结局与关键变化、人物、规则与代价、有效用户约定 |
| `state/current_state.md` | 规划进度 + 从定稿正文整理的当前处境 + 未结事项与接续入口 |
| `workspace/volumes/V01.md` | 多卷作品的卷级导航，按需使用 |
| `workspace/rehearsals/V01.md` | 卷级推演结论（模板见 `assets/templates/volume_rehearsal.md`），仍是规划不是正文事实，按需使用 |
| `workspace/acts/A01.md` | 一幕要解决的问题、因果链、输出状态，幕末校准 |
| `workspace/outlines/C001.md` | 章纲：四块正文（`## 1.`～`## 4.`），人物此刻写在头注或节点里（模板见 `assets/templates/chapter_outline.md`） |
| `workspace/drafts/C001.md` | 尚未确认的正文草稿 |
| `workspace/chapters/C001.md` | 已确认的正式章节 |
| `workspace/plans/` | 复杂幕或多线并进时的可选拆分（模板见 `assets/templates/plan.md`），按需使用 |
| `workspace/summaries/` | 跨幕或跨卷导航摘要（模板见 `assets/templates/summary.md`、`assets/templates/volume_summary.md`），按需使用 |

## 三、角色互不越界

**技法、风味、去 AI 味是三件事，混在一起就谁都做不好。** 完整定义见 `references/roles.md`。

| 角色 | 读什么 | 不承担什么 |
|---|---|---|
| 写手 | 本章章纲、前章全文、当前单元依据、状态与已核增量、本书讲法；必要方法路径 | 全书规划裁决、整份编辑方法与归档 |
| 编辑 | 草稿全文、章纲、硬边界入口、编辑方法、本书讲法、前章与必要早先出处；根基相关链接按需读 | 无关全书审计、擅自改锁定或定稿 |
| 主代理 | 分派、实际授权、现行规划、相关定稿与规则 | 不把上下文缺口丢给子代理；不授予超出用户范围的权限 |

**写手不替主代理判断整份硬边界入口与编辑方法（`editor_agent.md`、`constraints.md`）。**
**主代理在派写前已核清并把本章硬条件抽进章纲**，编辑验收时再核完整入口。
写手照章纲的本章要求写即可——**这不等于可以不遵守已定条件**。

**风味文件按本章需要读，双方不擅自重写。** 具体表达服从本书取舍而非机械模仿；出现真实漂移或作者改取舍时由主代理定点调整，不能用改风格替偏差找理由。

## 四、资料库不是项目的一部分

本技能包自带的模板和范例放在 `assets/`，它们是**本技能包的资产，不是某本小说的项目文件**：

```text
assets/
  templates/             写作模板，init_project.py 从这里补五状态文件
  examples/              虚构范例：抽象设定如何落成选择、章纲颗粒度（可作参照，非门禁）
```

不要把 `assets/` 的内容复制进项目当正文素材。模板用完就填，填完的就是项目自己的文件。

**作品只维护一份现行规划。** 章纲格式见 `assets/templates/chapter_outline.md`，填表示例见 `assets/examples/fanqie_outline_example.md`。已有规划直接沿用，在原文件上处理实际缺项。
