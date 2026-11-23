# 写作内核与业务规则（v2.1）

## 1. 受保护的业务规则（核心红线）

以下业务规则构成织章的质量底线，未经作者明确书面授权严禁更改，且在代码中遵守“单一真源”原则：

| 规则项 | 唯一权威来源 | 约束口径 |
| --- | --- | --- |
| 头条标题字数上限 | [packages/toutiao/skill/scripts/rules.py](packages/toutiao/skill/scripts/rules.py) `TITLE_MAX` | 严格 ≤ 34 字；TS 经 `writer_bridge.py limits` 读取，严禁硬编码 |
| 头条质检及格线 | [packages/toutiao/skill/scripts/rules.py](packages/toutiao/skill/scripts/rules.py) `PASS_SCORE` | ≥ 84 分且零 fail、无硬闸；由 `qa_check.py` 执行裁决 |
| 头条开头/结尾式 | `rules.py` `OPENING_STYLES` / `ENDING_STYLES` | 经 `writer_bridge.py limits` 的结构化 `styles` 字段下发至 TS |
| 编辑打回轮次上限 | `MAX_EDITOR_REJECTIONS = 2` | 番茄审读修订、头条精修均最多 2 轮，防止死循环与费用失控 |
| 头条交稿固定末句 | [packages/toutiao/src/domain/status.ts](packages/toutiao/src/domain/status.ts) | `——AI 到此止步。是否采用、何时发布由你决定。`（幂等校验不重复追加） |
| 番茄章节状态词表 | [packages/fanqie/src/domain/status.ts](packages/fanqie/src/domain/status.ts) | `planned` → `drafting` → `drafted` → `reviewed` → `final` |
| 头条文章状态词表 | [packages/toutiao/src/domain/status.ts](packages/toutiao/src/domain/status.ts) | `初稿待改` → `待验收` → `已验收` / `验收退回` → `已交稿`（终态不可逆） |

## 2. 确定性方法体系（`stage-map.json`）

- 织章采用**确定性直取**取代不可控的模型摘要：每个模式在 `profiles/default/` 下维护方法 Markdown 与 `stage-map.json`（声明每个阶段取用的文件、章节标题、`maxChars` 与可选 `when` 路由条件）。
- 运行时由 `@zhizhang/core/methods` 的 `methodFor(profile, stage, vars)` 拼接方法原文、计算 SHA-256 哈希并记录 `omitted[]`，写入 `RunRecord` 以便审计与复现。
- 作者可在状态目录 `profiles/<mode>/<id>/` 定制方法方案，覆盖内置默认方案而不污染安装包。

## 3. 番茄长篇内核（`@zhizhang/fanqie`）

### 3.1 流水线体系
- **全书规划（`fanqie.book`）**：`card` → `foundation` → `structure` → `outline`。交付阶段写入隔离目录 `plan/proposals/<runId>/`，绝不覆写正在创作的正式 `plan/*.json`；作者确认采用后经 `applyBookPlan` 备份旧规划，再以 `commitIntent` 原子晋升规划文件与初始设定集。
- **章节写作（`fanqie.chapter`）**：
  1. `prepare`：读取 `work.json`（损坏即报错）、前章正文、卷结构、绑定参考卡与设定集，组装预算受控的 `ContextPacket`。
  2. `beats` → `draft × N`：按档位（经济 1 / 标准 2、黄金章 5 / 精品 3、黄金章 8）并行产出纯文本候选。
  3. `gate`：代码硬闸检查篇幅区间、占位符与禁用标记。
  4. `select`：对通过门禁的多份候选**并行逐稿打分**，再取前二**并行换位比较**（AB / BA 消除位置偏置）。
  5. `continuity-check` → `review` / `revise`（≤2 轮）：引文逐条容错定位；若某轮修稿未通过门禁，**自动回退保留上一版通过门禁的候选稿**并将门禁问题记入审读摘要供作者裁决，不丢失整次运行成果。
  6. `deliver`：写入 `candidates/<chapterId>/<runId>.md` 与 `.meta.json` + `.marker.json` 实现幂等交付。
