# 写作内核与业务规则（v1.3）

## 1. 受保护的业务规则（不可擅改）

| 规则 | 权威来源 | 口径 |
| --- | --- | --- |
| 头条标题上限 | [rules.py](packages/toutiao/skill/scripts/rules.py) `TITLE_MAX` | 严格 ≤34 字（TS 经 `writer_bridge.py limits` 读取） |
| 头条质检及格线 | [rules.py](packages/toutiao/skill/scripts/rules.py) `PASS_SCORE` | ≥84 分且零 fail、无硬闸 |
| 编辑打回上限 | 业务约束 `MAX_EDITOR_REJECTIONS = 2` | 番茄审读修订、头条精修均最多两轮 |
| 头条固定末句 | [status.ts](packages/toutiao/src/domain/status.ts) | `——AI 到此止步。是否采用、何时发布由你决定。` |
| 状态词表 | 番茄/头条 `domain/status.ts` | 番茄：`planned / drafting / drafted / reviewed / final`；头条：`初稿待改 / 待验收 / 已验收 / 验收退回 / 已交稿` |

## 2. 阶段取用表（`stage-map.json`）

- 取消“模型压缩阶段卡”，改为由 [stage-map.ts](packages/core/src/methods/stage-map.ts) 按 `profiles/default/stage-map.json` 的 `file`、`sections`、`maxChars` 确定性直取方案 Markdown 原文。
- `methodFor(profile, stage)` 返回拼接文本、内容哈希与缺失/截断记录 `omitted`，并在 `RunRecord` 中留痕，确保同一方案与版本下提示词输入可复现。

## 3. 番茄长篇流水线与故事圣经

### 3.1 关键流水线
- **`fanqie.book`**：立项卡 → 根基 → 卷结构 → 单元 → 章纲，作者采用后写入 `plan/` 与初始 `bible/`。
- **`fanqie.chapter`**：`prepare`（零费用预检未知实体）→ `beats` → `draft×N`（经济 1；标准 2/黄金章 5；精品 3/黄金章 8，纯文本输出）→ `gate`（字数/规则代码闸）→ `select`（逐稿独立打分后取前两名换位比较）→ `continuity-check` → `review`（引文逐条容错定位）→ `revise` → `deliver`（幂等交付候选）。
- **`fanqie.ledger` & `fanqie.health`**：定稿后抽取结构化增量写入 `pending.json` 待作者确认；每 10 章执行一次伏笔遗忘、知情越界与状态冲突体检。

### 3.2 故事圣经 `bible/` 与分层上下文 `L0–L6`
- **唯一连续性真源**（[store.ts](packages/fanqie/src/bible/store.ts)）：维护实体（含别名匹配）、状态时间序列（`asOf(N)` 按 `since/until` 窗口切片）、伏笔线索、知情矩阵、章节交接、文风与个人规则、待确认列表。
- **上下文组装器**（[builder.ts](packages/fanqie/src/context/builder.ts)）：
  - `L1` 前章摘要、章末交接与前文（标准/精品给前章全文上限 4,000 字，经济给末尾 1,500 字 + 交接）。
  - `L2` 按章纲与前文命中的在场及全局实体。
  - `L3` 知情边界与有效伏笔硬约束。
  - `L0` 本章章纲、个人规则与作者要求。
  - `L4` 近 10 章摘要（按剩余预算纳入或记录 `omitted`）。
  - `L5 / L6` 远期检索片段与拆书参考卡（“参考机制，不复制”标注）。
- **个人规则学习**（[diff.ts](packages/fanqie/src/learning/diff.ts)）：基于段落级 diff 对齐删改、扩写与对话调整，跨次累计达到阈值后提示候选，由作者逐条采纳写入 `bible/style.json`。

## 4. 今日头条流水线与质检

- **阶段链路（`toutiao.article`）**：来源登记（只读给定来源）→ 立项卡（`qa_check.py --card` 预检）→ 标题矩阵（≥5 条、≤34 字、覆盖 ≥3 个母体）→ 蓝图（开头式/结尾式与同线上一篇轮换）→ 起稿 → 事实链（[claims.ts](packages/toutiao/src/domain/claims.ts) 抽取候选并配对证据，失败单条标 `unlocated` 不中断整步）→ 审读 → `s5-editing` 修订 → Python 质检（≥84 分）→ 精修（最多两轮，变更段增量复核事实）→ 待验收 → 交稿单。
- **防刷分提示**：精修前后统计口语标记与小标题增量，超过阈值仅提示作者复核，不直接扣分或篡改评分。

## 5. 资产维护与来源

- 默认方法文档位于 [packages/fanqie/profiles/default/](packages/fanqie/profiles/default/) 与 [packages/toutiao/profiles/default/](packages/toutiao/profiles/default/)；头条质检脚本与语料位于 [packages/toutiao/skill/](packages/toutiao/skill/)。
- 变更资产文件后须同步核对 `stage-map.json` 引用的章节标题与 `scripts/assets.mjs` 清单。
