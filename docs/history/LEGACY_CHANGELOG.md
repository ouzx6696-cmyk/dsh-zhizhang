> 档案快照：保留当时的分析、计划或验证记录，不作为当前安装与使用要求。当前说明见[文档导航](../README.md)，版本变化见[CHANGELOG](../../CHANGELOG.md)。

# 变更记录与维护约定

## 0.18.0 · 作品生命周期整体优化

- 按最终产物进入分析、规划、写作与修订；局部分析及迁移包不强制入公共库。
- 工作稿、条件接续、审读声明和定稿分离；当前版本及必要依据共同核对。
- 共同章节写入处理直接保存与候选采纳，修订保留历史，基线冲突不覆盖。
- 原恢复格式兼容；直接保存新增三文件 v5 意图，共享恢复原语和执行机制。
- 查询从存储核心分离，公开 Store 外观兼容；运行时依赖环由架构护栏阻止。
- 宿主实例配置按调用隔离；面板增加审读、定稿和修订确认，访问规则覆盖本机。
- 创作方法按任务加载，心理词等仅提示；正式引文改为逐字核对，阅读来源版本单独记录。
- 包版本、lock 元数据与运行时代码同步，CI 运行 Node 22/24 的同一 check。
- 全量收敛旧导航与回执：采纳内置扫描，编辑按授权，汇编不冒充定稿；候选列表与读取共用元数据校验。
- 移除过渡期检查脚本和空基线，改由编译器检查类型导入与未使用声明；共享底层文件原语和查询投影。
- 补齐新增前章后的上下文失效检查，保护旧候选与审读依据。

维护以完整业务契约为单位：共同操作、工具、面板、状态、简报、恢复和回执一起核对。测试继续放现有四文件，不为每个模块新增流程脚本。实际验证见 [IMPLEMENTATION.md](IMPLEMENTATION.md)。

## 历史记录

以下保留重构前的历史过程，其中烟测、端到端脚本、工具数量及旧写入规则不是当前要求。

## 未发布（基于 0.17.0）· 精简测试

- 日常入口为 `npm run check`：构建、静态护栏及四个测试文件；`npm test` 构建后运行同一套测试，直接验证发行代码。
- 合并重复主线与发行检查，移除独立长流程和烟测脚本；保留作者确认、证据、数据恢复、并发和面板安全检查。
- 下方旧版本条目记录当时的测试方式；其中提到的历史命令不再提供。

---

## 未发布（基于 0.17.0）· 规划与数据保护续建

- 全书、卷、幕规划可作为灵感候选暂存并显式应用；章简报按章节关联注入，面板显示摘要，完整规划与来源可通过灵感状态查看。
- 章节直接保存、候选暂存与扫描留痕、灵感应用、书源导入、删卡及拆书计划和分析加入各自的可检查、可恢复写入意图。恢复遇到文件变化会停止；新建作品和建立书源恢复记录之前的中断仍需人工核对。
- 协作进程的作品、库和灵感写入使用资源锁，不自动按超时破锁；外部编辑、断电持久性、Windows 和真实 DSH 尚需验证。
- 添加离线备份与校验脚本；旧数据不自动迁移。测试体系随后收拢至 `npm run check`。

---

## 未发布（基于 0.17.0）· 拆书卡采纳恢复

- 卡采纳在写卡、索引和候选标记前记录写入意图；v2 卡同时守住书源与元数据校验。中断时 `zhizhang_library_list(recovery=inspect|resume)` 检查或恢复，冲突不覆盖，恢复不会重复入库。
- 面板在库待恢复时展示明确提示，不把不一致索引显示为空库；首次创建索引采用完整文件加不覆盖链接，索引缺失但仍有资产时停止并保留原文件。
- 新书源、卡和候选 ID 加随机部分；旧卡轴缺失时读取卡本身判断。删卡和导入随后增加独立恢复记录，见上方续建说明。
- 协作进程并发写库有 Linux 验证；断电持久性和 Windows / 真实 DSH 宿主行为仍未验证，见 REBUILD.md。

---

## 未发布（基于 0.17.0）· 采纳中断恢复

- 候选采纳在写正文、作品摘要（含小说状态）、候选标记和留痕之前保存可校验的恢复记录；检查和恢复使用 `zhizhang_status(work=…, recovery=inspect|resume)`。恢复沿用原写入意图，避免重复追加；文件发生冲突时停止并保留记录。
- 扫描凭据绑定实际正文，扫描和验收之间候选变化会拒绝；旧凭据没有正文校验时须重新扫描。
- 新建作品用原子目录占位，保留已有同名目录，即使其中没有 meta.json；损坏的作品元数据不会被当作空目录覆盖。
- v2 技法卡保存引用章节阅读程度的申报快照；暂存和采纳时直接核对书源，书源发生变化须重新核对并暂存。旧卡不推断阅读深度。
- 限制：锁和部分其他恢复流程随后补充；旧版无恢复记录的部分写入仍需人工核对，没有验证断电或真实 DSH 宿主恢复。

---

## 未发布（基于 0.17.0）· 创作主链重构（实施中）

- 无参考卡时可按作者目标直接开启灵感规划；可选快爽、稳推、慢燃；作者显式应用规划时保存到作品并注入章简报，未指定时不推断，并区分没有参考来源与仅技法试写。
- 拆书事实可如实申报“正文已读”或“深读”，旧记录标未声明，报告不把提交事实当成阅读证明。拆书批次回执区分计划章节、本次实际提供和尚未提供的章节；缩小预算后再次取同批时优先未提交事实的章节。Full 成本确认前保留原计划。
- 计划和分析 JSON/JSONL 损坏时不再当成缺失；批量事实先校验整批。报告注明覆盖等指标不能证明阅读深度或创作质量。
- 超长前章简报保留开头和真实结尾、明确标注中间截断；当前状态过长时优先近期记录并标注省略；已登记但缺失的前章不再被误当开篇。
- 章节后果追加在作品锁内完成；作者可显式更新某章唯一状态记录，不覆盖其他手写内容。旧记录重复或无法定位时要求人工核对。
- 采纳前检查留痕可读性；正文已写入后若候选标记或留痕失败，明确报告部分完成及不可直接重试。本段所述提示后来被部分恢复流程替代；完整旧数据迁移与其余多文件操作边界见 REBUILD.md。

---

## 未发布（基于 0.17.0）· 存储层结构重构

- 从 `store.ts` 分离共享锁与文件操作、作品元数据、章节读写三个模块；原有公开存储接口保持兼容，工具和面板仍共用同一套锁。
- `chapter_save` 的仅元数据更新在锁内读取当前章节，避免排队期间正文或章纲更新被旧值覆盖。
- 保留旧式纯文本章节的读取与章纲更新兼容；发行构建包含新模块，包清单检查覆盖这些文件。

---

## 未发布（基于 0.17.0）· 并发与数据保护

- 章纲写入及候选采纳在作品锁内读取当前章节并保存，避免并发更新覆盖正文、遗漏 final 状态或丢失 append 内容。工具与灵感章纲应用共用该路径。
- 拆书库索引及审校账本损坏时明确报错并保留原文件；只在文件缺失时使用空记录，导入和卡采纳在写文件前读取索引。
- 灵感会话和候选 id 走路径段校验；Port 的 apply 只接受布尔 `true`。
- 新增并发、损坏文件和输入边界回归；锁仍是进程内锁，多进程写入不受其保护。

---

## 未发布（基于 0.17.0）· 全量审查一轮：真 bug / 安全面 / 静默数据损失

> 起因：不再按文档口径核对，而是逐文件读实现 + 构造反例。四条硬缺陷被证实：
> 拆书卡候选可被重复采纳成两张卡、部分 id 仍能拼出路径穿越、确认旗标被 `"false"`
> 字符串打开、章节 front matter 损坏时被当成「文件不存在」从而覆盖原稿。另有若干
> 静默错误（NaN 分批、取成最旧五条、full brief 建整份快照）与文档口径残留。
> 用例 57 → 68，每条新钉子都对应一条真回归。

