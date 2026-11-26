# 写作内核与业务规则（v2.3）

## 1. 受保护的业务规则（核心红线）

以下业务规则是织章的质量底线，未经作者明确书面授权严禁更改，并在代码中严格遵守“单一真源”原则：

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

- 织章采用**确定性原文直取**取代不可控的模型摘要：各模式在 `profiles/default/` 维护方法 Markdown 与 `stage-map.json`（声明各阶段读取的文件、章节标题、`maxChars` 与可选 `when` 路由条件）。
- 运行时由 `@zhizhang/core/methods` 的 `methodFor(profile, stage, vars)` 拼接方法原文、计算 SHA-256 哈希并记录裁剪明细 `omitted[]`，写入 `RunRecord` 以便审计与复现。
- 作者可在应用状态目录 `profiles/<mode>/<id>/` 定制方法方案，覆盖内置默认方案而不改动安装包。

## 3. 番茄长篇全链路（三大上游方法论与 v2.3 深化）

番茄长篇内核完整贯通「**拆书提炼 → 灵感装填与全书规划 → 分层上下文正文创作、精修与旧书接管**」全闭环：

### 3.1 拆书与技法仓库（对齐 `inspiration-forge-library` v1.3.0）
- **测绘与分层抽样**（`packages/fanqie/src/pipelines/dissect/{sampling,schemas,index}.ts`）：调用上游 `novel_scanner.py` / 分层采样策略抽取开篇黄金章、中段高潮与收束样本，避免全书盲读。
- **逐字引文核验与五层拆解**：拆解卖点骨架、叙事节奏、情绪钩子、人物张力与语言技法，通过 `quote_check.py` 核对原著引文定位，杜绝幻觉编造。
- **技法卡存储与防抄袭红线**（`commands/library.ts` + 前端 `TechniqueWarehouse` / `TechniqueEditor`）：
  - 每张技法卡明确拆分为「核心机制 / 三步做法 / 重造条件 / 失效边界 / 防抄袭红线」与结构化字段；
  - 技法仓库提供交互式编辑器与 Markdown 逻辑结构实时预览，作者可直接增删改技法卡并一键绑定至当前长篇作品（`fanqie.reference.bind`）。

### 3.2 灵感装填与全书规划（对齐 `inspiration-forge` v1.3.0）
- **全书规划流水线**（`packages/fanqie/src/pipelines/book/{schemas,stages,apply,index}.ts`）：按 `card`（立项卡）→ `foundation`（故事根基与世界观）→ `structure`（卷纲与幕纲，锚定前 2 万签约线与前 8 万推荐线）→ `outline`（前序章纲与大纲校验）顺序推进；默认方法论内置 `genres.md` 六大热门题材节奏基准表。
- **提案隔离与原子晋升**：运行产出落盘于 `plan/proposals/<runId>/`，不覆盖作者现有 `plan/`；仅在作者确认采纳后经 `applyBookPlan` 备份旧规划并以 `commitIntent` 原子写入正式规划与初始设定集。

### 3.3 章节写作、半章续写、专项精修与多分支谱系（对齐 `novel-writer` v1.3.0 + v2.3）
- **章节写作流水线**（`packages/fanqie/src/pipelines/chapter/`）：
  1. `prepare`：读取 `work.json`（损坏即报错）、前章正文（或指定 `previousCandidateId` 候选分支）、卷结构、已绑定技法卡与 `bible/`，组装预算受控的 `ContextPacket`。启用 `continueFromExisting` 时，保存完整规范化已写前缀并提取末 500 字锚点。
  2. `beats` → `draft × N`：按档位（经济 1 / 标准 2、黄金章 5 / 精品 3、黄金章 8）并行起稿。
  3. `gate`：代码硬闸检查篇幅区间、占位符与禁用标记；半章续写模式下经 `verifyLockedPrefix` 强制校验已写前缀逐字未篡改。
  4. `select`：对通过硬闸的候选**并行逐稿评分**，再对前二名**并行换位比较**（AB / BA 消除位置偏置）。
  5. `continuity-check` → `review` / `revise`（≤2 轮）：引文容错定位；若某轮修稿未通过硬闸或破坏半章锁定前缀，自动回退保留上一版合规候选并将门禁问题记入审读摘要。
  6. `deliver`：幂等写入 `candidates/<chapterId>/<runId>.md`、`.meta.json`（含真实 `derivedFrom` 来源状态与 `sourceHash`）与 `.marker.json`，交由作者在中栏决策卡与并排双稿纸中裁决。
- **专项去 AI 腔 / 轻润色**（`packages/fanqie/src/pipelines/revise/`）：
  - 支持 `mode: "revise" | "deai" | "polish"`；`deai`/`polish` 无需手填 `issues` 即可单轮精修并过硬闸，产物仍落入候选稿（绝不直改正文）。
  - 专项模式严格记录 `editorPass: false`、`reviewPerformed: false`，避免绕过完整审读误晋升章节为 `reviewed`（如需定稿须补跑审读或显式跳过门禁）。
- **多分支谱系与乐观锁**（`commands/candidate.ts`、`commands/chapter.ts`）：
  - `acceptCandidate` 经 `commitIntent` 原子写入正文、更新匹配下游候选的 `derivedFrom`，并基于 `sourceHash` 失配与同章竞争分支识别返回 `staleDownstreamCandidates`（仅告警不删改）。
  - `fanqie.chapter.save` 仅刷新单章行不触发全书扫描；`fanqie.chapter.finalize` 支持可选 `base` 乐观锁防并发覆盖。
