# 织章 Zhizhang v2.3.0 — 全量优化报告（二次源码校准版）

> 2026-11-25｜替代上一版《项目深度评估与全量优化报告》作为执行依据。  
> 审计基线：`master` / [`129014ed295120d1f7fcff6c69719c273cc81be5`](https://github.com/ouzx6696-cmyk/dsh-zhizhang/commit/129014ed295120d1f7fcff6c69719c273cc81be5)。  
> 核心原则：修真实问题、复用现有能力、保持作者裁决；不做无价值重构，不扩大测试规模，不追逐工程指标。

## 0. 审计范围与证据说明

本轮重新查询 GitHub 主分支，确认仍为 v2.3.0 的上述提交，提交时间 2026-11-25 12:00:27 UTC。递归 Git 树完整返回（未截断），共有 659 个文件、307 个 `.ts/.tsx` 文件（含配置与测试辅助文件）。该统计不等于生产代码文件数或复杂度测量。

审查方法：读取原 MD 全文结构及 40 项任务表，重新读取仓库核心源码、UI 请求路径、命令契约、业务规则和调度实现，结合上一轮获取的同提交源码及远端 CI 日志核对。重点覆盖番茄、头条、Core、Workbench、Desktop、Agent、存储与交付。所有下文源码链接固定到审计提交，避免后续 master 漂移。

**证据等级**：

- A：远端 CI 直接证据，或从源码可确定的逻辑行为；其中 R1–R5 另经隔离 Node.js 样例复现。
- B：源码显示存在风险窗口或不完整的路径，需要用现有项目实际运行或人工验证，不等于已发生事故。
- C：产品假设或体验建议；没有足够证据表明必须修改。
- 已有：真实源码已经实现，不应重复建设。

**限制**：通过已连接 GitHub 接口读取源文件，容器不能解析 github.com，无法直接 clone、安装依赖、构建应用或运行仓库测试。隔离样例运行于 Node v22.16.0，手工转录仓库函数相关逻辑，非完整项目依赖链测试。未调用真实付费模型、未查看实际作者使用数据、未做性能压测、未修改仓库或发布流程。不是逐行覆盖 659 文件的全仓安全审计。对于未确认的问题，明确标记为待验证，而不直接列为缺陷。

## 1. 校准后的总体判断

织章的真实优势不在工程规模，而在四条写作业务链、结构化作品资产、角色工具权限和作者决定权。架构已有足够基础：Electron/React、Web 预览共享运行时、Core 机制层、Fanqie/Toutiao 业务隔离、Workbench 命令契约、PI 会话、Python 规则源及本地 Markdown/JSON。**不建议重构架构或另起平台。**

上一版的 81/100、90+ 目标、55/20/15/10 资源比例及 19–35 人日估算没有实际用户、质量、性能、团队产能数据支撑。此次撤回，不把主观打分当事实，不预定四个发布版本。现阶段更准确的评价：

| 维度 | 实际证据 | 校准评价 |
| --- | --- | --- |
| 产品定位 | README、业务模块、作者裁决界面 | 清晰，保留 |
| 架构与工程 | 包边界、共享 Runtime、写锁、意图日志、资产守卫 | 基础充分，不扩张 |
| 长篇与头条业务 | 实际流水线、上下文、候选稿、质检和台账 | 功能丰富；若干状态/证据一致性缺陷需修 |
| 实际写作质量 | STATUS 记载真实模型 RM01/RM02 待批准 | 未验证，不能给质量分数 |
| 交付 | 同提交 CI 静态检查、两平台测试通过，E2E 失败、package 跳过 | 有具体阻塞，不能宣称可正式交付 |
| 长篇规模与体验 | 读取、缓存、搜索、UI 请求代码 | 存在可定位风险；真实性能、易用性待测 |

**本轮尤其重要的新判断**：已有能力不等于完整闭环。v2.3 的半章续写、专项精修、候选谱系、存稿 KPI 和旧书导入都有真实实现，但关键条件或宿主交接仍有缺口。与其继续做新功能，应先把这些已经存在的能力做实。

## 2. 已有能力盘点：禁止重复建设

| 能力 | 真实实现 | 本轮判断 |
| --- | --- | --- |
| 三档起稿、黄金章节策略 | [chapter/rules.ts#L21-L28](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/pipelines/chapter/rules.ts#L21-L28)：经济 1；标准普通 2/黄金 5；精品普通 3/黄金 8 | 不新增三套流水线；检查现有配置能否从 UI 触达 |
| 前文截取策略 | 同文件 `resolvePreviousTextMode`：auto/full/tail、按档位选择 | 保留 |
| 写作任务单 | [BriefDrawer.tsx](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/apps/desktop/src/renderer/features/agent/BriefDrawer.tsx)、`WritingBriefSchema`、L0 注入 | 已有；仅确认自动提炼是否有真实需求 |
| 去 AI 腔/轻润色 | [revise/index.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/pipelines/revise/index.ts) 专项指令、单轮处理 | 不新增模式；修复审读语义和原文保护 |
| 半章续写 | `prepareChapterContext`、`stitchContinuation`、UI 勾选 | 已有；实现未真正锁定全文前缀 |
| 作者逐处采纳 | [DraftCompare.tsx](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/apps/desktop/src/renderer/features/workflow/DraftCompare.tsx)、CompareSheets、compare-diff、撤回快照 | 保留现有实现，不建新编辑器 |
| 多路评分和换位比较 | chapter/index、stages，评分含 strengths/weaknesses，比较含 reason | 先复用已有记录，不新增评分平台 |
| 设定集追踪 | bible/trace、历史视图、三分类沉淀 | 已有；修正历史语义，注意实际为单 workPath 内查询，不擅自扩张跨作品搜索 |
| 连载存稿 | computeSerialBuffer、StudioDashboard | 已有；修缺章逻辑 |
| 文件式草稿后端 | [editor/drafts.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/workbench/src/editor/drafts.ts) 已定义文件读写接口；useDraftStash 当前调用 localStorage 路径 | 复用后端，不再写一套 |
| 拆书抽样和引文审计 | dissect/index、sampling、报告与卡片 | 已有；不要为此增加知识图谱 |
| 规划提案隔离 | book/apply 的 proposals、作者采纳、意图日志 | 保留 |
| Agent 调用轮数/取消 | turn-runner `MAX_TOOL_ROUNDS=12`，signal 传播、Gateway watchdog | 已有轮数限制；只补必要预算语义 |
| 头条事实增量复核 | article/rules `filterChangedParagraphClaims` | 已有；应核验证据真实性及来源版本 |
| 学习记录 | chapter.save 后 recordChapterEditLearning、learning 模块 | 已有记录基础；风格反馈需要作者实测需求，不直接自动改 Profile |

## 3. 交付事实与最小修复

### F01 — Electron 首启 E2E 失败（A / P0 交付阻塞）

[实际 CI 运行](https://github.com/ouzx6696-cmyk/dsh-zhizhang/actions/runs/45609655127) · [E2E 日志](https://github.com/ouzx6696-cmyk/dsh-zhizhang/actions/runs/45609655127/job/139190286948) · [index.html#L16-L21](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/apps/desktop/index.html#L16-L21)

同提交 CI：check、assets check、Web build、Ubuntu/Windows test 均通过；首个 Electron E2E 失败，后四个串行用例未运行，package 跳过。日志中的直接原因是 Google Fonts stylesheet 违反 `style-src 'self' 'unsafe-inline'`；失败断言发生在 `test/desktop/ui.spec.mjs:73` 的控制台错误检查，并非已证明首启业务流程本身不能完成。

修复：删除 index.html 中远程字体 stylesheet 及相关 preconnect，复用已有本地资源/系统回退。不要放宽 CSP，不要屏蔽错误。使用现有 E2E 与 package 任务完成闭环，不新增测试框架。`docs/STATUS.md` 更新为真实 CI 状态。由于其他四个用例未执行，不能保证修字体后全绿。

## 4. 优先修复：作者资产与状态正确性

### F02 — 半章续写的“锁定前缀”实际只是提示（A / P0 作者原文风险，R1）

[prepare.ts#L30-L45](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/pipelines/chapter/prepare.ts#L30-L45) · [chapter/index.ts#L84-L94](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/pipelines/chapter/index.ts#L84-L94) · [修稿循环#L180-L208](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/pipelines/chapter/index.ts#L180-L208)

源码以原稿前 80 字作为探针：只要模型输出以探针开头，直接返回模型全文；不要求其余原稿完全相同。首次拼接后，审改阶段又允许输出整章，没有再次校验锁定前缀。作者必须显式采纳才会写入，因此不是 AI 静默覆盖磁盘；但候选稿违反了「完整前缀已锁定不可改动」的承诺，采纳时可能误改原文。

最小修复：生成续写部分或严格验证完整前缀；每轮审改后重新验证，失败保留上一版，避免重复前缀。保留原章标题的默认语义，允许作者另行改题。原稿修订变化时提醒重新生成或对照采纳。验收：80 字相同而后半前缀被改不得通过；审改后仍保留原稿，不扩展选区续写等新功能。

### F03 — 专项润色把基础门禁通过标成编辑通过（A / P1，若开启严格审读则升级 P0）

[revise/index.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/pipelines/revise/index.ts) 的 `specialist` 分支只进行篇幅/占位符等 gateDraft 检查，直接设 `editorPass=true`、`review.verdict=pass`、跳过 makeReviewStage。候选采纳读取元数据并将正文标为 reviewed，`assertCanFinalize` 对 requireEditorPass 的严格门禁依赖 editorPass。

这不只是上一版所说的“去 AI 腔修改范围需加强”，而是审读语义不真实：轻润色成功不等同于编辑通过。修复应优先让标签与实际检查一致；没有真正审读就标为专项完成/待审，不伪造通过。若业务需要严格模式复审，复用已有 reviewStage，且不得超两轮红线；不默认增加所有润色任务的模型调用。作者可以继续按原有权限裁决。验收：严格审读模式无法凭未审读的专项稿冒充通过。

### F04 — 候选来源类型失真、缺版本和下游传播（A+B / P1；覆盖作者资产时优先）

[chapter/prepare.ts#L84-L100](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/pipelines/chapter/prepare.ts#L84-L100) · [schemas.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/pipelines/chapter/schemas.ts) · [candidate.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/commands/candidate.ts)

已确认：普通上一章正文不论状态都记为 `kind:final`；采纳候选后正文是 drafted/reviewed，却把同源下游候选的来源提升为 final。谱系只有 chapterId/candidateId，无源内容版本。reconcile 扫描直接依赖，其他分支的过时信息由返回值提供，没有在该函数持久化。后续正文编辑也不能仅凭这两个 ID 识别变化。

额外宿主证据：[WorkflowStartForm.tsx#L67-L89](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/apps/desktop/src/renderer/features/workflow/WorkflowStartForm.tsx#L67-L89) 的常规起稿请求不携带 `previousCandidateId`，也不带 `golden`；[decide.ts#L15-L30](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/apps/desktop/src/renderer/features/workflow/decide.ts#L15-L30) 调用 accept 后未消费其 staleDownstreamCandidates 返回值。不能由此断言整个 UI 完全无其他入口，但该常规路径没有真正用到这两项能力。

建议把原任务 03、04、09 合并，采用一个最小来源记录：真实来源种类 + chapterId + 可选 candidateId + 源内容 hash/revision。旧来源无法确定时显示未知/待核对，不自动迁移或重跑全书。发现上游变化时提示受影响候选，必要时沿既有引用传递；优先采用读取时推导或简单持久化，二选一，不建 DAG 框架。前端仅补一个确有必要的前章来源选择/过时提醒，不新建谱系管理中心。确认现有磁盘格式变更授权后再落盘。

### F05 — 旧书导入有内容与结构损失（A / P0）

[commands/import.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/commands/import.ts) · [commands-fanqie.ts#L140-L160](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/apps/desktop/src/main/commands-fanqie.ts#L140-L160) · [NewTargetDialog.tsx](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/apps/desktop/src/renderer/features/create/NewTargetDialog.tsx)

已确认：短于 200 字符的章前文本不进入拆章结果；空章节过滤；标题正则匹配章/节/回/卷/部，可能误拆；按顺序生成新 ID，不保留原号映射；原文件备份存解码后文本而非原字节；核心默认 final，常规宿主未传 chapterStatus，导入弹窗没有该选择。需区分：原来源文件没有被删除，备份文本也可能保留序言，因此不是原始文件已丢失，而是导入后作者工作稿可能遗漏内容。

另一个真实体验障碍：UI 当前使用 sourcePath 文本输入，主进程调用 `ctx.inside(input.sourcePath)` 限定在工作区内。直接输入工作区外旧书路径会被拒绝。这是现有安全边界，不应通过解除路径约束解决；应使用宿主选择文件/文件夹或明确提示先复制到允许目录，保留用户选取范围。

修复只需一个轻量确认流程：显示编码、拆章结果、未归类内容、原章号/卷号映射、作者明确选择状态（已完成作品可选 final，未完成选 drafted）。无法判断的内容保持，不丢弃。保存原始字节副本与源文件名；不要自动调用模型。导入前后检查章节正文及未归类内容可追溯，原文件保持不动。先不扩展复杂格式支持、OCR 或批量 AI 建设设定集。

### F06 — 意图日志提交与恢复边界不完整（A+B / P0 数据保护）

[core/journal/intent.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/core/src/journal/intent.ts) · [replay.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/core/src/journal/replay.ts) · [storage-health.ts#L76-L96](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/apps/desktop/src/main/services/storage-health.ts#L76-L96)

提交有锁、原子写与日志，但 `commitIntent` 不校验 beforeHash；恢复虽比较 before/after hash，却在 replay 中直接使用日志路径，且调用端未获取相同资源写锁。风险：日志损坏、工作区外部同步/编辑或并行写入条件下，恢复可能覆盖不应覆盖的目标。不是证明有远程攻击，也不是证明正常写入一定丢数据。

最小修复：现有锁内提交前统一校验；恢复传递明确资源根和锁，路径重新做沙箱校验、冲突则保留日志；读文件仅将 ENOENT 视为缺失，其余错误向上报告。注意合法跨资源联动须由明确允许根约束，不能机械限制导致头条台账无法处理。绝不自动覆盖冲突文件，不另建数据库或事务框架。

### F07 — 头条草稿修改后验收可能仍然有效；直接状态流转可绕开交稿（A+B / P0 核心业务）

[article.ts#L239-L276](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/toutiao/src/commands/article.ts#L239-L276) · [status.ts#L7-L13](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/toutiao/src/domain/status.ts#L7-L13) · [storage/articles.ts#L95-L111](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/toutiao/src/storage/articles.ts#L95-L111) · [commands-toutiao.ts#L25-L43](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/apps/desktop/src/main/commands-toutiao.ts#L25-L43)

saveDraftCommand 创建新 rev 文件，未更新文章验收状态/绑定验收版本。通用 transition 命令按状态转换表允许 `已验收 -> 已交稿`，而真正 deliver 命令才生成交稿单、更新台账。UI 的 nextStatuses 主动过滤已交稿并使用专门按钮，这是正确保护，但后端命令语义仍有不一致风险。此外 deliver 接收 title/body，未将验收与当前草稿版本绑定。

建议：验收、质检与交稿明确对应 draft revision/hash；编辑后旧验收失效，如何使用现有状态词表退回由维护者决定，不私改受保护状态表；普通 transition 拒绝直接交稿，统一走已有 deliver 入口；交稿使用确认的版本并处理冲突，已交稿内容的后续编辑需要明确语义。不得擅自将模型分数变成作者权限限制。验收用例：旧验收后编辑、过期交稿、直接状态变更均不会产生无交稿单的“已交稿”。

### F08 — 头条台账与交稿单中断窗口（B / P1）

[article.ts#L96-L150](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/toutiao/src/commands/article.ts#L96-L150)：先 Python ledgerAdd/ledgerStatus，再 writeDeliverySheet；后者已有意图日志用于交稿单及 meta。故障可能造成 ledger 已交稿、文章仍未交稿，已有重复处理可缓解。先人工复现中断和重试，检查 Python 台账并发锁与幂等。确认有实际不一致再复用已有日志记录跨资源待补齐操作；不要强行重写 Python 规则或整个 CSV 体系。

### F09 — 候选采纳多个文件非同一意图；过期确认（B / P1）

[candidate.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/commands/candidate.ts) 在 work 锁下写 history、正文、accepted 标记、谱系元数据。单文件原子写不等于整组一致，异常中断可使 UI 状态与正文不符。正文保存使用 `rev-${sha256(body).slice(0,8)}`，标题/元信息改变而正文不变时 revision 不变；宿主 save 对空 base 用 truthy 分支，finalize 命令没有传 expectedRevision，尽管核心支持。见 [chapter.ts#L76-L108](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/commands/chapter.ts#L76-L108)、[commands-fanqie.ts#L51-L106](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/apps/desktop/src/main/commands-fanqie.ts#L51-L106)。

先验证从空正文开始、对照期间外部编辑、采纳失败重试、定稿确认期间正文变化。复用现有冲突检查及意图日志，避免重复采纳/覆盖。标题是否纳入版本口径需要明确，并避免无授权改变现有格式。

## 5. 长篇内核、上下文与 AI 质量

### F10 — 连续存稿统计忽略数字缺章（A / P1，R2）

[view/snapshot.ts#L33-L85](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/view/snapshot.ts#L33-L85)：遍历排序后的已存在章节，只在状态非 final 时触发 gapHit，未比较相邻 position。C001/C003 都 final 而 C002 不存在，结果为连续 2 章、6000 字、2 天（每日 3000），过时/缺口列表为空。先确定章节 position 是否规定连续；若是，缺章即中断；若允许有意跳号/分卷特殊编号，以计划结构或明确顺序为准。不要机械将所有不连续 ID 判为缺章。

### F11 — BM25 缓存键碰撞（A / P1，R3）

[context/retrieval.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/context/retrieval.ts)：key 用 chapter/position/summary length/body length/摘要前32字，不包含实际正文。相同长度不同内容会复用分词。不同作品或同一章同长度编辑均可能触发（仅当检索文档包含 body 或摘要发生同长度变化）。改为摘要和正文内容哈希，继续使用现有 512 项缓存，不引入向量数据库。

### F12 — 历史设定不是严格 as-of（A / P1，R4）

[bible/store.ts#L138-L147](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/bible/store.ts#L138-L147) 返回全部 entities、按 since/until 筛 states、按当前 status=open 筛 threads、按 since 筛 knowledge。第100章埋伏笔、第200章兑现，回到150章看不到此伏笔。实体也没有按 provenance.chapter 过滤，历史修稿可能得到未来实体；knowledge.set 同 ID 覆盖、entity.upsert 覆盖，无法保证所有历史字段可重建。

先修伏笔，使用既有 plant/push/pay beats 计算目标章节有效状态，并注意 dropped 未必有可追溯关闭时间；缺失历史证据的状态展示不确定，不伪造。再结合既有 provenance 过滤明确属于未来的实体，但保留作者预先规划实体这一业务需求。不要建设事件溯源平台，也不要承诺恢复已经被覆盖的历史数据。

### F13 — 章节台账 position 可能错位，摘要记录需核实（B / P1）

[ledger/index.ts#L202-L213](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/pipelines/ledger/index.ts#L202-L213)：`position = req.position ?? existing?.position ?? bible.chapters.length + 1`，常规 WorkflowStartForm 默认只传 chapterId。若第一次对 C100 执行沉淀、且 bible.chapters 为空，推导 position 可能是 1；它不读取章节列表中的实际 position。这一分支可从源码直接推导，但需结合作品结构、人工台账操作验证。核实 ledger 是否建立/更新 chapter.record（已看到 deltaToBibleOp 生成 entity/state/thread/knowledge，尚未证明其他链路不存在摘要写入）。优先用现有章节位置解析、版本和交接记录，避免台账、检索、回溯各用不同口径。

### F14 — 前章候选分支与正式摘要混用（B / P1）

[prepare.ts#L72-L101](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/pipelines/chapter/prepare.ts#L72-L101)：prevRecord 来自 Bible 最近记录，previous 来自章节列表。指定 previousCandidateId 时正文来自候选，但 previousSummary/handoff 仍取正式记录。两者可能不属于同一剧情版本，候选尚未采纳时尤其明显。复用来源记录（F04），只注入一致版本摘要/交接；没有候选摘要就明确没有，而不是混用不同分支。

### F15 — 上下文装配按块裁剪和实际方法注入预算（A+B / P1）

[context/builder.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/context/builder.ts) 的 L2 实体逐项纳入，L4/L5/L6 等部分整块纳入/舍弃；必需块可能已超预算。runner 在渲染 ContextPacket 后附加 profile 方法、stage 输入、输出 shape，Gateway 对整个 system/user 再估算。说明实际已有最终输入预算检查，不能说“完全无预算保护”。但 context budget 不能全部耗尽才附加大量阶段输入，可能造成执行时超限；续写锚点又在 builder 后追加。

建议先为实际阶段提示词留余量，以相关性逐条选择可选信息，必要内容超限直接告知作者，保持 L0–L6 与现有 required/omitted。appliedCardIds 当前在 prepare 返回所有 referenceCards 的 id，而某些卡可能被 builder 整块舍弃，应核实实际注入与审计记录是否一致。避免引入独立上下文平台。基于实际模型用量和真实章节决定默认配置。

### F16 — 多路起稿有档位但缺显式策略差异；未保留所有结果（A+C / P2）

[chapter/stages.ts#L48-L70](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/pipelines/chapter/stages.ts#L48-L70) 与 [runner.ts#L208-L218](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/core/src/pipeline/runner.ts#L208-L218)：fanOut 使用同一 spec/packet，仅 stepId 不同，draft 输入无分支写法变量。chapter/index 最终只交付择优稿（中间候选仍可能存在运行记录）。所以“作者直接在多条创作路线中选择”不是当前交付体验。

先用真实写作评测比较现有三档的质量、成本、耗时，再决定是否为已有 fanOut 增加少量路线提示、允许作者查看未选稿或调整黄金章数量。不要默认增加候选数量；精品黄金 8 稿还需逐稿评分和换位比较，开销已经明显。保留现有 strengths/weaknesses/reason，按需呈现，不新做评分系统。

### F17 — 单一 fanOut 分支失败会使整组抛错（A+B / P1）

[runner.ts#L208-L218](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/core/src/pipeline/runner.ts#L208-L218)：Promise.allSettled 后 map 遇 rejected 即 throw，已完成分支保存于运行记录。该设计支持恢复，但模型偶发无效结果时，其他合格稿不能直接交付。优先验证用户是否常因单分支失败卡住；可对起稿阶段允许明确的降级策略（至少一个合格稿且作者知情），不能把预算暂停、取消、安全失败吞掉；其他 fanOut 可能要求完整结果，不要改成全局忽略异常。现有恢复足够时不改。

### F18 — 模型预算是软限制而非绝对费用上限（A / P1，R5）

[budget.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/core/src/pipeline/budget.ts) · [gateway.ts#L119-L185](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/core/src/model/gateway.ts#L119-L185)

金额仅检查已经消费金额，未预留当前/在途请求的预计费用；token 仅预留输入估算，输出发生后才结算。未知价格第一次请求仍可能通过（初始 usedMoney=0），之后若成本未知则暂停。即使串行，一次请求也可能超过剩余额度。并发模拟 cap=1、两个请求各0.7，最终 usedMoney=1.4。

先明确 UI 与设置承诺。如果本意是阶段边界暂停，就标为软预算并提前显示预计费用；如果明确承诺金额上限，则在已知模型价格、最大输出及在途费用前提下预留，未知价格提示无法保证。供应商计费、估算误差、缓存和失败请求可能使绝对上限仍无法保证，不宣传零超支。复用 Gateway/BudgetGuard，无独立计费系统。

## 6. 头条、拆书、规划及 Agent

### F19 — 头条事实“supported”缺确定性证据验证（A+B / P1）

[article/rules.ts#L134-L158](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/toutiao/src/pipelines/article/rules.ts#L134-L158) 按 ID 合并模型返回状态、sourceId、evidence；这个合并函数未确认来源和引文存在。`filterChangedParagraphClaims` 复用段落 hash + 文本匹配的已支持结论（#L64-L84），未在该函数校验来源版本。项目已有源文本 hash 与拆书逐字引文核验，可以复用思想和简单匹配逻辑。

只要求：来源 ID 合法、原文证据能定位、素材变更后旧结论失效；语义是否支持结论仍由作者和模型判断。正则抽取数字、人名、日期、引号有召回限制，不声称能核验全文所有事实。保留 34 字、84 分且零 fail/无硬闸、固定末句、最多两轮修订红线；事实核查不能由分数代替。不要增加外部事实检索平台作为前置条件。

### F20 — 拆书与规划：不扩功能，核对资产引用（C）

[dissect/index.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/pipelines/dissect/index.ts) 已进行分层抽样（stratifiedSampleSource(text,10,4000)）、报告范围声明、逐字核验、卡片输出；[book/apply.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/pipelines/book/apply.ts) 已将规划提案隔离、通过意图日志晋升。暂未发现需要新建拆书体系或规划框架的证据。建议只在作者评测中核对抽样范围是否被如实呈现、技法来源是否可信、选择的卡片是否真正注入、规划修改是否产生新提案而非覆盖正文。保留上游 Skill 原始资产、LICENSE、运行 Profile 与 stage-map 单源映射。

### F21 — Agent 已具备轮数上限；费用与任务交接按需补（A+C / P2）

[turn-runner.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/apps/desktop/src/session/turn-runner.ts) `MAX_TOOL_ROUNDS=12`、信号传播、context overflow 压缩恢复；gateway.session 使用共享并发机制、watchdog、费用记录，但不接收流水线 BudgetGuard。已有 BriefDrawer 可以收集作者任务单。不要新增 MAX_TOOL_ROUNDS 或另建任务单系统；只检查现有会话费用显示、必要的单轮软预算、工具取消、压缩后事实保留。若作者实际需要对话自动提炼 Brief，填充现有表单，经作者确认；不允许助手直接修改正文或设定集。保持 PI 适配层隔离。

## 7. 存储、Web 安全、交互和性能

### F22 — Web 外部监听是预览设计，不等于已发生暴露（B / P1，真实创作工作区对外时 P0）

[web-server.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/apps/desktop/src/server/web-server.ts) 默认 0.0.0.0、独立 `.cache/web-preview` 状态和示例工作区、noopCipher（不持久化密钥）；允许 opts 指定工作区。[http-io.ts#L58-L82](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/apps/desktop/src/server/http-io.ts#L58-L82) 无 Origin 允许，比较 Host/forwarded-host；SSE、导出、RPC 没有身份鉴别这一层。Origin 检查不是认证，但 0.0.0.0 不等于互联网可访问，需端口暴露及工作区实际配置。

**修正上一版**：AGENTS 明确要求预览监听 0.0.0.0 且支持 iframe，不直接改默认行为。保留隔离示例预览；文档明确仅开发用途，真实作者工作区仅允许本机或经过维护者授权的受控访问。若实际远程使用真实工作区，再选择简单访问凭证、可信代理和受限工作区；先确认部署，未经授权不更改宿主红线。不引入 OAuth/RBAC。

### F23 — 草稿暂存已有双后端，实际编辑器仍使用 localStorage（A+B / P1）

[useDraftStash.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/workbench/src/client/shared/useDraftStash.ts) 已有800ms暂存、页面退出 flush、恢复提示和配额错误处理；[drafts.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/workbench/src/editor/drafts.ts) 已定义 Node 文件后端，文件解析损坏时会自动移除该暂存文件。README 描述工作区文件草稿，但实际 Hook 走浏览器读写函数。不要再实现另一套文件后端；核对 Electron/Web 真实宿主连线，选定一种主要持久化方式，利用现有 IPC/命令边界桥接。异常时保留可恢复原件而非自动删除唯一副本；作者确认才写正文。先人工验证重启、切章、容量不足、外部版本冲突。

### F24 — 性能：只记录可观察热点，暂不下重构结论（B+C / P2）

| 源码热点 | 证据 | 处理方式 |
| --- | --- | --- |
| listChapters | [chapter.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/commands/chapter.ts) 遍历并读正文；宿主 save 后又 listChapters 取一行 | 可优先用已保存 doc 构造一行，避免保存触发全书读取；先确认统计口径 |
| listCandidates | candidate.ts 逐个读正文及状态/元数据 | 先用现有元数据，缺失才读正文；仅在大量候选时优化 |
| traceEntityTimeline | [trace.ts](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/129014ed295120d1f7fcff6c69719c273cc81be5/packages/fanqie/src/bible/trace.ts) 先 listChapters 后按需读正文，最多返回一定命中数 | 少量作品不必改；实际卡顿才加取消/分批/定位；搜索为单作品范围 |
| 实体匹配 | trace 中模糊匹配返回首个实体 | 出现同名/别名歧义时提供明确选择，避免新搜索引擎 |
| 上下文与模型 | 多路调用、重复正文/方法注入 | 以实际模型费用、质量评测确定是否减少重复或降低候选数 |
| SSE/React、D3 | 已有共享事件与仪表盘 | 无真实性能证据，不列为重构任务 |

使用一份真实或脱敏的长篇作品做手工体验验证：打开列表、切章、保存、检索、恢复、退出。记录机器与作品规模、实际耗时、是否卡顿；只有明显慢才定位。不要把上一版 300ms/1s 等目标当门禁，也不要做大型性能测试基础设施。

### F25 — UI/UX：复用已有组件，拒绝无证据全面改版（C）

C2 已有三栏、稿纸、选区工具、双稿对照、设定集、技法仓、Brief、存稿看板、工作流状态、日夜主题。未实际启动应用，不判定具体视觉缺陷。优先把 F02–F05、F07、F10、F23 的真实问题在现有界面表达清楚：续写锁定、专项待审、来源过时、导入预览、验收版本、缺章、草稿恢复。其余分卷、专注模式、搜索、面板简化、仪表盘调整、简易模型设置、个人风格管理均先问真实作者遇到什么问题，再做小改；不推翻 C2、不删 D3 只为减少依赖。

## 8. 五项隔离逻辑复现（实际执行记录）

运行环境：容器 Node v22.16.0；从审计提交源码手工转录对应函数相关逻辑为无依赖 JS；执行 `node /tmp/zhizhang-audit.mjs`，五个断言全部触发预期的异常逻辑。这里的“通过”指成功复现问题，而不是仓库功能测试通过。可在项目既有验证中用相同输入复查。

| 编号 | 函数 | 输入 | 当前逻辑输出 / 实际观察 | 应修正 |
| --- | --- | --- | --- | --- |
| R1 | stitchContinuation | 原稿=80个甲+原作者保留的句子；模型=80个甲+模型替换的句子 | 直接返回模型全文，不再包含完整原稿 | 完整前缀匹配或只追加 |
| R2 | computeSerialBuffer | C001/C003 final，各3000字；每日3000 | continuousFinalCount=2, continuousFinalChars=6000, publishableDays=2, postGapFinalChapters=[] | 按确认的连续章序识别缺口 |
| R3 | getTokenizedDoc 的 key | 同章号/位置/摘要，正文“张三失踪”和“李四归来” | 两者 key 完全相同：`C001:1:4:4:共同摘要` | 内容哈希 |
| R4 | asOf | 伏笔第100章 plant，第200章 pay，现 status=paid，查询150章 | threads=[] | 依据历史事件状态还原 |
| R5 | createBudgetGuard | moneyCap=1，两次并发预留，各结算0.7 | usedMoney=1.4 | 明示软限制或预留估计金额 |

上述五项之外，报告未宣称完整运行验证。CI 字体问题则有独立的真实远端运行日志。

## 9. 原报告 40 项逐条校准（全部对照）

状态：修＝保留真实修复；合＝与其他修复合并；验＝先验证；缓＝按需；已＝已有，不重复开发。原 P0/P1 不是自动继承，本轮按实际损失及证据重新排序。

| 原编号 | 原建议 | 校准结论 | 当前依据/动作 |
| --- | --- | --- | --- |
| 01 | 移除 Google Fonts | 修 P0 | F01，真实 CI 阻塞 |
| 02 | Web 访问边界 | 验 条件 P0 | F22，遵守预览宿主约束，区分示例和真实工作区 |
| 03 | final 来源误标 | 修 P1 | F04，确定逻辑问题 |
| 04 | 来源版本哈希 | 合 P1 | F04/F14，不另做谱系平台 |
| 05 | 导入完整性 | 修 P0 | F05，短序言、原号、原字节、状态 |
| 06 | 提交前哈希 | 修 P0 | F06，已有锁/意图日志 |
| 07 | 恢复沙箱与锁 | 合 P0 | F06，一并修恢复边界 |
| 08 | Windows E2E/package | 合 P0 | F01，现有 CI 即可 |
| 09 | 下游过时状态 | 合 P1 | F04，先补宿主消费和版本，不建 DAG |
| 10 | BM25 缓存键 | 修 P1 | F11，已隔离复现 |
| 11 | 历史伏笔 | 修 P1 | F12，已隔离复现 |
| 12 | 金额与并发预算 | 修 P1 | F18，先明确软/硬承诺 |
| 13 | 头条确定性证据 | 修 P1 | F19，复用来源哈希 |
| 14 | 交稿台账恢复 | 验 P1 | F08，已有部分幂等 |
| 15 | 文件草稿暂存 | 修 P1 | F23，复用已有后端 |
| 16 | 导入预览 | 合 P0 | F05，同一次确认即可 |
| 17 | 任务适配策略 | 已/验 | 三档及 golden 已有，先确认 UI 入口与真实质量 |
| 18 | 多候选路线 | 验 P2 | F16，先评估，不强制加调用 |
| 19 | 择优理由 | 已/缓 | 评分和比较已有理由，按需展示 |
| 20 | 续写原文保护 | 修 P0 | F02，不是简单加提示词 |
| 21 | 去 AI 腔范围 | 修 P1 | F03，重点是审读标记真实性 |
| 22 | 上下文逐条裁剪 | 修 P1 | F15，现有实体逐项；只补剩余层级 |
| 23 | 作者上下文摘要 | 已/缓 | ContextPacket 已有 omitted/source；不另造平台 |
| 24 | 真实模型评测 | 验 必要 | 尚未批准费用，授权后少量真实任务 |
| 25 | 章节读取 | 验 P2 | F24，先保存后全书读取这一具体热点 |
| 26 | 候选元数据 | 验 P2 | F24，按实际规模决定 |
| 27 | 回查取消/进度 | 验 P2 | F24，若实际搜索阻塞再加 |
| 28 | 别名歧义 | 验 P2 | F24，存在首项模糊匹配 |
| 29 | 技法精准注入 | 已/验 | 已有绑定、L2/L6 裁剪，核实实际注入记录 |
| 30 | 对话转任务单 | 已/缓 | F21，BriefDrawer 已有，自动填充按需 |
| 31 | 助手调用约束 | 已/验 | 已有12轮和取消，只核实会话费用 |
| 32 | 个人风格偏好 | 缓 | learning 已有记录；不自动改提示词 |
| 33 | 章节分卷定位 | 缓 | 无真实作者需求证据，保留现有组件 |
| 34 | 双稿 Diff | 已/缓 | 已有段落级对照，先遇真实错配再修 |
| 35 | 工作流详情收敛 | 缓 | 未实际 UI 验收，不作强制改版 |
| 36 | 简易模型设置 | 缓 | 已有设置/连接表单，实际困难再改 |
| 37 | 保存恢复反馈 | 合 P1 | F23，围绕实际恢复与冲突 |
| 38 | 放宽架构守卫 | 缓 | 不擅自修改 AGENTS；仅遇到妨碍真实修复才申请调整 |
| 39 | 清理重复测试 | 缓 | 没有确认冗余，暂不删除或重写 |
| 40 | 百万字性能 | 验 P2 | F24，先真实文件手工体验，后定向优化 |

新增或加强的重点：F03 专项审读误标、F07 验收版本与直接状态交稿、F09 修订/采纳一致性、F10 存稿缺章、F13 台账章节位置、F14 分支摘要混用、F17 fanOut 部分失败。这些比继续新增 40 个工单更重要。

## 10. 精简实施顺序（不是必须全部执行）

| 阶段 | 范围 | 可观察完成标准 |
| --- | --- | --- |
| A：交付 | F01 | 原 CI 首启字体错误消失；现有五条旅程全部执行；Windows package 实际成功或定位新阻塞 |
| B：作者资产与业务底线 | F02、F05、F06、F07；F03 若开启严格审读 | 续写不改锁定原文；导入全部可追溯、作者选状态；恢复不越界/不覆盖冲突；验收/交稿版本一致；专项不冒充审读 |
| C：长篇连续性与费用 | F04、F10–F15、F18、F19 | 谱系版本正确；存稿和历史伏笔准确；台账章序正确；上下文有余量；费用语义准确；事实证据可回查 |
| D：其他可靠性与体验 | F08/F09/F17/F22/F23 中实际验证成立的部分 | 用现有路径解决中断、过期、访问和恢复问题，不扩大新功能 |
| E：有真实数据再优化 | F16/F20/F21/F24/F25 | 作者评测表明确有收益才改，未证明问题不建设 |

不要把报告当成必须实现的全量待办。阶段 B 可按风险并行，避免一次 PR 改动所有模块。每次改动限定一个可观察业务问题，保留回退能力。不要根据此报告自动发版、变更业务红线或调用模型。

## 11. 验收策略：避免测试化

沿用仓库已有 `npm run check`、`npm test`、`npm run assets -- check`、`npm run build`、`npm run test:e2e` 与现有 Windows CI；不为每个任务新增文件或用例。仅针对原文保护、导入、状态/版本、意图恢复等高损失风险，在现有测试文件内补最小可复现验证（可先人工复现，已覆盖就不重复）。不建新 CI、不追求覆盖率、不要把 E2E 变成全面 UI 快照。

更关键的真实写作验收（需作者批准模型预算，使用现有运行日志即可）：选黄金章、普通章、历史伏笔章、半章续写、轻润色、头条资讯各一例；记录作者是否采纳、明显修改点、错误事实、模型调用成本与耗时。使用同一素材和任务单比较现有档位与候选策略。不能用 fake model 结果、84 分或编辑自评代替真实正文质量。若预算未批准，保持待验证状态。

## 12. 不做的事与 Codex 执行约束

保留当前模块化本地单体、Markdown/JSON 文件、写锁/意图日志、Python 唯一规则源、PI 适配、三档策略、Profile、C2 视觉。暂不引入微服务、Redis、消息队列、向量数据库、知识图谱数据库、事件溯源、全量数据库迁移、多 Agent 编排、协作 CRDT、新通用层或更多架构守卫。没有实际用户需求不进行 UI 大改。遵守仓库 AGENTS；如某个守卫确实妨碍具体修复，先申请调整，不能把放宽守卫本身列为产品优化任务。

**可直接给 Codex 的任务指令：**

> 以审计提交和本文证据为起点，先读取最新实际代码及 AGENTS，核对每个 F 编号是否仍成立。只修改已经确认的问题或经复现成立的风险，不重复建设已有功能。第一批完成 F01、F02、F05、F06、F07 的最小正确性修复；其余按依赖及证据选择。严格区分“已有/修复/待验证/不做”。保持作者裁决、头条标题≤34、质检84分且零 fail/无硬闸、编辑最多两轮、固定末句、状态词表及磁盘格式约束，不未经授权修改业务语义、发版流程或调用付费模型。复用现有实现和测试体系，不引入新框架，不为文件行数或测试数量做重构。每批交付列出真实问题、文件/函数、最小修复、现有验证结果和未完成事项，不用假设性建议扩大范围。

## 13. 结论

此次校准后，不再把已有三档、任务单、草稿文件后端、逐段 Diff、调用轮数等视为新功能，不再以无数据评分和预设版本路线图推动开发。最重要的不是增加工程量，而是把现有创作流程的关键承诺落实到源码：**锁定的原文真正锁定，已审状态真的经过审读，导入不漏正文，历史设定不泄漏或丢失，已验收与交稿对应同一个版本，存稿数量可信，真实 CI 能交付。**

本文件是基于审计提交的静态源码评估和五项隔离逻辑复现；后续应由维护者在完整项目环境执行必要验证。不等于全仓动态审计、完整安全评估或真实写作质量评测。
