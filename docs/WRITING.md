# 写作内核与业务规则

- **描述范围**：v1.4 功能实现与本轮集成验证；当前发布版本 `v1.3.0`，v1.4 尚未发布。
- 本文件只记录当前实现的规则与取值；改规则前先读 [AGENTS.md](../AGENTS.md) 的红线条款。

## 1. 受保护的业务规则（不可擅改）

| 规则 | 权威来源 | 口径 |
| --- | --- | --- |
| 头条标题上限 | [rules.py](../packages/toutiao/skill/scripts/rules.py) `TITLE_MAX` | 严格 ≤34 字 |
| 头条质检及格线 | 同文件 `PASS_SCORE` | ≥84 分且零 fail、无硬闸 |
| 编辑打回上限 | [status.ts](../packages/fanqie/src/domain/status.ts) `MAX_EDITOR_REJECTIONS` | 2 轮 |
| 头条固定末句 | [status.ts](../packages/toutiao/src/domain/status.ts) `FIXED_DELIVERY_ENDING` | `——AI 到此止步。是否采用、何时发布由你决定。` |
| 状态词表 | 两个 `domain/status.ts` | 番茄：`planned / drafting / drafted / reviewed / final`；头条：`初稿待改 / 待验收 / 已验收 / 验收退回 / 已交稿` |

规则版本：头条 `rules.py` 为 **4.0.0**；六维权重与分项及格线（`WEIGHTS`、`PASS_LINE`）同在 `rules.py`，TS 侧只经桥读取，不重复定义。

## 2. 阶段取用表（`stage-map.json`）

- 取消“模型压缩阶段卡”，由 [stage-map.ts](../packages/core/src/methods/stage-map.ts) 按 `profiles/default/stage-map.json` 的 `file`、`sections`、`maxChars` 确定性直取方案 Markdown 原文。
- `methodFor(profile, stage)` 返回拼接文本、内容哈希与缺失/截断记录 `omitted`，并在 `RunRecord` 留痕，保证同一方案与版本下提示词输入可复现。
- 现有条目 **19 条**：番茄 11（`book.card/foundation/structure/outline`、`chapter.beats/draft/select/review/revise`、`ledger.extract`、`library.dissect`），头条 8（`article.card/title/blueprint/draft/review/revise/qa/deliver`）。

## 3. 番茄长篇流水线与设定集

### 3.1 关键流水线

- **`fanqie.book`**：立项卡 → 根基 → 卷结构 → 单元 → 章纲；产物进入待确认批次，作者提交后写入书级信息与大纲真源。
- **`fanqie.chapter`**：`prepare`（零费用预检未知实体）→ `beats` → `draft×N`（经济 1；标准 2 / 黄金章 5；精品 3 / 黄金章 8，纯文本）→ `gate`（字数与规则代码闸）→ `select-score`（逐稿独立打分）→ `select-compare`（前两名换位比较）→ `continuity-check` → `review`（引文逐条容错定位，≤2 轮）→ `revise` → `deliver`（幂等交付候选）。
- **`fanqie.review` / `fanqie.revise`**：可单独对已写章节发起审读与定向修订；单独审读结果由作者确认后写回。
- **`fanqie.ledger` / `fanqie.health`**：定稿后抽取结构化增量并写入待确认批次；作者决定并提交后，在同一 Intent 写入 ledger 与设定真源，可整批撤销。十二类一致性检查覆盖伏笔、知情、状态、证据、出场与章纲偏差等问题。
- **`fanqie.import`**：TXT/MD 预处理 → 可编辑分节映射 → 分块抽取 → 引文定位 → 名称消歧与关系补全 → 待确认提案。抽取结果只进入待确认批次；作者可修改映射、逐条审核、重试失败块、提交或撤销。
- **`library.dissect`**：拆书入库，产出参考卡片供 L6 使用。

规范化保留原文字形，只统一约定换行、不可见字符和空白；分节、分块、偏移映射与引文定位共用同一份规范正文。匹配时可对文本做兼容归一化，但返回位置仍映射到原文 UTF-16 偏移。无标题文本归入正文段，首个标题前内容单独保留；作者可编辑卷/幕/章映射或忽略标题。导入解析和来源预览为本地流程，AI 抽取通过已配置模型网关运行。

### 3.2 设定集 `bible/` 与分层上下文 `L0–L6`