- **卡候选只能采纳一次**：`acceptCard` 此前只写卡 + 索引、不回写候选，同一 `lcand` 反复 `card_accept` 会写出多张同源卡（并发下还会互相覆盖索引）。已改为「读候选 → 查已采纳 → 写卡 → 写索引 → 回写 `status=accepted / acceptedCardId`」全程持同一把库锁；重复采纳报 `candidate_already_accepted`。
- **卡 / 候选 id 沙箱补齐**：`getCard` / `getCandidate` / `discardCard` 原先把入参直接拼进路径，`../../x` 可读写库外文件。三处统一走 `assertResourceId`（`bad_id`）。
- **确认旗标只认严格 `true`**：`confirm_bypass` / `force` / `skip_brief` / `accept_after_edit` / `confirm_accept_after_edit` / `only_final` / `persist` 等，此前多处 `Boolean(x)` 或真值判断，传字符串 `"false"` 反而**打开**旁路（最严重的是绕过定稿保护）。工具层统一 `boolArg`（非布尔视为未传，PortConfig 默认仍生效），端口层与面板 POST 统一 `=== true`。
- **损坏章节不再当「不存在」**：`readChapter` 在 front matter 非法时抛错，而 `setOutline` / `saveChapter` / `acceptCandidate` / `chapter_save` / `outline_set` / 灵感 outline apply 都用宽 `catch` 把它当作新建，随后用空正文覆盖原稿。全部收窄为只放行 `ENOENT`（`isMissingFileError`）。
- **`stageCandidate` id 去碰撞**：`cand-${Date.now().toString(36)}` 在同毫秒并发暂存时互相覆盖候选文件。改为 12 位随机后缀。
- **`chapter_drafts` 取最近五条**：列表按 `stagedAt` 倒序，`slice(-5)` 取成了最旧五条；改 `slice(0,5)`。
- **`chapter_brief(full)` 轻量化**：为取 `nextHints` 调 `buildPanelSnapshot`，而它会顺带读 ledger / 库 / 灵感并渲染 HTML。新增 `hintsOnly` 只算 hints（面板路径不变）。
- **`library_plan` 的 `batch_chars` 兜底**：`Number.NaN` 也能通过 `typeof === "number"`，夹紧后仍是 NaN，分批比较恒 false（整本书挤成一批）。改为 `Number.isFinite` 校验后回退默认。
- **`meta.excerptPath` 沙箱**：来源 meta 由磁盘读入，被改坏时能把读路径带出 `sources/`。现只接受单段 `*.txt` 文件名，否则回退 `${id}.txt`。
- **面板切项目不串根**：项目摘要补 `worksRoot`，`panelPaths` 优先用该项目自己的作品根（此前一律用全局 `config.worksRoot`，切到子项目仍读写顶层项目）。
- **输入硬校验**：`brief_mode` 只认 lean/full、`mode` 只认 append/replace、`targetWords` 须正整数、`position` 须 ≥1 整数、`card_ids` 传错类型给明确错误而非静默空数组。
- **文档口径**：README / TEST.md 的「52 工具」统一为 51（与 smoke、STATUS 一致）。
- **验证**：typecheck 0 错 · guard 过 · **68/68 单测** · build + smoke（51 tools）· **e2e 26 步** 全绿（dist 为验证临时构建，验证后已按字节原样还原）。

---

## 未发布（基于 0.17.0）· 回执级业务复核一轮：五处真实业务缺陷修复

> 起因：全绿不等于业务对。本轮用探针把五条业务流（38 步）的**回执原文**从 dist
> 全部导出，当业务审稿人逐份人工审读——不看断言，只看回执会不会误导真实使用
> 的 AI 与作者。发现五处「测试全绿但业务不对」，全部修复并用探针复验回执。

- **inspire_start 不去重卡（真缺陷链）**：combo 回执里每张卡 id 出现两次（card_ids 行 + 明细行），AI 照抄传入是常态——session 不去重导致 forge 把同一张卡整段渲染两遍、分轴计数翻倍（「mind 2 · craft 2」实际只有 2 张卡），假数字还渗进 outline 的写作提醒。修复：startSession 对 cardIds 去重（session、回执、分轴三处一致）；探针复验双份照抄 → mind 1 · craft 1。
- **候选/留痕不校验章节存在（错误迟到且语义错位）**：对不存在的章可暂存候选、可记「定稿」审校留痕；下游 accept 撞上的却是 brief_required（让 AI 去补 brief 而不是发现章不存在）。修复：stageCandidate 拒 `chapter_not_found`（指路先 outline_set / inspire apply 建章纲）；review_ledger(append) 同样校验。新增 1 个测试钉子（69 用例）。
- **product_map 交接行含旁路 audit**：三柱交接写「report → library_audit → combo」——与上一轮修掉的 card_accept 回执同源同病（MAP 非目标：不把 audit 画进默认路径），藏在 Scheduler 的交接表里。修复后默认交接不含 audit 并标注勿例行。
- **facts_stage 游标措辞误导**：游标指向**未完成的当前批**（本批 6 章只记了 1 章），回执却写「取下一批」——AI 会误以为要跳批。措辞改为「取原文（游标指向未完成的批：本批尚有章未记则回本批继续白描）」。
- **status 空作品裸报错**：起步有两条路（先拆书 / 先建作品），仪表盘在空库时却回 `错误[bad_args]`。改为返回双路径起步引导（含推荐路径与直接开写路径）。
- **审读确认的优秀回执**（未动）：lint（token 语义 + 对白豁免 + A/B/C 提醒）、card_accept（判断面五条判据）、accept 软传感（160 字短稿被书感雷达正确抓「无书债」）、payoff_audit（加权命中 1.00 明细）、lean brief（读者合同 + 绑定卡 + mind 不灌）、Full 成本回执。
- **清理**：删 `scripts/e2e-dist.mjs`（0.10.3 基线遗物，无引用，已被 e2e-workflow 取代）；探针脚本（probe-receipts）审完即删，不进库。
- **验证**：typecheck 0 错 · guard 过 · **69/69 单测** · smoke · **e2e 26 步**；五处修复的回执全部经探针复验后清理。

---

## 未发布（基于 0.17.0）· 业务对齐一轮：从创作业务出发的系统性整理

> 起因：前三轮都从工程/代码视角出发。本轮先精读九份业务文档建立业务认知
> （项目效果 = 作者交参考书→拆出可迁移写法→灵感长出自己的书→逐章受闸写作→
> 面板读/采纳→定稿出书），再逐条业务流审计意图与行为的偏差。发现七处业务级
> 不一致，全部修复；工具面 52 → **51**。