- **定稿记账（`fanqie.ledger`）与全书体检（`fanqie.health`）**：定稿后抽取实体、状态、伏笔与知情增量，全部进入 `bible/pending.json` 待作者逐条裁决；每 10 章支持全书连续性巡检。

### 3.2 设定集 `bible/` 与分层上下文 `L0–L6`
- **唯一连续性真源**（`bible/schemas.ts`、`bible/audit.ts`、`bible/store.ts`）：
  - `read()` 按文件 mtime/size 签名缓存，写入时自动失效；所有更新经 `commitIntent` 原子落盘并刷新 `index.json` 哈希。
  - `asOf(position)` 按 `since`/`until` 时间窗口精确切片；`audit(upTo)` 预建实体索引表与知情排序二分检索，线性复杂度识别遗忘伏笔、到期未兑现、知情越界与状态冲突。
- **分层上下文组装器**（`context/builder.ts`）：
  - `L0`（必选）：本章章纲、个人文风规则与作者附言；
  - `L1`：前章摘要、章末交接与前文（标准/精品取前章全文上限 4,000 字，经济取末尾 1,500 字 + 交接）；
  - `L2`：按章纲与前文命中的在场与全局实体；
  - `L3`：知情边界与未回收伏笔硬约束；
  - `L4`：近 10 章摘要；
  - `L5 / L6`：基于 2-gram LRU 缓存的 BM25 远期章节检索与拆书参考卡（强制标注“参考机制，不复制”）。
  - 严格执行 `input.budget`：超预算时按优先级依次压缩低优先参考、L4、L2 非必选实体与 L1 前文尾部，并在 `omitted[]` 中留痕。
- **个人规则学习**（`learning/diff.ts`）：作者手工改稿保存后做段落级 diff 分析，同模式累计达到阈值后形成建议条目，由作者决定是否晋升至 `bible/style.json`。

## 4. 今日头条图文内核（`@zhizhang/toutiao`）

- **单真源规则桥**（`rules/bridge.ts` + `skill/scripts/writer_bridge.py`）：
  - `limits()` 读取 `rules.py` 的字数限制、质检及格线及结构化 `styles`，并按 `rules.py` mtime 缓存；
  - `checkCard()` 直接调用 `writer_bridge.py check-card --card <path>`，消除脚本拼接；
  - `qa()`、`ledger*()` 均经 `runPythonJson` 强制 Schema 校验。
- **文章流水线（`toutiao.article`）**：
  1. 来源登记（只读作者给定文本或公开网页提取，绝不篡改原意）→ 构建预算受控的 `sourcePacket` / `cardPacket`；
  2. 立项卡（经 `checkCard` 门禁校验）→ 标题矩阵（≥5 条、每条 ≤34 字、覆盖 ≥3 个母体）→ 蓝图（同赛道开头式/结尾式自动轮换）；
  3. 按赛道 `when` 条件路由起稿 → 代码抽词与证据核对（[claims.ts](packages/toutiao/src/domain/claims.ts)，单条无证据标 `unlocated` 不中断整步）→ `s5-editing` 审读修订；
  4. Python 质检（临时文件隔离在 `articleDir/.tmp/`，用后 `finally` 清理，不污染 `drafts/`），未过线则按问题精修（≤2 轮，增量复核变更段事实链）并做防刷分统计提示（只提示作者复核，不篡改分数）；
  5. 交付草稿并进入 `待验收`，作者验收确认后生成带固定末句的 `delivery.md` 并同步台账 `ledger.csv`。

## 5. 内置资产维护

- 内置方法与规则来源登记在 [assets/sources.json](assets/sources.json)，校验清单位于 [assets/manifest.json](assets/manifest.json)。
- 修改 `packages/fanqie/profiles/default/`、`packages/toutiao/profiles/default/` 或 `skill/` 后，运行：
  1. `npm run assets -- manifest` 重建校验清单；
  2. `npm run assets -- check` 验证磁盘文件哈希、上游版本号及全部 `stage-map.json` 引用文件存在性。
