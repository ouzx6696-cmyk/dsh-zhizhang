# 写作内核与业务规则

本文档定义织章双创作模式（番茄长篇与今日头条图文）的受保护业务规则、确定性方法体系、全链路流水线与内置资产维护规范。

## 1. 受保护的业务规则

以下规则是织章的质量底线，未经作者明确书面授权严禁修改，且在实现中坚持“单一真源”：

| 规则项 | 权威真源 | 约束口径 |
| --- | --- | --- |
| 头条标题字数上限 | `packages/toutiao/skill/scripts/rules.py` (`TITLE_MAX`) | 严格 ≤ 34 字；TS 侧经 `writer_bridge.py limits` 读取，禁止硬编码 |
| 头条质检及格线 | `packages/toutiao/skill/scripts/rules.py` (`PASS_SCORE`) | ≥ 84 分且零 fail、无硬闸；由 `qa_check.py` 执行裁决 |
| 头条开头/结尾式 | `packages/toutiao/skill/scripts/rules.py` (`OPENING_STYLES` / `ENDING_STYLES`) | 经 `writer_bridge.py limits` 结构化下发至 TS |
| 编辑打回轮次上限 | `MAX_EDITOR_REJECTIONS = 2` | 番茄审读修订、头条精修均不超过 2 轮 |
| 头条交稿固定末句 | `packages/toutiao/src/domain/status.ts` (`FIXED_DELIVERY_ENDING`) | `——AI 到此止步。是否采用、何时发布由你决定。`（幂等落盘不重复追加） |
| 番茄章节状态词表 | `packages/fanqie/src/domain/status.ts` | `planned` → `drafting` → `drafted` → `reviewed` → `final` |
| 头条文章状态词表 | `packages/toutiao/src/domain/status.ts` | `初稿待改` → `待验收` → `已验收` / `验收退回` → `已交稿`（终态不可逆） |
| 作者是裁判 | 全流水线与只读助手边界 | 所有正文采纳、逐处合并、定稿、设定落盘、全书规划晋升与交稿确认均由作者显式触发 |

## 2. 确定性方法体系（`stage-map.json`）

- 织章采用**确定性原文直取**取代不可控的模型摘要：各模式在 `packages/<mode>/profiles/default/` 维护方法论 Markdown 与 `stage-map.json`（声明每个流水线阶段读取的文件、标题切片、`maxChars` 与可选 `when` 路由条件）。
- 运行时由 `@zhizhang/core/methods` 的 `methodFor(profile, stage, vars)` 拼接方法原文、计算 SHA-256 哈希并记录裁剪明细 `omitted[]`，一并写入 `RunRecord` 以便审计与复现。
- 作者可在应用状态目录 `profiles/<mode>/<id>/` 下创建自定义方案，覆盖默认方法而不改动内置资产。

## 3. 番茄长篇全链路

番茄长篇贯通「**拆书提炼 → 全书规划 → 章节写作/续写/精修 → 设定集与连续性守护 → 旧书接管与连载存稿管理**」一体化创作闭环：

### 3.1 拆书与技法仓库（`fanqie.dissect`）
- **结构测绘与分层抽样**（`packages/fanqie/src/pipelines/dissect/`）：调用 `novel_scanner.py` 与分层抽样策略定位开篇黄金章、中段高潮与收束样本，避免全书盲读。
- **逐字引文核验与五层拆解**：提炼卖点骨架、叙事节奏、情绪钩子、人物张力与语言技法，通过 `quote_check.py` 校验原著引文真实性。
- **技法卡管理与防抄袭红线**：每张技法卡结构化保存核心机制、三步做法、重造条件、失效边界与防抄袭红线；支持在技法仓库中交互编辑、实时预览 Markdown 结构并一键绑定至当前长篇作品（`fanqie.reference.bind`）。