- **回执与调度地图矛盾（真业务 bug）**：`card_accept` 的默认下一步把诊断旁路 `library_audit` 写进主链（「report / audit → combo」），而 MAP 的非目标明文「不把 diagnose.audit 画进默认路径」「勿例行」。已改：主指路只留 8/9 report → 9/9 combo，audit 标注为诊断旁路且「机械面通过≠卡能用，勿例行」。
- **删 `zhizhang_export` 纯别名工具**：与 `zhizhang_assemble` 完全同义（description 自认「导出别名」），对 Agent 的工具选择面是纯噪音——两个名字指同一动作。已删，assemble 吸收交付语义（description 补完书口径：多数章 final 后跑、only_final 收 reviewed/final、重跑覆盖）。全链单源同步：Scheduler 旁路表、SYSTEM_BRIEF 定稿行、测试与 smoke 计数、五份文档。
- **完书交付流补全**：定稿此前在文档里只有一行「assemble / export」。MAP 现在写明**完书三步**（review_ledger 留痕 → chapter_save status=final → assemble only_final=true 出 manuscripts/<书名>.md）与**定稿后修订口径**（final 拒覆盖；确需改稿 force=true 降回 drafted 重新定稿）——后者代码里一直有完整业务设计，文档从未讲过。
- **文档业务口径统一**：TOOLS.md 修库段表格断裂（combo_suggest 行被 blockquote 切出表格外）+ report 定位自相矛盾（9 步表是默认第 8 步、工具表又标「旁路」→ 统一为「8/9 默认链收尾」）；PANEL.md HTTP 安全面补齐第四轮实现（Origin/Host、415、panelHosts 白名单、panelToken、限流、严格布尔三态——此前还写着旧的「loopback only 可放宽」一句）；COGNITION.md 删除对已清理 archive/research 的死引用。
- **资产清单补全**：DATA.md 目录树补两个在役资产——作品级 `quality-lexicon.json`（单书严格兑付审计开关）与 `inspiration/bindings.json`（workKey→绑定卡索引，brief 取卡先读）；修 code span 笔误。
- **验证**：build/typecheck/guard · **68/68 单测** · smoke（51 tools）· **e2e 26 步**全绿——业务行为变化（指路文案、export 删除）全部在三层验收内确认无回归。

---

## 未发布（基于 0.17.0）· 结构清理一轮：开发痕迹清除 + 测试系统重建

> 起因：三轮优化后工程面已稳，但仓库里堆着历史开发痕迹（bun 锁、0.x 期实现笔记、
> 调研残留、历史自检快照），测试系统长成 29 文件/3854 行/122 用例撒在 4 个语义重叠
> 目录——四成以上用例在互相重复走同一段链路。本轮：清痕迹、并口径、重建测试为
> 「单测(能力) · e2e(工作流) · smoke(发行)」三层，各层不重复。

- **开发痕迹清除**：删 `bun.lock`（bun 时代锁文件，bunfig 已废而锁文件残留）；删 `docs/archive/`（11 个 0.3.x–0.10.x 实现笔记）、`docs/research/`（调研笔记 + 拷贝的他项目 meta）、`docs/QA_REPORT.md`（0.15.3 自检快照，自declared 历史记录）；`http-api.ts` 删 `assertSafeResourceId` 转发壳、四处多余 `export` 收敛。
- **文档纠错**：PILLARS.md 取卡口径改为「显式 → bindings 索引 → 旧数据扫描 → none（指路组包）」，删掉已不存在的 genre 检索描述；DISSECT.md 置信度公式对齐实现（0.4×覆盖 + 0.3×引文 + 0.2×结构 + 0.1×维度/6，Auto 封顶 0.84，needs_review <0.85——原文写的 0.5/0.3/0.2 与代码不符）。
- **测试系统重建**：29 文件/3854 行/122 用例（contracts/gates/pillars/tools 四目录）→ **9 文件/68 用例**（单层，一能力一文件）。行数 -65%，用例 -53%，但每一类载荷行为都有钉子：ending 矛盾矩阵、闸语义+竞态、存储边界、拆书管线、灵感/取卡、写作链、面板安全面、多草稿、挂载模型。合并掉的重复：写作链 6 处重复走查 → 1；HTTP 服务样板 5 处 → helpers.servePanel 1 处；面板 3 文件 → 1。
- **smoke 瘦身**：578 行功能面全家桶 → **82 行纯发行面**（dist 加载、52 工具注册、按需挂载、面板可服务、版本一致）。功能链路不再与单测/e2e 三处重复——工作流面归 `npm run e2e`（26 步剧本），能力面归 `npm test`。
- **TEST.md 重写**：三层验收表（单测=能力 / e2e=工作流 / smoke=发行）+ 一能力一文件布局表 + 新加测规则（断言 code/落盘/指路而非文案；每条测试要能说出防的是哪个回归）。
- **验证**：typecheck 0 错 · guard 过 · **68/68 单测** · smoke 过 · **e2e 26 步过**（重建后立即互证：单测钉能力、e2e 钉工作流，互不依赖也互不掩盖）。

---

## 未发布（基于 0.17.0）· 深度优化二轮：9 个真 bug / ending 一致性统一域 / token 二次减负 / 面板与 HTTP 安全面

> 起因：第二轮全项目认知（5 路并行深读）+ 反例构造复核，确认了 9 个真 bug、
> 三套互相矛盾的「章末 vs 正文」一致性实现、SYSTEM_BRIEF 37% 重复、面板轮询无字段上界、
> HTTP 面板缺 Origin/Content-Type/限流约束。107 → 122 用例全绿；所有钉死行为（回执短语、
> rain 基线、foundation 0.35 选择口径）逐条保住。