- **设定集 `bible/`、时间线回查与三分类沉淀**（`bible/{schemas,audit,store,trace}.ts`）：
  - `read()` 按文件 mtime/size 签名缓存；多文件更新经 `commitIntent` 原子提交并刷新 `index.json` 哈希。
  - `asOf(position)` 按 `since`/`until`、`payBeat` 付费节点及记账来源章号精确切片，屏蔽未来章节事实；`audit(upTo)` 通过实体索引表与二分查找线性识别遗忘伏笔、到期未兑现、知情越界与状态冲突。
  - `traceEntityTimeline` 按别名展开跨全书串联实体档案、状态变化、知情边界、伏笔与受 `maxBodyHits` 限流的正文摘录。
  - 定稿记账（`fanqie.ledger`，从章号如 `C100` 解析真实 `position`）与每十章体检（`fanqie.health`）产生的新事实附带三分类 `settlement`（`resolve_short_term` / `settle_long_term` / `update_profile`）进入 `bible/pending.json`，由作者在「设定集中心」逐条裁决。
- **分层上下文组装器 L0–L6**（`context/{builder,format,retrieval}.ts`）：
  - `L0`（必选）：本章章纲、个人文风规则与作者附言；`L1`：前章摘要、章末交接与前文正文（标准/精品 ≤4,000 字，经济末尾 1,500 字 + 交接）；`L2`：在场/全局实体与绑定技法提示；`L3`：知情边界与未回收伏笔硬约束；`L4`：近 10 章摘要；`L5 / L6`：基于 SHA-256 内容键 2-gram LRU 缓存的 BM25 远期检索与绑定技法卡全文（标注“参考机制，不复制”）。
  - `context/format.ts` 提供 `fitItemsByBudget` 逐项预算裁剪与 `onIncludedCards` 回调，在预算紧张时保留能放下的核心实体、近章与技法卡并在 `omitted[]` 精准留痕。
- **连载存稿 KPI 与旧书零模型接管**（`view/snapshot.ts`、`commands/{import,import-parse}.ts`）：
  - `computeSerialBuffer` 统计自 `publishedThrough` 起的连续可发定稿章数、字数、按 `dailyTargetChars` 折算可撑天数，并检测章号跳跃缺口与孤立定稿。
  - `previewLegacyWork` / `importLegacyWork` 支持单 TXT 智能切章（区分卷标与章标、零丢弃保留序言）与多文件目录自然序导入，内置 UTF-8 + GB18030 回退解码、无损原字节备份（`sources/legacy-import/`）与 `import-manifest.json` 审计清单，默认导入为 `drafted` 状态。
- **个人文风学习**（`learning/diff.ts`）：作者手工改稿保存后自动计算段落级 diff，同模式累计达阈值形成规则建议，经作者确认后晋升至 `bible/style.json`。

## 4. 今日头条图文内核（对齐 `toutiao-viral-writer` v4.0.0 + v2.3 加固）

- **单真源规则桥**（`packages/toutiao/src/rules/bridge.ts` + `skill/scripts/writer_bridge.py`）：
  - `limits()` 读取 `rules.py` 的字数限制、质检及格线与结构化 `styles`，并按 `rules.py` mtime 缓存；
  - `checkCard()` 直接调用 `writer_bridge.py check-card --card <path>`；`qa()` 与 `ledger*()` 均经 `runPythonJson` 强制 Schema 校验。
- **双线七步文章流水线与原文逐字核验**（`toutiao.article`、`domain/claims.ts`）：
  1. 来源登记（只读作者给定文本或公开网页正文提取，绝不篡改原意）→ 构建预算受控的 `sourcePacket` / `cardPacket`；
  2. 立项卡（经 `checkCard` 门禁校验）→ 标题矩阵（≥5 条、每条 ≤34 字、覆盖 ≥3 个母体）→ 蓝图（同赛道开头式/结尾式自动轮换）；
  3. 按赛道（资讯线/故事线 × 长图文/短图文/微头条）`when` 条件动态路由起稿 → 代码抽词与**原文逐字证据核验**（`mergeFactResults` 对照已登记来源全文校验引文，模型虚构引用降级为 `unlocated`）；增量复核 `filterChangedParagraphClaims` 同时校验段落文本与对应来源内容哈希，来源变更即刻失效重验；
  4. Python 质检（临时文件隔离在 `articleDir/.tmp/`，用后 `finally` 清理），未过 84 分或有硬闸则定向精修（≤2 轮）并做防刷分同质化提示；
  5. **验收修订绑定与交稿锁定**（`storage/articles.ts`、`commands/article.ts`）：
     - 晋升 `已验收` 时记录 `acceptedRevision`（当前草稿 SHA-256）；若验收后手工修改草稿，状态自动回退为 `初稿待改` 并清空 `acceptedRevision`，防止未重验内容被直接交稿；
     - `transition` 禁止直接将状态改为 `已交稿`（必须走 `deliver` 原子落盘带固定末句的 `delivery.md` 与 `ledger.csv` 并记录 `deliveredRevision`）；
     - 文章进入 `已交稿` 终态后，服务端与前端同步锁定草稿编辑。

## 5. 内置资产维护

- 内置方法与规则上游登记在 [assets/sources.json](assets/sources.json)，校验清单位于 [assets/manifest.json](assets/manifest.json)。
- 修改 `packages/fanqie/profiles/default/`、`packages/toutiao/profiles/default/` 或 `skill/` 后，须运行：
  1. `npm run assets -- manifest` 重建校验清单；
  2. `npm run assets -- check` 验证磁盘文件哈希、上游版本号及全部 `stage-map.json` 引用完整性。