- **唯一连续性真源**（[store.ts](../packages/fanqie/src/bible/store.ts)）：实体、时间线、状态区间、伏笔、知情表、文风与规则集合，加 `ledger/<chapter-id>.json`、`pending/<batch-id>.json`、`changes/<YYYY-MM>.jsonl` 与文件 rev/hash 索引。作者决定与真源提交分离；多文件提交和撤销由 Intent 原子写入。书级规划存于 `outline/book.json` 和 `outline/volumes/<id>.json`，与设定集分开管理。
- **上下文组装器**（[builder.ts](../packages/fanqie/src/context/builder.ts)）：
-  - `L0` 当前章纲、个人规则与作者要求；章纲私记不进入模型上下文。
  - `L1` 前章摘要、交接摘要和正文尾部；新章位置按大纲与现有 ledger 推导，避免首章遗漏在场上下文。
  - `L2` 本章人物、地点、关系与前文命中实体。
  - `L3` 知情边界、有效状态与伏笔硬约束。
  - `L4` 近期章节摘要与记账事实。
  - `L5 / L6` 早期章节检索片段与拆书参考卡，参考内容标注为机制参考。
  - 上下文预算由阶段预算、输入内容与输出格式共同核算；必带块超限报错，可选块按层级裁减并记录 `omitted`。
- **个人规则学习**（[diff.ts](../packages/fanqie/src/learning/diff.ts)）：段落级 diff 对齐删改、扩写与对话调整；同类改法累计达 **3 次**（`PROMOTE_THRESHOLD`）提示候选，由作者逐条采纳写入 `bible/style.json`。

## 4. 今日头条流水线与质检

- **阶段链路（`toutiao.article`）**：来源登记（只读给定来源）→ `card`（`qa_check.py --card` 预检）→ `title`（≥5 条、≤34 字、覆盖 ≥3 个母体）→ `blueprint`（开头式/结尾式与同线上一篇轮换）→ `draft` → 事实链（[claims.ts](../packages/toutiao/src/domain/claims.ts) 抽取候选并配对证据，失败单条标 `unlocated` 不中断整步）→ `review` → `revise`（`s5-editing`）→ `qa`（Python 质检 ≥84 分）→ 精修（最多两轮，变更段增量复核事实）→ 待验收 → `deliver`（交稿单）。
- **体裁与篇幅带**（`rules.py` `BANDS`）：长图文 2,600–3,400 字、短图文 1,100–2,200 字、微头条 300–1,000 字。
- **防刷分提示**：精修前后统计口语标记与小标题增量，超过阈值仅提示作者复核，不直接扣分或篡改评分。

## 5. 大纲、导入与作者确认

- 大纲树按卷 / 幕 / 章纲组织；章纲可绑定正文，已写章节移动前必须查看位置预览并确认。键盘方向键浏览层级，`Alt+↑/↓` 调整同级顺序。
- 设定库支持实体、状态、时间线、伏笔、知情关系及位置查询；待确认页显示来源、证据、变更差异与置信度，作者可接受、拒绝或编辑后接受。
- 导入来源文本、分节映射和模型提案分开保存。提交前正文与设定真源不改变；提交生成可追溯变更集，历史页可按 rev 检查结果并撤销。

## 6. 资产维护与来源

- **运行时方法层**：[packages/fanqie/profiles/default/](../packages/fanqie/profiles/default/)（17 份 Markdown + `profile.json` + `stage-map.json`）与 [packages/toutiao/profiles/default/](../packages/toutiao/profiles/default/)（29 份 Markdown + 2 份 JSON）是 `stage-map` 的直接输入；流水线只按 `take.file/sections/maxChars` 取文本，不读取其他资产。
- **独立技能层**：[packages/fanqie/skill/forge/](../packages/fanqie/skill/forge/) 含 `inspiration-forge`、`inspiration-forge-library`、`novel-writer` 三个 MIT 技能（111 份 Markdown，版本 1.3.0），[packages/toutiao/skill/](../packages/toutiao/skill/) 含 `SKILL.md`、`corpus/`、`references/` 与交稿模板（非测试文档 30 份）；这些是独立技能资产，不是应用运行时源码。
- **单一真源**：`profiles/default` 是产品阶段提示词的唯一来源；`skill/references` 与 `skill/corpus` 是技能参考，不参与 `stage-map`；`fanqie/skill/forge` 的共享模板在多个技能中保留副本，修改时须同步所有副本。方法文本可能提到 `toutiao_headline_set` 等 skill 工具名，应用流水线不注册这些工具，修改时不得把技能工具调用写成产品命令。
- 头条质检脚本与语料位于 [packages/toutiao/skill/](../packages/toutiao/skill/)：`rules.py`、`qa_check.py`、`writer_bridge.py`、`ledger.py`、`fetch_hot.py`。变更资产后须同步核对 `stage-map.json` 引用的章节标题与 [scripts/assets.mjs](../scripts/assets.mjs) 清单；`profiles/` 与 `skill/` 受 `.prettierignore` 保护，不参与格式化。