- **真 bug ×9**：① `method_get` ids 传数组直接崩（现在字符串/数组皆可，坏类型硬报）；② AcceptPolicy 的 strict_* 形参带 `= false` 默认值，把「未传」吃成「关」，PortConfig 默认严格永远不生效（改为 undefined 三态透传，测试钉住默认真严格）；③ `library_dissect(mode=full)` 无计划也放行全量（现须 library_plan 的 Full 同意，仅 opening/sample/chapters 免）；④ 「00:40」生成中文别名「零点40」漏「四十」（`toCnNumber` 域统一修复）；⑤ 空串 `lintPassToken=""` 被 `token ?` 判为已扫（改显式非空校验）；⑥ unify 系列 POST 不认 body 里的 base（与 accept 不一致，已统一）；⑦ 面板 accept 布尔参数 `Boolean()` 强转——`"false"` 字符串会打开 force（改 `=== true` 严格三态）；⑧ `combo_suggest` 深选漏掉 v2 卡 hay（导入 coerceHumanFeel 修复后接通全文检索）；⑨ 前章解析对未登记章节 id 静默回退到「最后一章」（改返回 null，交由合同告警）。
- **质量模型统一（B1）**：新建 `src/lib/domain/ending-consistency.ts` 单一事实源——加权 token（锚点 clock/lexicon/quoted 权重 2.0/1.5，长中文串 1.0，bigram 0.25 兜底）、双向时钟别名命中、`scoreEnding` 锚点优先（有锚点时长中文串降级弱证据，避免双重计数）。payoff_audit 与读者合同漂移共用它；foundation 的 0.35 大网只做选择不做裁决，明确分口径。裁决阶梯保持旧行为：无锚点静默（除非 <6 字）、`ending_missing`/`ending_underdelivered`(<0.5)/`ending_ok`(≥0.75)；`quality-lexicon.json`（作品根 `endingKeywords`）可为单书开严格模式。5 个反例矩阵测试钉死（雨夜转写两静、强缺失双报、对齐通过）。
- **AcceptPolicy 短路 + 回执（B3/B4）**：brief/lint/payoff/edit 四廉价闸先算，全过才跑人味/书感（省一次全文软传感；brief 硬拒时不再付）；`briefRecentMs` 从 PortConfig 真正进 accept 管线（此前写死）；回执 info 码表查 `RECEIPT_TEXT_ONLY` 只出纯文本。书感尾钩检测补强钩词典（强钩 1 个即中，弱钩须 ≥2 类）。
- **token 二次减负（C）**：SYSTEM_BRIEF 3154 → 2105 字（9 条编号化；旁路清单由 `SCHEDULER_BYPASSES` 生成不手抄；与面板/token 相关的两行合并）；`WORKING_DIR`/`WORK_OPT` 描述压到一行；方法资产 `includes` 机制——`plan`/`review`/`revise` 不再内嵌整段文风契约/审校五类正文（去重 1749 字符），`getMethodAssets` 展开时自动附在包后；`chapter_brief` 删死参数（`include_prev_tail` 兼容保留、`brief_mode` 枚举化、lean 锁定行去重）。
- **面板/HTTP 安全面（D4+A6/A7）**：回环默认信任但 **Origin 若出现必须匹配 Host**（DNS rebinding 防护）；POST 一律 `application/json`（415）；LAN 模式（`allowLanPanel`）须 Host 白名单（`panelHosts` 或本机网卡自动推导）+ 可选共享令牌（`panelToken`，Bearer/X-zhizhang-token，timingSafeEqual）；简单限流 120 GET / 20 POST 每分钟每客户端（429）；accept 的 mode 非法 400、confirm/force/skip/strict 全部严格布尔三态（`confirm: 1` 不再被当 true）；unify POST 的 base 与 accept 同权生效，candidate_ids 去重截 8。新测试 `panel-http-security.test.ts`（5 例：415 / bad_mode / 非布尔 confirm / 回环 Origin / LAN 白名单+令牌 / 限流）。
- **面板轮询减负（D2/D3）**：`/inspiration` 路由不再为了三个透镜字段构建整份快照（新增 `listChapterLensRows` 轻量读取，library/inspiration 视图各只建一次）；快照字段上界——foundation 四字段 600 字、每章三透镜 400 字（`capText` 按码点截断）、候选只发「待采纳全量 + 最近 20 条已采纳」、`lastPayoffByChapter` 最近 12 章（nextHints 仍按全量计算）、拆书 analyses 20 条且在昂贵的 bundle 读取之前截断。
- **取卡索引（E4）**：`inspiration/bindings.json` 维护 workKey→cardIds（`stageEmit` 在候选上快照卡组；`acceptEmit(apply)` 锁内前插更新、上限 24）；`resolveCardsForBrief` 先读索引（免每次 brief 扫全 candidates/ 目录），旧数据回退目录扫描；getSession 与扫描循环换 `readJsonCached`（mtime 缓存接入）。
- **Full 同意闸参数绑定（E5）**：成本回执留痕参数快照（batchChars/totalChapters/planChapters）；confirm 时比对当前参数，batch_chars 被换或索引变化 → `bad_confirm_token` 指明漂移字段——作者同意的是回执上的数字，不是换参重建的计划。旧留痕（无快照）兼容通过。
- **测试**：107 → 122（ending-consistency 反例矩阵 5、accept-policy 默认严格+短路 2、HTTP 安全面 5、bindings 索引 2、Full 闸参数绑定 1，另 method_get/严格三态/时钟等修进既有用例）。
- **端到端工作流验收（`npm run e2e`）**：新增 `scripts/e2e-workflow.mjs`——不是工程冒烟，是一条真实创作剧本连跑 26 步：启用 → 拆《夜班账本》10 章（import→plan→dissect→facts→structure→v2 卡×2→19 节报告→组包）→ 灵感建作品《凌晨账本》（会话→forge→根基/章纲 apply，bindings 落盘）→ 第一章（lean brief 注入绑定卡与文风契约 → 初稿 → 无 lint 拒 → 采纳落盘 → 双采纳拒 → 兑付审计加权命中 1.00 → 审校留痕 → 定稿）→ 第二章（续写 brief 注入前章全文 → 面板 HTTP 采纳，无 confirm 拒）→ 汇编成稿 → 外部架构盘点（8 个落盘工件在位）。每步同时断言「真实落盘」与「回执指路」。验收当场抓到一个真缺口并修复：有计划时 `dissect(mode=full)` 被静默无视，现在回执明确指路全量升级正路（library_plan mode=full + 作者同意）。

---

## 未发布（基于 0.17.0）· 深度优化一轮：双采纳竞态 / 全库 I/O 缓存 / token 减负 / 面板转义加固

> 起因：一次全维度审计（工具层 / 端口层 / 存储层 / 面板层）发现四类问题——
> 「禁止双采纳」硬闸存在真实竞态窗口；面板每 ~6s 轮询等于全库磁盘树扫描；
> 启用与快照回执在给 DSH Agent 白付大量重复 token；面板 HTML 有两处廉价转义缺口。
> 全部按「工程归代码」修在 Ports/Store，工具保持薄；101 → 107 用例全绿。

- **并发·双采纳竞态（真 bug）**：`acceptCandidate`（store.ts）整个「读候选 → 查 acceptedAt → 写章 → 回写候选」原本完全无锁——两个并发 accept 可同时通过幂等检查双写正文，且与持锁的 `markCandidateLinted` 交错写同一份候选 JSON。现在全程持 `${dir}:cand:${id}` 锁；灵感侧 `acceptEmit`（ports/inspiration.ts）的读+检查同样移进 `inspiration:<root>` 锁内。测试：`Promise.allSettled` 双 accept 恰好一个成功、ledger 里只有一条采纳记录。
- **并发·写路径加固**：`atomicWrite` rename 失败时清理 tmp（不再泄漏临时文件）；`getRecentBrief`/`getRecentPayoffAudit` 遇到坏时间戳条目改为跳过继续往旧找（原来整条查询直接失效）。
- **I/O·mtime 读缓存**：新增 `src/lib/file-cache.ts`（stat 校验 mtime+size 的进程内近似 LRU；所有写都走 atomicWrite→rename，mtime 必随写变化，stat 比对即可安全判失效）。接入：拆书卡 `getCard`、作品/候选/灵感会话/灵感候选列表、分析 bundle（`analysis/paths.ts` 的 readJson/readJsonl）。面板轮询从「每 6s 全库重读」变为「每 6s 全库 stat」。
- **I/O·拆书源缓存**：`LibraryPort.getSourceIndexed` 按文本文件 mtime 缓存整书文本 **并派生缓存章索引**（chapterIndex 全文正则扫一次即可）；dissect / facts / structure / report / card stage / card accept / audit 全部改走它——此前每暂存一张 v2 卡都整本重读 + 全文重扫一遍。auditCards 循环里每张卡重算 chapterIndex 的问题一并消除。
- **I/O·写放大有界**：`appendLedger` 保留最近 `LEDGER_MAX_ENTRIES=1000` 条（面板只用最近 12 条；此前 append-only 永不截断，每次追加 O(n) 整文件重写）；分析层 upsert（facts/plots/characters）不再「写完再整读一遍只为取 count」；`exists()` 由整文件 read 改为 stat。
- **token·启用回执瘦身**：`zhizhang_enable` 回执不再内嵌整张 ProductMap（实测 ~5.4K 字符），改为 `Scheduler.formatEnableSummary()`（全链一行 + 旁路 id 一行 + product_map 指引，~0.5K）。全图仍在 `zhizhang_product_map` 工具与常驻 SYSTEM_BRIEF，模型按需拉取。
- **token·快照与报告**：`zhizhang_panel_snapshot` 默认 `format=both`（pretty JSON + 完整 HTML）改为默认 **json 且紧凑无缩进**，html/both 仍可显式选；`chapter_brief` full 模式只为拿 nextHints 却全量渲染 HTML 再丢弃——改传 `includeHtml:false`；`library_report` 回执预览 40 行 → 12 行（报告已落盘，回执只做结构确认）。
- **面板·转义加固**：`panel-html.ts` 的 `esc()` 补 `'`→`&#39;`（与客户端 escapeHtml 对齐）；所有数字插值（章数/字数/卡数/进度）改经 `num()` 强制数值化——磁盘 JSON 被污染成字符串时不会把标记注入工具输出的 HTML。
- **面板·客户端**：`lightMdToHtml` 结果按 `chapterBody`/`candidateBody` useMemo（此前每 6s 轮询对最长 400KB 正文重新解析一遍）；localStorage 记忆值未变不写；`/health` 不再构建两次 product view。
- **门禁·CPU**：`auditHumanFeel` 分句/分段各算一次传给全部检测器（此前 4 个检测器各自全文重扫，单次审计 ≈ 6 遍全文）；style-linter 11 条规则预编译一次（此前每次调用重编译）+ 对白区间二分查找（原线性扫）。
- **一致性**：删重复实现——`countWordsLocal`（multi-draft，与 store.countWords 逐字相同）、tools/analysis.ts 的 `openLibrary` 副本（改从 tools/library.ts 导出）；`library_plan` 非法 mode 与 `dissect_brief` 批号越界从「正常回执字符串」改为 `错误[bad_args]`（模型此前拿到的是成功结果）；删 audit.ts 不可达分支；index.ts 过时的「47 tools」注释改为运行时口径。
- **测试**：新增 `test/contracts/perf-hardening.test.ts`（6 例：并发双采纳 / ledger 截断且裁最旧 / mtime 缓存经 atomicWrite 与外部改写均正确失效 / 坏时间戳跳过 / enable 回执紧凑 / panel_snapshot 默认紧凑 json）。

