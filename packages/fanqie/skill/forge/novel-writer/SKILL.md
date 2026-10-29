---
name: novel-writer
description: '番茄小说等中文网文长篇的正文写作与精修技能。用户要写第一章、按章纲写正文、续写下一章、连写多章存稿、改稿润色、结构级重构、修对白、处境驱动去AI味、审稿查连续性、修订已定稿章节，或在投番茄前检查签约稿与发布格式时使用。写手先想清四个落点再直出草稿，落稿后做局面改变与本章变化两道自检；编辑按四类硬伤和 L1–L3 阅读损失定改动层级，改完核旧账与跨文档数字；节奏刻度按本书节奏档位（快爽／稳推／慢燃）读。配有 manuscript_linter.py、ledger_check.py、init_project.py、archive_draft.py。规划交 inspiration-forge，拆书交 inspiration-forge-library。'
license: MIT
metadata:
  version: "1.3.0"
---

# Novel Writer · 番茄长篇正文写作与精修

把本书现行规划写成读者愿意一章章追下去的正文：回报在场兑现，交锋站得住，句子有人味。写手负责落稿，编辑负责验收和按层级修改，两者分开回报。

## 1. 快速路由

按用户要的最终产物选择执行路径（详细条件分派见 `references/dispatch.md`）：

| 用户要的 | 先读与辅助脚本 | 交付 | 停在 |
|---|---|---|---|
| 写第一章、续写、按章纲写某章 | `references/writing.md`；落稿后可跑 `scripts/manuscript_linter.py` | 高完成度草稿；本批有归档授权才在审读后用 `scripts/archive_draft.py` 定稿 | 本章交付 |
| 连写多章、存稿 | `references/writing.md` 第六节、`references/continuity.md` | 逐章串行草稿，标明候选依赖与旧账承接 | 约定范围的最后一章 |
| 改稿、润色、去AI味、结构重构 | `references/editor_method.md`、`assets/examples/反AI腔与番茄高张力人味重塑对照集.md` | 四类硬伤与 L1–L3 损失清单，以及对应层级的实改稿（脚本命中只作回看提示） | 授权范围内的修改 |
| 修订已定稿章节 | `references/revision.md` | 审过的候选与差异；获准后安全更新唯一现行稿 | 现行稿更新，或只交候选 |
| 签约路径、推荐节点、发布前检查、AI声明 | `references/fanqie_platform.md` | 对照当期说明的检查、去Markdown/批注残留与 AI 声明提醒 | 后台操作由作者完成 |
| 节奏、回报在场兑现、对白、场景张力 | `references/rhythm.md`、`references/scene_craft.md`、`references/prose_craft.md` | 针对问题的场面重塑或表达升级 | 问题解决 |
| 长线连载四层互锁、天堑前置、自增殖动力 | `references/serial_orientation.md`、`references/structure_craft.md` | 长线结构校准建议；关键路线重排交规划 | 建议交付 |
| 开新书、全书路线、成批新章纲 / 拆书 | `references/handoff_contract.md`、`references/pipeline_handoff.md` | 规划交 `inspiration-forge`，指定原文拆解交 `inspiration-forge-library` | 阶段交付，不越权抢跑 |

## 2. 平台、节奏档位与文风基线

作品已记录的平台、节奏档位和作者选择优先。未记录平台时按番茄长篇连载取向（交付注明“平台按番茄长篇默认，可改”）；签约路径、推荐节点、低质治理症状与 AI 标识要求见 `references/fanqie_platform.md`。节奏档位见 `references/handoff_contract.md` 第7.1节：前 300 字、受压不跨 2 章这类刻度只属于快爽档，稳推、慢燃档按各自标准读。本书已有讲法和定稿优先于默认风格 `assets/templates/writing_style_default.md`。

## 3. 标准流程

1. **定范围、核依据**：确认章号、采用的章纲、本书档位与是否有归档权。主代理核清本章相关根基、作者锁定、定稿事实和硬边界，不让写手临时发明关键因果或证据。
2. **备齐材料**：本章现行章纲、上一章定稿全文（首章无；连写时给所依赖的候选前稿全文）、相关单元依据、快照后有出处的已核增量、本书风格 `state/writing_style.md`。
3. **写手落稿**：先想清四个落点（`references/writing.md` 第八节）：主要篇幅给哪场亲历、视角人物此刻所求与身体处境、对手的已知与主动一招、章末落在哪里。连贯落稿到 `workspace/drafts/CXXX.md`，再做两道自检：删掉卖点那一拍结果会不会变；读者读完本章多得到了什么。谨慎只管文件与事实，不管叙事胆量。
4. **编辑审读与修改**：可先跑 `python3 -B scripts/manuscript_linter.py <草稿>` 看字数、长段和套话位置，命中只是回看提示。按 `references/editor_method.md` 核四类内容硬伤（关键剧情与落点、本书硬约束、人物认知、正文接续）和 L1–L3 阅读损失，在授权范围内改到对应层级；保护口癖、自私犹豫、热烈欢庆和必要说明句；改完核旧账，跨章节、跨规划的日期与数字可先用 `scripts/ledger_check.py` 列表对照，完整回读全文。
5. **交付与归档**：默认交干净草稿（正文不夹审读标签或占位符）。本批有明确归档授权且无硬伤时，用 `scripts/archive_draft.py` 校验已审 SHA-256，独占创建 `workspace/chapters/CXXX.md`，并按实际定稿更新 `state/current_state.md`。

## 4. 作品文件与始终成立的边界

- 作品根维护五状态文件（`state/story_foundation.md`、`state/current_state.md`、`state/writing_style.md`、`state/editor_agent.md`、`state/constraints.md`）与四工作目录（`workspace/acts/`、`workspace/outlines/`、`workspace/drafts/`、`workspace/chapters/`）；可用 `scripts/init_project.py` 安全补缺。
- 始终成立的边界：审读通过不等于授权；草稿一改旧审读失效；普通归档绝不覆盖已有定稿（修订已定稿走 `references/revision.md`）；读者揭示不等于角色获知；去AI味只为阅读质量，不删除或隐藏 AI 标识，不代为登录作家后台投稿。

## 5. 按需资源与工具

- **核心方法与契约**：`references/story_craft.md`、`references/structure_craft.md`、`references/roles.md`、`references/scene_craft.md`、`references/prose_craft.md`、`references/rhythm.md`、`references/serial_orientation.md`、`references/continuity.md`、`references/revision.md`、`references/handoff_contract.md`、`references/pipeline_handoff.md`、`references/project_layout.md`。
- **模板与多题材示例**：`assets/templates/`、`assets/examples/反AI腔与番茄高张力人味重塑对照集.md`、`assets/examples/fanqie_outline_example.md`、`assets/examples/setting_choices_example.md`、`assets/examples/这座山归我了-正文与审改.md`（含 `assets/examples/这座山归我了-C001.md`～`assets/examples/这座山归我了-C003.md`）、`assets/examples/高张力场景与审改.md`（含 `assets/examples/借你这一拳.md`、`assets/examples/两张车票.md`）、`assets/examples/答案、后果与喜剧声音.md`（含 `assets/examples/掌柜说它会招财.md`）、`assets/examples/多人场面与公开方案.md`、`assets/examples/雾港旧声铺-正文与审改.md`（含 `assets/examples/雾港旧声铺-C001.md`～`assets/examples/雾港旧声铺-C005.md`）、`assets/examples/三组修订示例.md`。
- **标准库脚本**：`scripts/init_project.py`、`scripts/manuscript_linter.py`、`scripts/ledger_check.py`、`scripts/archive_draft.py`、`scripts/safe_io.py`。