### 3.2 全书规划与提案隔离（`fanqie.book`）
- 按 `card`（立项卡，挂载 `genres.md` 六大题材节奏基准）→ `foundation`（故事根基与世界观）→ `structure`（卷纲/幕纲，锚定签约与推荐节点）→ `outline`（前序章纲与大纲校验）顺序推进。
- 规划产出隔离存放在 `plan/proposals/<runId>/`，不覆盖现有 `plan/`；仅在作者确认采纳后经 `commitIntent` 原子晋升至正式规划与初始设定集。

### 3.3 章节写作、半章续写与专项精修（`fanqie.chapter` / `fanqie.revise`）
- **章节写作流水线**：
  1. `prepare`：校验 `work.json`、读取前章正文（或指定 `previousCandidateId` 衍生分支）、卷结构、绑定技法卡与 `bible/`，组装预算受控的 L0–L6 `ContextPacket`。启用 `continueFromExisting` 时，完整锁定已写前缀并提取末 500 字续写锚点。
  2. `beats` → `draft × N`：按档位（经济 1 / 标准 2、黄金章 5 / 精品 3、黄金章 8）并行起稿。
  3. `gate`：代码硬闸检查字数区间、占位符与禁用标记；半章续写经 `verifyLockedPrefix` 严格校验已写前缀逐字未篡改。
  4. `select`：对过闸候选并行逐稿评分，前二名并行 AB / BA 换位盲评以消除位置偏置。
  5. `continuity-check` → `review` / `revise`（≤ 2 轮）：引文容错定位；修稿若未过硬闸或破坏锁定前缀，自动回退至上一合规稿并记录审读说明。
  6. `deliver`：幂等写入 `candidates/<chapterId>/<runId>.md`、`.meta.json`（含真实 `derivedFrom` 来源状态与 `sourceHash`）与 `.marker.json`，交由作者在中栏决策卡与并排双稿纸裁决。
- **专项精修（`fanqie.revise`）**：
  - 支持完整审改（`revise`）、专项去 AI 腔（`deai`）与轻润色（`polish`）。
  - `deai` / `polish` 无需手填问题清单即可单轮输出候选稿（不直接改正文），同时明确标记 `editorPass: false`、`reviewPerformed: false`，避免绕过完整审读误晋升为 `reviewed`。
- **多分支谱系与乐观锁**：
  - `acceptCandidate` 经 `commitIntent` 原子落盘，同步更新匹配下游候选的 `derivedFrom`，并基于 `sourceHash` 失配与同章竞争分支检测返回 `staleDownstreamCandidates` 提醒列表（只告警不静默删改草稿）。
  - `fanqie.chapter.finalize` 支持可选 `base` 乐观锁防并发覆盖。

### 3.4 分层上下文组装器（L0–L6）
- `L0`（必选）：本章细纲、个人文风规则与作者附言；
- `L1`：前章摘要、章末交接与前文正文（标准/精品 ≤ 4,000 字，经济末尾 1,500 字 + 交接）；
- `L2`：在场/全局实体与绑定技法提示；
- `L3`：角色知情边界与未回收伏笔硬约束；
- `L4`：近 10 章摘要；
- `L5 / L6`：基于 SHA-256 内容键 2-gram LRU 缓存的 BM25 远期检索与绑定技法卡全文（标注“参考机制，不复制”）。
- 预算紧张时通过 `fitItemsByBudget` 逐项保留核心实体、最新近章与可容纳技法卡，在 `omitted[]` 精准留痕并通过 `onIncludedCards` 回传实际注入卡 ID。