---

## 未发布（基于 0.17.0）· 测试脱离 bun + 参数硬校验 + 类型安全护栏

> 起因：全量审计发现两条质量护栏是虚的——`npm test` 依赖未安装的 bun（23 个测试文件一个都跑不了）；
> `tsc --noEmit` 恒为 0，因为 74 个源文件全带 `@ts-nocheck`（实际藏着 1137 个类型错误）。

- **测试迁到 node:test**：23 个测试文件改 `node:test`；新增 `test/_compat/expect.ts`（bun/jest 风格 `expect` 的本地实现，含 `arrayContaining`/`objectContaining` 与 `.not`）与 `test/_compat/ts-resolve.mjs`（把源码里的 `./x.js` 解析到 `./x.ts`）。`npm test` 不再需要 bun，81 → 90 个用例全绿。
- **顺带修掉一个真 bug**：`library/store.ts` 的 `cardDeepHay` 调用了未导入的 `coerceHumanFeel`，抛 ReferenceError 后被 `catch { /* skip */ }` 吞掉——技法卡全文检索（机制名 / 人味字段 / 正文）一直是坏的，只能命中标题、标签、来源、轴。
- **全文检索补覆盖面**：修好 import 之后又发现 haystack 只到 body/mechanisms/humanFeel/bookCraft/mind。v2 模块的 **不可照搬 / 可替换 / 迁移 / 失败边界 / 读者想要 / 情绪走向 / 戏剧单元 / 三步公式 / 反AI腔词表 / 证据引文（含章号）/ handoff** 全搜不到——现在全部进 haystack，`test/contracts/library-deep-search.test.ts` 逐字段钉住（少一个字段就红）。
- **构建在 Windows 可用**：`npm run build/typecheck` 改走 `node ./node_modules/typescript/bin/tsc`，不再依赖 `.bin/tsc` 的 `.cmd` 垫片。
- **参数硬校验**：新增 `asArray` / `asStringArray`（`src/tools/context.ts`），替换 17 处 `Array.isArray(args.*)` 静默兜底。传错类型现在直接报「参数 card_ids 必须是字符串数组」，不再悄悄变成空数组。
- **删掉「按 genre 猜卡」这条死分支**：`resolveCardsForBrief` 原本第三步是「genre 检索技法卡」，实测永远命中 0 条——技法卡是写法卡（"借场杀人""把信息差押到章末最后一拍"），不含题材词，而作品的 genre 是「玄幻·都市异能」，两边没有交集。留着只会让人以为 lean 简报有自动注入。现在注入只走两条明确路径：**显式 `card_ids`（先用 `library_combo_suggest` 组包）** 或 **本作品 `inspire_accept(apply)` 绑定过的卡**；空结果的提示也改成指路 `library_combo_suggest`。测试 `pillars/inspiration` 钉住：genre 命中卡内文也不注入。
- **全仓 strict 类型**：74 个源文件的 `@ts-nocheck` 全部摘除（`src/` 现在 0 个），`tsc --noEmit` 在 `strict: true` 下 **0 错误**（原来被 nocheck 藏住 1137 个）。核心数据模型落成类型：`src/lib/types.ts` 的 `Foundation / Outline / ChapterMeta / WorkMeta / Candidate / Ledger / StoragePaths / PluginConfig / ExecContext`；`ProjectEntry / ProjectSummary`、`ChapterIndexRow`、`PanelPathsResult` 等就近声明。
- **类型安全护栏**（`npm run guard` + `test/contracts/ts-guard.test.ts`）：① `scripts/ts-nocheck-guard.mjs` 以 `scripts/ts-nocheck-baseline.json`（现已清空）为准，新增 `@ts-nocheck` 直接失败；② `scripts/type-import-guard.mjs` 禁止把 `interface`/`type` 当值 import —— 类型剥离只删注解不删 import，写错就是运行时 `SyntaxError: does not provide an export named 'X'`（`tsc` 查不出来，这一轮真的踩到了）。
- **可移植性**：`cordis.patch.yml` 里的本机绝对路径改为注释示例，默认回退 `<会话 cwd>/.zhizhang`；`zhizhang_status` 增加「存储根（排查用）」一节点名 base/works/library 三条路径。
- **删除** `bunfig.toml`（preload 已由 `--import ./test/setup.ts` 接管）。

---

## 0.17.0 · 单一事实源 + 模块化

> 起因：同一件事散在多处——工具数 47/51/52、报告 19/22 节、拆书 9/10 步、版本 0.15.6/0.16.0；
> 分析层与库层是千行单体；accept 与前章解析各有 4 份拷贝。补丁式修改只会让下一处继续漂。

- **单一事实源** `dist/lib/domain/`：`chapter-heading.js`（中/阿拉伯章号、序章、卷）、`card-schema.js`（v1→v2 适配 + 5 项校验）、`evidence.js`（引文/正文引文回溯）、`coverage.js`（覆盖权重与 Auto 0.84 封顶）、`report-sections.js`（固定 19 节）、`workflow.js`（拆书 9 / 写作 6 步）。
- **分析层拆模块** `dist/lib/ports/analysis/{paths,chapters,meta,facts,structure,modules,evidence,coverage,survey,report,plan}.js`；`analysis.js` 只做 facade。报告 19 节固定：§1.1 量化底座 / §4.1 开篇十章节拍 / §9.1 爽点密度；小书不再出现幽灵章行与 `-Infinity`；§14 同时列 v2 与 v1 卡。
- **库层拆纯逻辑** `dist/lib/ports/library/{store,schema,audit}.js`（索引/导入、schema/格式化、机械审计）；v1 卡带 `steps/bannedDiction` 直接拒（不再静默丢）；v2 卡不再误报「书感偏薄」；`library_audit` 无正文引文时不再打印 `0/0`。
- **共享服务** `dist/lib/services/accept.js`（tool 与 panel 同一采纳管线）、`chapter-context.js`（brief / accept / audit / panel 同一前章解析）。
- **计数与版本运行时读取**：`zhizhang_enable` 回执/描述、ProductMap 工具面、报告节数、工作流文案都从 domain 读；客户端去掉 `47 个工具` 与版本硬编码。
- **测试**：smoke 新增 19 节、§9.1、无 `Infinity`、v2 不误报、v1 steps 拒绝、中文章号、audit 文案断言。

---

## 0.17.0（前一轮）· 量化底座 + 正文引文回溯 + 卡操作序列

> 起因：Auto 抽样能出剧情条，但全书骨架、卷界、词频、爽点密度这些「代码一跑就知道」的东西不该靠模型猜；
> 同时对照外部拆书资产发现：没有「正文引文回溯」的卡，会把合理想象写成「原文如此」，读起来更顺、实际更危险。

