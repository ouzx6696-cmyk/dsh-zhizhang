# 写作内核与业务规则

- **描述基线**：master `83bf7f7`（未发布）；当前工作分支 `arch/freeze-stubs`（A-02 接口桩与契约测试 + 清洁提交 `0e0d5fc`，待审核）；发布版本 `v1.3.0`
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

- **`fanqie.book`**：立项卡 → 根基 → 卷结构 → 单元 → 章纲，作者采用后写入 `plan/` 与初始 `bible/`。
- **`fanqie.chapter`**：`prepare`（零费用预检未知实体）→ `beats` → `draft×N`（经济 1；标准 2 / 黄金章 5；精品 3 / 黄金章 8，纯文本）→ `gate`（字数与规则代码闸）→ `select-score`（逐稿独立打分）→ `select-compare`（前两名换位比较）→ `continuity-check` → `review`（引文逐条容错定位，≤2 轮）→ `revise` → `deliver`（幂等交付候选）。
- **`fanqie.review` / `fanqie.revise`**：可单独对已写章节发起审读与定向修订；单独审读结果由作者确认后写回。
- **`fanqie.ledger` / `fanqie.health`**：定稿后抽取结构化增量写入 `bible/pending/<batch>.json` 待作者确认（接受 `ledger.write` 后落 `bible/ledger/<chapter-id>.json`）；每 10 章执行伏笔遗忘、知情越界与状态冲突体检。
- **`fanqie.import`**：A-02 已注册的空流水线（`docmap → extract → locate → resolve → propose`），阶段实现、提示词与假模型分派归 I-02；当前运行返回 `internal`。
- **`library.dissect`**：拆书入库，产出参考卡片供 L6 使用。

### 3.2 设定集 `bible/` 与分层上下文 `L0–L6`

- **唯一连续性真源**（[store.ts](../packages/fanqie/src/bible/store.ts)）：实体（含别名匹配）、时间线、状态时间序列（`asOf(N)` 按 `since/until` 窗口切片）、伏笔线索、知情矩阵、文风与个人规则 6 份集合 JSON，加 `ledger/<chapter-id>.json` 章节交接、`pending/<batch>.json` 待确认批次与 `index.json` 索引。
- **上下文组装器**（[builder.ts](../packages/fanqie/src/context/builder.ts)）：
  - `L1` 前章摘要、章末交接与前文。前文模式由作品设置 `previousTextMode` 决定：`auto`（默认，末尾 1,800 字）或 `full`（最多 6,000 字）；不再按档位硬编码。
  - `L2` 按章纲与前文命中的在场及全局实体。
  - `L3` 知情边界与有效伏笔硬约束。
  - `L0` 本章章纲、个人规则与作者要求。
  - `L4` 近 10 章摘要（按剩余预算纳入或记 `omitted`）。
  - `L5 / L6` 远期检索片段（BM25 + 字符 2-gram）与拆书参考卡（“参考机制，不复制”标注）。
  - 总预算当前固定 **12,000 token**，超出部分逐项记 `omitted`；全局设置 `engine.inputBudget`（默认 24,000）尚未接入章节组装器。
  - **v1.4 计划变更（X-01，尚未实现）**：前文改为按档位取值（标准/精品全文 ≤4,000 字、经济末尾 1,500 字），预算改为按 `engine.inputBudget` 推导并按层分配（L2 ≤25%、L4 ≤15%、L5 ≤10%、L6 余量）。
- **个人规则学习**（[diff.ts](../packages/fanqie/src/learning/diff.ts)）：段落级 diff 对齐删改、扩写与对话调整；同类改法累计达 **3 次**（`PROMOTE_THRESHOLD`）提示候选，由作者逐条采纳写入 `bible/style.json`。

## 4. 今日头条流水线与质检

- **阶段链路（`toutiao.article`）**：来源登记（只读给定来源）→ `card`（`qa_check.py --card` 预检）→ `title`（≥5 条、≤34 字、覆盖 ≥3 个母体）→ `blueprint`（开头式/结尾式与同线上一篇轮换）→ `draft` → 事实链（[claims.ts](../packages/toutiao/src/domain/claims.ts) 抽取候选并配对证据，失败单条标 `unlocated` 不中断整步）→ `review` → `revise`（`s5-editing`）→ `qa`（Python 质检 ≥84 分）→ 精修（最多两轮，变更段增量复核事实）→ 待验收 → `deliver`（交稿单）。
- **体裁与篇幅带**（`rules.py` `BANDS`）：长图文 2,600–3,400 字、短图文 1,100–2,200 字、微头条 300–1,000 字。
- **防刷分提示**：精修前后统计口语标记与小标题增量，超过阈值仅提示作者复核，不直接扣分或篡改评分。

## 5. 资产维护与来源

- 默认方法文档位于 [packages/fanqie/profiles/default/](../packages/fanqie/profiles/default/)（18 份 Markdown + `profile.json` + `stage-map.json`）与 [packages/toutiao/profiles/default/](../packages/toutiao/profiles/default/)（31 份 Markdown + 2 份 JSON）。
- 头条质检脚本与语料位于 [packages/toutiao/skill/](../packages/toutiao/skill/)：`rules.py`、`qa_check.py`、`writer_bridge.py`、`ledger.py`、`fetch_hot.py`。
- 变更资产文件后须同步核对 `stage-map.json` 引用的章节标题与 `scripts/assets.mjs` 清单；`profiles/` 与 `skill/` 受 `.prettierignore` 保护，不参与格式化。