### 3.5 设定集、跨书回查、存稿 KPI 与旧书接管
- **设定集（`bible/`）**：`read()` 基于文件 mtime/size 签名缓存；`asOf(position)` 按 `since`/`until`、`payBeat` 节点与来源章号精确切片，屏蔽未来章节事实；`audit(upTo)` 通过实体索引表与二分查找识别遗忘伏笔、超期未兑现、知情越界与状态冲突。
- **跨书时间线回查（`traceEntityTimeline`）**：按实体名或任意别名自动展开，按“全局优先 + 章节升序”串联实体档案、章节摘要、状态变化、知情边界、伏笔与受 `maxBodyHits` 限流的正文摘录；同步暴露为只读助手工具 `fanqie_trace_entity` 与设定集中心页签。
- **定稿记账与体检（`fanqie.ledger` / `fanqie.health`）**：从章节号（如 `C100`）解析真实章序 `position`，生成的新事实附带三分类沉淀标记（`resolve_short_term` 封口旧状态、`settle_long_term` 确认长期事实、`update_profile` 合并别名与锁定项）进入待确认队列，由作者逐条裁决。
- **连载存稿 KPI（`computeSerialBuffer`）**：自 `publishedThrough` 起计算连续可发定稿章数、连续存稿字数、按 `dailyTargetChars` 折算可撑天数，并识别断档或跳号缺失后的孤立定稿。
- **旧书零模型接管（`previewLegacyWork` / `importLegacyWork`）**：支持单 TXT 智能切章（区分卷标/章标、零丢弃保留楔子）与多文件目录自然序导入，内置 UTF-8 / UTF-8 BOM / GB18030 解码、无损原字节备份（`sources/legacy-import/`）与 `import-manifest.json` 审计清单，默认导入为 `drafted` 状态。
- **个人文风学习（`learning/diff.ts`）**：作者手工改稿保存后自动计算段落级 diff，重复达到阈值后提出规则建议，经作者确认晋升至 `bible/style.json`。

## 4. 今日头条图文内核

- **TypeScript 规则引擎**（`packages/toutiao/src/rules/`）：
  - `limits()` 从 TypeScript 常量提供字数限制、质检及格线与结构化 `styles`；
  - `checkCard()`、`qa()` 与 `ledger*()` 在应用内完成立项卡校验、质检和台账操作。
- **文章流水线（`toutiao.article`）**：
  1. 来源登记（本地文本或公开网页正文提取）→ 组装预算受控的 `sourcePacket` / `cardPacket`；
  2. 立项卡（经 `checkCard` 门禁）→ 标题矩阵（≥ 5 条、每条 ≤ 34 字、覆盖 ≥ 3 个母体）→ 蓝图（同赛道开头式/结尾式自动轮换）；
  3. 按赛道（资讯线/故事线 × 长图文/短图文/微头条）`when` 条件动态路由起稿与多路择优；
  4. **原文逐字证据核验**（`domain/claims.ts` + `rules.ts`）：代码抽词对照来源全文核验引文，模型虚构引用降级为 `unlocated`；增量复核同时校验段落文本与来源内容哈希，来源改动即刻失效重验；
  5. TypeScript 规则质检，未过 84 分或触发硬闸则定向精修（≤ 2 轮）。
- **验收修订锁与交稿单**：
  - 晋升「已验收」时记录草稿内容哈希 `acceptedRevision`；若验收后修改草稿，状态自动回退为「初稿待改」并清空 `acceptedRevision`，防止未重验内容被直接交稿；
  - `transition` 禁止绕过交稿单直接切至「已交稿」，必须走 `toutiao.article.deliver` 原子落盘带固定末句的 `delivery.md`、同步 `ledger.csv` 并记录 `deliveredRevision`；进入「已交稿」后草稿锁定只读。

## 5. 内置资产维护

- 上游方法与脚本元数据登记在 `assets/sources.json`，文件校验清单位于 `assets/manifest.json`。
- 修改 `packages/fanqie/profiles/default/`、`packages/toutiao/profiles/default/` 或 `skill/` 后，须运行：
  1. `npm run assets -- manifest` 刷新校验哈希；
  2. `npm run assets -- check` 验证磁盘文件哈希、版本登记与全部 `stage-map.json` 引用完整性。