- **新增 L0 量化测绘** `dist/lib/ports/survey.js`：解析原文「第X卷」标记得到真实卷界；统计去空白字数/行数/章长/对话占比；2–4 字 n-gram 高频词（停用词过滤 + 嵌套去重）；按章序十等分热力；关键词密度 + 钩子强度 + 卷首卷末加成得到锚点章。全书扫一遍约 3 秒。
- **报告新增 §1.1 量化底座**：分卷表（章范围/章数/字数/首末章）、高频词 Top 20、分布热力、锚点章 Top 15；**§4.1 开篇十章节拍**；**§9.1 爽点密度**（强/中/弱钩子计数与平均间隔，按卷拆）。
- **置信度拆三层**：覆盖（事实/计划）+ 引文证据（引文通过率）+ 结构完整（测绘/剧情条/节奏/人物），加权后 Auto 抽样封顶 0.84 并标 needs_review，不再出现「1.0」的假达标。
- **`library_audit` 增加正文引文回溯**：只核「声称原文」的引文（前后 40 字含 原文/原著/第N章，或引文 ≥20 字）；示例引语跳过并计数。假引文会直接进 bad 列表。
- **卡新增 `steps` 与 `bannedDiction`**：三步操作公式 + 反AI腔词表；brief 注入（含 lean）时一并显示。
- **模块校验新增软警告**：emotionArc/dramaticUnit 带章号（梗概化）、证据全部同章（单场景）、steps 不足 2 步。
- **Auto 分层改为前 10 章 + 后 3 章 + 等距**：开篇十章节拍必须有事实，否则报告只能给 3 章判断。
- **`library_card_get` 渲染 v2 模块块**（此前 v2 卡只显示 humanFeel 段，看不到 5 项与 steps/bannedDiction）。
- **版本**：0.17.0；工具数仍 52。

---

## 当前（0.16.1）· 抽样两档：Auto 10% 分层 / Full 须作者同意

> 起因：0.16.0 的 sample 只取 4 章（约 0.4%），撑不起全书结论；但全量读 717 万字也不现实。
> 这一版把「读多少」变成显式计划：默认 10% 分层抽样，Full 全量必须作者明确同意。

- **新增 `library_plan`**（第 52 个工具）：Auto 按字数 10% 分层（前 3 章 + 后 3 章 + 其余按累计字数等距），确定性可复现；小书（10% < 3 万字）直接全读。
- **Full 两步闸**：`library_plan(mode="full")` 只出成本回执（章数/字数/tokens/批次数/时长）+ `confirm_token`，不写盘不开读；作者明确同意后带 `confirm_full + confirm_token` 才落盘，并记 `consent`。
- **`dissect_brief` 支持 `batch=n`**：按计划分批返回原文（≤3 万字/批），回执带进度与游标；无计划时保留 from/count 旧路径。
- **`facts_stage` 计划感知**：章号不在计划内 → 软警告（允许手补）；每批提交后推进 `cursor`，中断可续跑。
- **报告/审计/列表**：标 Auto/Full 与覆盖率；Auto 的全书结论一律标「抽样观察」；Full 未完成标「全量未完成」。
- **文档**：`docs/DISSECT.md` 增「四个问题」（什么是/为什么/得到什么/怎么拆）与两档表；SYSTEM_BRIEF / 产品地图 / TOOLS 改为 9 步。

## 当前（0.16.0）· 拆书 8 步：事实 → 聚合 → 模块 → 报告

> 起因：0.15.x 的「读几章 → 出卡」跳过事实层与聚合层，卡只能靠印象写，产出偏「场面观察」，不是写作技巧与创作理念。
> 这一版按成熟拆书方法论重做数据层与工序：先白描事实，再聚合剧情/节奏/人物，最后才抽象成模块与报告。

- **新增分析层** `dist/lib/ports/analysis.js`：章节目录解析、逐章事实（白描）、剧情条、节奏表、人物弧光、覆盖率/置信度、18 节报告拼装。
- **新增 4 个工具**（51 个）：`library_facts_stage` / `library_structure_stage` / `library_report` / `library_card_discard`。
- **`library_dissect_brief` 支持批次**：`mode=opening|chapters|sample|full` + `from/count`，直接返回下一批原文（≤3 章 / ≤15000 字）+ 事实模板。
- **`library_card_stage` 支持 v2 模块**：`layer + dimension + readerWant/emotionArc/dramaticUnit/replaceables/mustNotCopy/transfer/failWhen/evidence`；axis 由层+维度推导（book/arc/unit→mind，scene/chapter/line→craft）。
- **`library_card_accept` v2 硬校验**：5 项 + transfer/failWhen + evidence 逐条回溯；缺项/引文未命中直接拒；旧 v1 卡仍走原路径。
- **`library_audit` 增加分析层**：事实/剧情条/人物/白描违规/覆盖率；v2 模块走模块校验，不再误报「缺 ## 证据 段」。
- **`library_report`**：确定性拼装 18 节报告；覆盖不足标「早期观察」；写入 `library/analyses/<sourceId>/report.md`。
- **面板**：`/library` 返回 `analyses[]` 拆书进度；新增 `/report?source=` 报告接口。
- **SYSTEM_BRIEF**：拆书 7 步改为 8 步（批次 → 白描 → 聚合 → 模块 → 报告）。
- **文档**：新增 `docs/DISSECT.md`（方法论 + 阶段 + schema + 纪律）。

## 当前（0.15.6）· 工作流显式化：照做，别跳步

> 起因：理念注入后还差一步——把「先做什么、下一步是几」直接摆出来，别让 Agent 自己拼。

- **SYSTEM_BRIEF 新增【工作流】**：拆书 7 步 / 写作 6 步，每步带动作与闸；回执里的「下一步 N/7」与此同号。
- **ProductMap 新增 `WORKFLOWS`** 与「## 工作流（照做，别跳步）」段：每步 tool + 动作 + 出库闸。
- **库工具描述带步骤号**：1/7 交书 → 2/7 真读+拆 → 3/7 出卡 → 4/7 读警告 → 5/7 采纳 → 6/7 机械面审计 → 7/7 组包。
- **回执统一「下一步 N/7」**：import / dissect / stage / accept 均指向下一步；stage 的软警告在前、下一步在后。
- **docs/TOOLS.md「默认路径」**改为 7 步 / 6 步表，直接可抄。

## 上一版（0.15.5）· 核心理念注入：脚本跑过不算，真读才算

> 起因：0.15.4 的工具能证明「引文没编、字段没缺」，但没法证明「卡能用」。
> 这一版把验收判据写进硬规则、简报、暂存、采纳、审计五处，避免再用脚本通过冒充拆完。

- **SYSTEM_BRIEF 新增第 8 条**：拆书验收（真读，不看脚本）——引文/字段/audit 只证明没编没缺；
  五条判据：可操作 / 特异性（换书名还成立=没抓到本书）/ 非梗概 / 状态落纸 / 失败边界具体。
- **dissect_brief 新增「怎么算拆完」**：明确「字段齐全 / 引文能搜到 / 审计通过」不算合格；
  mind 卡须有一句「检验方法」。
- **card_stage 新增读没读的形状警告**：缺证据段、证据无章号（只有简介）、
  mind 缺「设计决策」或「检验方法」、craft 缺「写法」——只是形状，真读仍需人判。
- **card_accept 回执新增「判断面」**：机械审计只证明没编没缺；要求回答「这张卡最可能失效的地方」。
- **library_audit 输出分两面**：机械面（引文/章号/占位）+ 判断面（脚本核不了）；
  结尾固定「机械面通过 ≠ 卡能用」；新增「疑似设定复述」标记（mind 缺设计决策与检验方法）。
- **QualityPolicy 新增** `cardJudgmentLine()` / `cardJudgmentBlock()` / `CARD_JUDGMENT_CRITERIA`。

## 上一版（0.15.4）· 拆书库实测修复（导入编码 / 查询分词 / 卡审计）

> 来源：实际拆 20 本、63 张卡的运行记录。只修跑出来的问题，不扩功能面。

- **导入编码**：`library_import` 不再一律按 UTF-8 读。严格 UTF-8 校验失败时回退 GB18030
  （含 UTF-16LE / BOM 处理），回执显示「编码：gb18030（已转换）」。
  实测：GBK 源书不再整本乱码，省掉手工 iconv。
- **路径兼容**：`file` 支持 MSYS 风格 `/d/foo/bar.txt` 与带引号路径，自动归一化为
  `D:/foo/bar.txt`；读失败时错误信息带上「已尝试路径」，不再只有一句 file_read_failed。
- **查询分词**：`library_search` / `library_combo_suggest` 的 query 按空格、逗号、顿号、
  分号、加号切词，多词=同时满足，并给多词覆盖加成。
  修的是实测 bug：原来整串当一个子串匹配，「都市高武 神话」永远 0 命中，
  两个不同 query 返回同一个组合包。
- **标签精确过滤**：`library_search` 新增 `tag`（如 战斗 / 都市高武 / 信息投放），
  只按标签取卡，不受正文关键词噪声影响。
- **索引自动对齐**：工具首次访问库时，用卡文件回填 index 的 tags / axis / title / updatedAt，
  避免「改了卡、索引还是旧标签」。每进程只跑一次。
- **新增 `library_audit`（诊断旁路）**：逐卡检查
  ① 证据引文能否在原文核对（归一化去标点后比对，省略号分段）；
  ② 证据标题章号 vs 引文实际位置（多数票，≥2 票才判）；
  ③ readingRange 是否仍是「见拆书简报」占位；
  ④ mind 卡是否把 infoStaging 写成剧情分段、pressureMachine 没写「谁逼谁」、卖点过短。
  只诊断不改卡；`card_accept` 采纳时也会跑一遍软审计并把警告写进回执。
- **工具数**：46 → 47（enable 回执、面板文案、smoke 断言同步）。

## 上一版（0.15.3）· 按需启用 + 面板多项目

- **作品目录可见化**：新增 `worksRoot`（或 `DSH_ZHIZHANG_WORKS`），作品直接落在
  `<worksRoot>/<书名>/`（meta/chapters/candidates），不再是隐藏的 `<base>/works/`；
  索引与面板摘要记录 works 路径。本机默认布局见 `cordis.patch.yml`（D:/织章）。
- **本地书源目录**：新增 `sourceRoot`（或 `DSH_ZHIZHANG_SOURCE_ROOT`）指向一个书文件夹；
  `library_list` 列出该目录的 `.txt/.md`（已导入/未导入），`library_import` 可用裸文件名导入；
  面板 Library 区显示待导入数量与文件名。只读扫描，不自动导入。
- **拆书库复用**：新增 `libraryRoot` 配置（或 `DSH_ZHIZHANG_LIBRARY`），把 `library`
  指到共享目录；`works / manuscripts / inspiration` 仍按项目隔离。工具与面板读取同一份库。
- **面板多项目**：工具在 `ensureStorage` 时把工作区登记进 `$DSH_HOME/zhizhang-projects.json`
  （只存指针 + 时间，不复制正文）；面板新增 **项目下拉**（`GET …/projects`），
  顶栏 `项目 ▸ 作品` 两级切换。`?base=<项目 id>` 只接受**已登记且存在**的根，
  未知根一律 `400 bad_base`——面板不会退化成任意路径浏览器。
  - 项目摘要（作品数 / 章节 / 字数）每次都从各项目自己的 `.zhizhang` 现算（5s 缓存），
    可重算、可删索引、**不再是权威副本**；项目不可达时保留 `exists:false` 行并标「不可达」。
  - 采纳 / 读章 / 读候选 / 统一整理都跟随面板当前项目（POST body 的 `base` 字段）。


- **按需加载**：profile 挂载只注册一个 `zhizhang_enable`（+ 只读面板 HTTP），
  **不再**每会话注入 46 个工具与 SYSTEM_BRIEF。
  - 触发后按 **Agent 作用域** 挂载 46 tools + 硬规则；仅该会话可见
    （宿主不支持作用域时退化为进程内全局）。
  - 同一 Agent 重复调用幂等；换会话 / 重启后需重新启用。
  - Web 面板仍常驻（读正式章 / 候选 / 真采纳），不依赖工具启用。
- **版本**：`src/lib/version.ts` 单源 `PLUGIN_VERSION`；package / ProductMap / Scheduler / EditPort /
  MultiDraftPort / 面板页脚都引用它（测试断言 0.15.3）。
- **面板视觉**（`src/client/client.js`，只动样式与结构，不动语义）：
  - 颜色全部由 `currentColor` 经 `color-mix()` 派生（`--zz-line / --zz-surface / --zz-muted / --zz-accent …`），
    跟随 DSH 明暗主题自动适配；去掉硬编码明暗两套色值。
  - 阅读器：中文段落 `text-indent:2em`、衬线字体、`text-wrap:pretty`、正文列居中；工具栏 `position:sticky`。
  - 章节列表：标题单行省略（`title` 悬停看全）、字数右对齐、选中左侧竖条；窄栏（≤1100px）隐藏字数让标题呼吸。
  - 候选对照：工具栏显示只读身份 chip（`「稿名」id · 字数 · lint`）——**不新增采纳入口**。
  - 无待采纳时「本章闸」的 lint 行改中性色（`zz-gate-idle`），不再误标红。
  - 骨架屏 `.zz-skel` + `@keyframes zz-shimmer`；Library 书源改自适应网格；`prefers-reduced-motion` 关动效。
  - 可访问性：tab `aria-selected`、章节 `aria-current`、候选行 `role=button`+Enter/Space、
    `zz-err`/`zz-ok` 加 `role=alert/status`、`:focus-visible` 焦点环、确认框复选框 `accent-color`。
  - 断点：≤1100px 两栏（右栏整行）、≤720px 单栏（左栏 40vh / 中栏 56vh）、≤520px 收边距。

## 此前（0.15.2）

- **按需启用**：profile 挂载只注册 `zhizhang_enable` + 只读面板 HTTP；触发后按 Agent 作用域
  挂 46 tools + 硬规则。回执直接带 `ProductMap.formatForAgent()`，省一次往返。

## 此前（0.15.1）

- **工程加固（不改默认链 / 不改旁路表）**：
  - **id 沙箱**：章节 / 候选 id 统一在 store 校验（禁 `/`、`\`、`.`、`..`、控制字符、Windows 保留名；允许中文），
    工具与 HTTP 同源；新错误码 `bad_id`。`candidate_stage` / `chapter_save` / `chapter_read` 等全部覆盖。
  - **面板轮询降载**：`GET …/snapshot` 默认**不**返回 HTML（显式 `?html=1` 才带）；
    候选 `wordCount` 在 stage 时落盘（旧数据回退读正文）；章节透镜按 mtime+size 缓存；
    候选正文按 id 加载，不再每 6s 重拉。
  - **面板根对齐**：HTTP 面板跟随最近一次 Agent 工具使用的存储根（`last-agent-tool`），
    不再固定读宿主 cwd（之前会「工具写 workspace、面板看 profile」两套根）。
  - **Web 修复**：切章清空旧正文/标题；snapshot 的 `ok:false` 不再被当成空态；
    `load` 加请求序号防乱序；采纳后强制刷新（防「已采纳仍显示待采纳」导致二次采纳）；
    采纳超时后自动对账；候选轮询不再丢失阅读选区；剪贴板 Promise 兜底；`escapeHtml` 补 `'`。
  - **包**：新增 `scripts/smoke.mjs`（`npm run smoke`，node ≥22，无需 DSH/bun）；
    补 `types`；移除指向不存在源码的 `build/prepare/typecheck/test` 脚本与 devDependencies
    （本目录是发行形态，构建请回源码仓）。
- **版本**：package / ProductMap / Scheduler / EditPort / MultiDraftPort 统一 **0.15.1**。

## 此前（0.15.0）

- **统合切片**：COGNITION/MAP/PORTS/PANEL/STATUS/FRAMEWORK/README 与 package / ProductMap / Scheduler / EditPort / MultiDraftPort 全部钉 **0.15.0**。
- 面板↔工具：snapshot nextHints 含编辑稿/多草稿提示；panel-html 展示 draftLabel/unifyOf；右栏编辑抉择说明卡。
- 前端美化：工作台层次、阅读区、模式切换、空态/徽章（同主题变量）。
- **不改**：默认链；multi-draft 默认关；无 Tiptap；无静默写章；audit 不进默认链。

## 此前（0.14.0）

- **可选多草稿 + 统一整理（默认关）**：`PortConfig.multiDraftEnabled` / 插件 `multiDraft.enabled` / env `DSH_ZHIZHANG_MULTI_DRAFT=1`。
- 同章可多次 `candidate_stage(draft_label)`（关着也能 stage）；`unify_brief` / `unify_stage` 须开启。
- 整理稿 `source=unify` + `unifyOf`；仍走 lint → accept；**不进默认 nextHint**。
- 面板：列出全部待采纳标签；开启后「统一整理」→ `POST …/unify/prepare` 只返回 brief。
- 默认链负重与 0.13 相同。

详见 [PORTS.md](../PORTS.md) · [TOOLS.md](../TOOLS.md) · [PANEL.md](../PANEL.md)。

## 此前（0.13.0）

- **小说阅读工作台（默认）**：三栏（章节 / 正式章正文 / 状态与闸）；轻量 MD 只读；候选对照；`localStorage` 记作品+章。
- **按需读正文**：`GET …/chapter`、`GET …/candidate`；snapshot **仍无**全文。
- **管线五 Tab** 保留为顶栏「管线」次级视图。
- **真采纳**不变（confirm + AcceptPolicy）。
- 当时未做：Tiptap、页内起草、面板 A/B/C、静默写库。


## 此前（0.12.0）

- 完整 Web 控制台五 Tab + 真采纳 + 自动刷新 + settings 卡。
- `GET …/library`、`GET …/inspiration`；HTML 对齐。

---


## 总则

| 可以 | 不可以 |
|------|--------|
| 改 Port 实现或 `PortConfig` | 在工具 `execute` 里新写 if-硬闸 |
| 给 Gate 加可选 flag（默认软） | 把禁词命中默认升级为硬拒质量法 |
| 扩展 MethodRegistry 资产 id | 把整包方法灌进 `SYSTEM_BRIEF` |
| 经 Audit 端口换传感器实现 | 让 AI / bash 直写 `chapters/` / `library/cards/` |
| 扩展 Library / Inspiration 契约 | 用 foundation notes 假装技法卡已入库；静默 foundation_set |
| 改 Scheduler 默认线/旁路表 | 在工具里另写一套「推荐链」绕过 Scheduler |

契约类型：`GateDecision`（`ok` + `messages[]`；`ok===false` 须硬拒）。

---

## 改哪里（按意图）

| 你想改的 | 打开 |
|----------|------|
| 默认路径 / 旁路表 / 回执下一步 | `ports/scheduler.ts`（再确认 ProductMap / SYSTEM_BRIEF 引用它） |
| 产品地图叙事 / 三阶段交接文案 | `ports/product.ts`（闭环句 ≡ Scheduler.defaultLine） |
| 质量面文案 / 毒点政策 / 书债线索 | `ports/quality-policy.ts` |
| 拆书双轴 / 准入 / combo / lean 卡块 | `ports/library.ts` |
| 灵感分喂 / forge / apply | `ports/inspiration.ts` |
| Accept 组合顺序与旗标默认 | `ports/accept-policy.ts` + `ports/config.ts` |
| 写后可选编辑 / A·B·C | `ports/edit.ts` + `tools/candidates.ts`；技能 `docs/skills/web-novel-master-optimizer.md` |
| 各闸软硬行为 | `*-gate.ts` |
| lean/full 方法包列表 | `ports/methods.ts` + `method-assets.ts` |
| 常驻硬规则短文 | `tools/brief.ts`（`SYSTEM_BRIEF`；保持短，细节指 product_map） |
| 当前小说状态 / happened 对齐 | `ports/foundation.ts` + `tools/candidates.ts`；读者合同 `method-assets.ts` |
| 库准入（声纹假阳） | `ports/library.ts` `admitCardContent` / `neutralizeVoiceNegations` |
| 工具名与参数壳 | `src/tools/*`（只接线，不藏策略） |
| 落盘路径与原子写 | `lib/store.ts`（谨慎；DATA.md 同步） |
| 面板 UI / HTTP | `src/client/client.js` + `lib/panel-html.ts` + `lib/http-api.ts`；见 [PANEL.md](../PANEL.md) |

Compose 入口：`src/index.ts` 只注册工具 + apply，不塞业务 if。

---

## 新能力怎么挂

1. **先定端口**：新策略 → 新 Port 或扩展现有 Port；导出挂到 `ports/index.ts`。  
2. **工具薄接**：`defineTool` → 调 Port → 回执引用 `Scheduler.nextHint(...)`。  
3. **地图/硬规则**：若改变「怎么跑」，更新 Scheduler（及必要时 SYSTEM_BRIEF 一句指针）。  
4. **测试**：一条**契约套件**，不是 N 条句子测试。  
   - 产品叙事（闭环句、分喂、互指）→ `test/contracts/product-loop.test.ts`  
   - 调度默认/旁路 → `test/contracts/scheduler.test.ts`  
   - 闸/传感 → `test/gates/`  
   - 支柱工序 → `test/pillars/`  
5. **断言偏好**：hit code / 硬拒 code；少绑中文长句；金样放 `test/fixtures/`。  
6. **禁止**：为 SYSTEM_BRIEF / dissect 新加的一句单独开 `test()`。  
7. **版本**：只改 docs → 可不升版；动契约/默认行为 → 升小版并改 `package.json` + STATUS + ProductMap/Scheduler `version` 对齐。  
8. **打包**：用户不主动要 zip **就不打包**。

---

## 改完自检

```bash
# 源码仓：
bun test
npm run typecheck
# 需要 dist 时再 npm run build

# 本发行包：
npm run smoke
```

确认：默认链仍最短合格；旁路仍显式；mind/craft 分喂未破；雷达默认仍软。

---

## 0.11.1

- **编辑深度优化（仍可选）**：`polish-depolish` brief / MODE_INFO 正向写成「保留呼吸与毛边」；明确去AI味 ≠ 磨成范文齐句；禁止为去味熨平句长、主语砍光。
- **技能** `web-novel-master-optimizer` 对齐同一口径；齐刷短句优先退回写手或换 `polish-rhythm`。
- **edit_stage 软提示**：对人味 `uniform_short_run` 等挂回执（不阻断 A/B/C）。
- A/B/C 契约不变；写手 lint 后仍可直 accept。
- 版本号与 ProductMap / Scheduler / EditPort `version` 对齐 **0.11.1**。

---

## 0.11.0


- **写后可选编辑**：`port.edit`；默认模式 `polish-depolish`；链上 lint 后可选 edit_brief→edit_stage→用户选 A/B/C。
- **路径 A**：一次确认 `confirm_accept_after_edit` = 应用编辑 + accept；未确认硬拒；未表态按 B；禁止静默验收。
- **反僵硬**：拆书 craft 抽打碎逻辑 + 本书载体；`allowedEdges` 应落纸；lean 一行正向；`stiffness_tidy` 默认 warn（非脏话配额）。
- **连续性**：lean n≥2 注入前章正文全文；对外「当前小说状态」。
- 版本号与 ProductMap / Scheduler / EditPort `version` 对齐 **0.11.0**。
- 更早的 0.10.x 独立变更归档未包含在当前仓库中。

