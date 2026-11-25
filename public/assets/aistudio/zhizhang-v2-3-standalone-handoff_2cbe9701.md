# 织章（`dsh-zhizhang`）v2.3 番茄长篇升级独立施工文档

> **自包含交付说明**：本文档完全自包含，不依赖任何外部参考包。所有需要合入的新增方法论正文、题材节奏表、审改标准、TypeScript Schema、核心算法、精确文件路径与验收门禁均已完整内嵌在本文中，研发或编码代理拿到本文档后即可直接在 `ouzx6696-cmyk/dsh-zhizhang` 仓库中按序施工。

## 1. 项目基线与升级目标

### 1.1 当前仓库基线（升级过程中严禁倒退）

* **形态与架构**：`ouzx6696-cmyk/dsh-zhizhang` 为四层 Monorepo（L0 `@zhizhang/core`、L1 `@zhizhang/ui` + `@zhizhang/workbench`、L2 `@zhizhang/fanqie` + `@zhizhang/toutiao`、L3 `apps/desktop`），支持 Electron 桌面主应用与 Node HTTP/SSE 本地 Web 预览（`0.0.0.0:3000`）双宿主运行，统一磁盘格式为 `zhizhang/2.0`。
* **必须守住的核心优势**：
  * 柔和纸面 C2 无顶栏三栏工作台、`DraftCompare` 双稿纸行内 diff 逐处采纳（Cherry-pick）与撤回、`bible/pending.json` 待确认池、`plan/proposals/<runId>/` 提案隔离。
  * `atomicWrite` + `LockService` + `commitIntent` 崩溃重放、全量 `@zhizhang/core/schema` 校验、可暂停/恢复/预算可控的 `executePipeline`、修稿未过门禁自动回退上一合规稿。
  * 拆书（`novel_scanner.py` + `quote_check.py`）→ 交互式技法仓 → L2/L6 注入、并行多路起稿 + AB/BA 换位盲评、段落级 diff 个人文风学习（`learning/diff.ts`）与今日头条双业务线。

### 1.2 本次 v2.3 要补齐的 6 项核心短板

1. **番茄快爽方法论补强（T1，P0）**：当前 `packages/fanqie/profiles/default/` 偏通用稳推，缺少 6 大题材节奏指南、一阶/二阶 AI 腔对照治理、番茄快爽打脸 5 项专属审改与移动端快爽片段走读。
2. **轻量单点写作入口（T2，P0）**：缺少「仅去 AI 腔润色」与「半章断点续写」轻入口，小改或续写被迫走重型整章流水线。
3. **跨全书单实体时间线回查（T3，P1）**：缺少按关键词跨 `bible/` 与正文一键拉出人物/物件/伏笔全书演变时间线的 `trace` 能力。
4. **连载存稿运营指标（T4，P1）**：缺少按日更字数换算的「连续可发存稿字数、可发天数与缺口后零散定稿预警」。
5. **旧书半路接管导入（T5，P1）**：缺少把作者已有 `.txt` 全书或分章文件夹一键导入 `zhizhang/2.0` 并引导体检/补账的接管入口。
6. **多分支候选接续链与设定集降噪（T6，P2）**：缺少沿未定稿候选稿（如 B 稿）连续试写多章的 `derivedFrom` 指针管理，以及定稿记账提案的三向沉降分类。

## 2. 必须严格遵守的工程红线（`AGENTS.md` & `scripts/guard.mjs`）

1. **受保护业务规则禁改**：
   * 番茄章节状态词表：`planned` / `drafting` / `drafted` / `reviewed` / `final`。
   * 编辑打回轮次上限：`MAX_EDITOR_REJECTIONS = 2`。
   * 头条规则源 `packages/toutiao/skill/scripts/rules.py`（`TITLE_MAX = 34`、`PASS_SCORE = 84`）与交稿固定末句严禁改动。
   * **作者是裁判**：所有正文采纳、逐段合并、定稿、设定落盘必须由作者显式触发；写作助手（`assistant` 角色）严禁获得直接修改正文或设定集的工具。
2. **零 1.x 兼容**：所有新数据结构严格归属 `zhizhang/2.0`，旧稿导入统一转换为 `zhizhang/2.0`，不新增任何旧格式兼容分支。
3. **静态守卫零违规**：
   * `[G-core]` / `[G-layer]` / `[G-facade]`：`@zhizhang/core` 禁业务词；`@zhizhang/fanqie` 与 `@zhizhang/toutiao` 零互引；跨包仅经 `package.json` `exports` 导入。
   * `[G-error]` / `[G-type]` / `[G-exports]`：零裸 `throw new Error(`（一律用 `AppError` + `CODES`）；`any = 0`、`! = 0`、`!: = 0`、`unusedExports = 0`、`as` 断言数不得高于 `scripts/any-baseline.json` 基线（`116`）。
   * `[G-size]` / `[G-copy]` / `[G-css]` / `[G-docs]`：单个 `.ts` / `.tsx` / `.css` 文件严格 **≤ 400 行**（超行须按职责拆分）；全仓 `.tsx` 零 JSX 中文硬编码（文案统一入 `@zhizhang/ui/copy`）；非令牌 CSS 禁十六进制色，`--zz-decide` 仅用于作者裁决；核心文档总数保持 **≤ 8 份**。
4. **资产与测试红线**：修改 `packages/fanqie/profiles/default/` 后必须执行 `npm run assets -- manifest && npm run assets -- check`；测试统一注入 `test/support/clock.mjs` 与 `test/support/fake-port.mjs`，严禁真实 `sleep` 或未经书面批准调用付费模型。

## 3. T1（P0）：升级番茄默认方法论与 `stage-map.json`

### 3.1 改动文件清单

* `packages/fanqie/profiles/default/prose.md`（追加 3.2 节内容）
* `packages/fanqie/profiles/default/edit.md`（追加 3.3 节内容）
* `packages/fanqie/profiles/default/genres.md`（新增文件，全文见 3.4 节）
* `packages/fanqie/profiles/default/examples-write.md`（追加 3.5 节内容）
* `packages/fanqie/profiles/default/profile.json`（在 `methods` 数组中登记 `genres`）
* `packages/fanqie/profiles/default/stage-map.json`（按 3.6 节更新）
* `assets/manifest.json`（执行 `npm run assets -- manifest` 自动更新）

### 3.2 直接追加至 `packages/fanqie/profiles/default/prose.md` 的完整正文

以下内容直接作为新章节追加到 `prose.md` 末尾，用于补齐「一阶 + 二阶 AI 腔」双层防治：

```markdown
## 六、一阶与二阶 AI 腔双层诊断对照

去 AI 腔的目标是让文本更像这本书自己的作者，而不是把所有网文一律改成极简短句或删光心理。必须同时警惕两层病灶：**一阶 AI 腔**（空泛抒情、播报总结、机械排比）与**二阶 AI 腔**（模型被要求“克制、用动作代替情绪”后矫枉过正，滑向另一套同样机械的冷硬套路）。

### 6.1 一阶 AI 腔高频病灶

| 原稿表现 | 修改方向 |
| --- | --- |
| “经过一番交涉，他终于同意” | 展开最关键的要求、对方能核实的依据、让步条件与最后决定 |
| “众人震惊，纷纷倒吸冷气” | 挑 1–2 个利害相关者，写其撤回报价、改口、换站位或失态动作 |
| 大量形容词宣布情绪，随后再总结意义 | 留最贴近视角人物的动作、感觉、物件或一句自然心理；场面已表意即收住 |
| 连续“不……而是……”“他没有……”机械排比 | 回到动作发生顺序，合并重复意思，把停顿留在真正迟疑处 |
| 人物对白全像讲道理 | 改成该人物此时会说的话，明确各自目的、职业、称呼与潜台词 |
| 句长过度整齐、段段等长 | 按视角、动作、情绪和语气交错长短句与分段，保留有意重复 |
| 视角漂移 / 观察泛化 | 明确信息来源，只写当前视角人物因职业与处境会注意到的具体细节 |

### 6.2 二阶 AI 腔（过度“克制”后的新套路）

强模型在规避一阶 AI 腔时，常走向反面，把“少形容词、多动作”执行成冷硬模板，同样会立刻暴露机翻感与同质化：

| 原稿表现 | 问题本质 | 修改方向 |
| --- | --- | --- |
| 满屏冷硬极简短句，句句主谓宾、毫无语气起伏 | 为避“啰嗦”砍光人物声音，读起来像行动日志或审讯笔录 | 恢复视角人物的口语节奏、吐槽、轻重缓急与长短句交错 |
| 机械微动作套组（指节发白、喉结滚动、瞳孔微缩、空气安静两秒、嘴角勾起弧度） | 把“动作代替情绪”误当成贴固定生理标签，比直接写情绪更假 | 删掉通用生理反应，改写与当下处境和利益直接挂钩的举动，或写一句自然心理 |
| 舞台剧指示感（起身→踱步→停住→转身→抬眸看他） | 像导演走位脚本，动作密集却不推进因果或信息 | 只留改变站位、距离或局势的关键动作，其余直接用对白和选择推进 |
| 每段结尾硬塞物件定格/冷意象（杯口热气散了、窗外车灯扫过、烟灰掉在桌面） | 机械模仿电影空镜，频繁打断网文追读气口 | 物件定格只留在情绪或节奏真正需要停顿的节点，冲突推进中直接接下一动 |

### 6.3 活人感改写示范

- **一阶改写**：把“众人都被她的能力震惊了”改为“账房把拆解单翻了个面，低声问：‘主事，还按废石的价算？’”。
- **二阶改写**：原稿“他喉结滚了一下。指节捏得发白。空气安静了两秒。窗外车灯扫过桌面，茶已经凉了。”→ 改后（恢复活人感与处境利益）：“他盯着报价单最下面那个零，半天没签字，最后直接把笔帽合上，推回对方手边：‘这单我不接。’”
- **视角与声音自适应**：原稿“她感到无比失落，仿佛世界都失去了颜色。”——若原书克制，可写“她把第二副碗筷收回柜里，锅里的面多煮了一分钟”；若原书偏心理叙事，也可以写她突然想起自己早已记住了对方的口味。动作替代情绪不是一刀切命令。
```

### 3.3 直接追加至 `packages/fanqie/profiles/default/edit.md` 的完整正文

以下内容直接追加到 `edit.md` 末尾，用于补齐番茄快爽打脸专属审改与双稿盲评底线：

```markdown
## 七、番茄快爽与打脸文五项专属审改

审改快节奏爽文或打脸章节时，除基础四类硬伤与 L1–L3 外，必须重点核验以下五点：

1. **打脸前压抑是否到位**：对手的依仗、苛刻条件和主角眼下的具体损失是否写清？若反派只放两句空炮就被秒，爽感发飘；但压抑也不宜拖过 1–2 个回合，避免读者烦躁弃书。
2. **反杀证据是否现场可核验**：翻盘靠的是前文铺过的底牌、当场可验的实物/数据/权限/纸面条款，还是临时天降神力或对手突然降智自爆？
3. **利害者反应是否落到实处**：打脸瞬间是否紧盯最受影响的 1–2 个具体人物改口、撤价、失态或吃瘪，而不是只写一排路人集体惊叹？
4. **兑现后是否拖沓说教**：胜负已定、实利落袋后是否干脆收口或抛新钩子？删掉主角对着败者长篇讲大道理、复盘自己多聪明的冗余段落。
5. **快爽张力与暗线收口**：打脸前是否留出半步真实受压或险招，避免全程零阻力顺风秒杀导致张力发虚？单单元内埋下的暗线、单据与筹码，须在收口前回收兑现，不留悬空伏笔。

## 八、双稿盲评裁决口径

使用同一章纲、锁定事实与上下文对 A/B 两稿隐藏来源盲评：
- 先分别检查因果、证据、知情边界与连续性，再比较追读力、卖点兑现、对手压迫、关键现场、声音与表达。
- 必须指出各稿至少一处真正决定胜负差距的原文片段，再给出胜稿、平局或双稿均须修订的结论。
- 采用 1–5 分制评分时，**连续性低于 3 分的稿件不得判胜**；评分仅是编辑判断的表达，不能替代原文证据分析。
```

### 3.4 直接新建 `packages/fanqie/profiles/default/genres.md` 的完整正文

直接将以下完整内容写入新文件 `packages/fanqie/profiles/default/genres.md`（写入文件时将标题层级提升三级，使首行为 `# 题材与节奏指南`）：

#### 题材与节奏指南

按 [创作原理](principles.md) 的四种节奏理解本表。题材与节奏是参考搭配，作者可以调整。

表中每一行回答三个实际问题：读者为什么追读，第一场可以怎么写，后续重点把什么写实。

##### 仙侠、玄幻与西幻

| 题材与参考节奏 | 读者想看什么 | 可直接开写的场面 | 后续写实的重点 |
| --- | --- | --- | --- |
| 东方仙侠 · 快爽 | 跨过一个境界，从前够不着的人和地方忽然够得着。 | 从拜师、宗门月例、秘境开闭这类具体营生切进去。懂行的人看一眼气机，说破境界与破绽，一招验证。 | 让境界、战力、资源限制和每次突破的验证对应起来。 |
| 传统玄幻 · 快爽 | 被所有人看低的人当众站起来，比他们想的更高。 | 家族大比、宗门试炼、拍卖这类当众场合，让看低他的人在场。 | 对手根据前一次结果调整打法；越级获胜有已建立的依据与代价。 |
| 玄幻脑洞 · 快爽 | 设定揭开一层，前面看过的东西全有了新意思，主角借规则漏洞当场反杀。 | 首场只亮一条核心规则和一个死穴，立刻在被轻视或被算计的现场用它翻盘。 | 用连环事件逐步剥开规则与越级解法，前后能力逻辑自洽，不靠事后打补丁。 |
| 西方奇幻 · 稳推 | 走到地图边缘，看见没人见过的东西，学会一个新法术。 | 从旅途、公会、法术学习的一个具体场面进入。力量体系和用词与世界观统一，中西词汇混不混由作者定。 | 统一世界观、用词和施法条件；种族与角色有各自利益。 |
| 长生日常 · 慢燃 | 多年后回到旧地，有人还认得他，有人已经不在。 | 落一门营生（打铁、行医、殡葬、小吃摊）和一条街坊。情绪高处用处置一件旧物来写。 | 写时间对身份、人际关系和旧物的改变，也写不老带来的实际问题。 |

##### 都市

| 题材与参考节奏 | 读者想看什么 | 可直接开写的场面 | 后续写实的重点 |
| --- | --- | --- | --- |
| 都市大类 · 稳推 | 饭局、工位或家里，一句话一个决定，把关系里的位置换过来。 | 从房租、通勤、饭局、一条微信这类日常压力切入，主角当场做一个决定。 | 收入、居住、消费和职业行为与人物处境一致。 |
| 都市日常 · 慢燃 | 一件小事办妥，熟人之间多了一点不用说的默契。 | 邻里、菜市场、快递驿站、换季过节里的一件小麻烦。情绪高处用处置一件物来写。 | 小麻烦、熟人关系和生活节奏自然推进；结尾按生活本身收束。 |
| 都市种田 · 稳推 | 地里、店里第一次出了东西，日子肉眼可见地变好。 | 看一眼土、货或账，说一句行话，动手做给人看。 | 写清资源来源、工序、产出与实际用途，重点展开决定结果的步骤。 |
| 都市脑洞 · 快爽 | 摸清规则的一个漏洞，用常人看不懂的操作当场翻盘落袋。 | 首章落在催租、被辞、二手交易、酒局或夜宵摊等具体窘境，只亮一条核心规则，当场验出第一笔肉眼可见的收益或打脸结果。 | 规则限制与消耗持续生效，每次奖励立刻换算成钱、身份或局面反转，不空攒面板数字。 |
| 都市修真 · 快爽 | 世俗眼里的难题或看低，被修真手段降维戳穿，两种生活当场相撞。 | 从合租、相亲、鉴宝、医馆或职场排挤切入，对手按世俗规矩立高门槛，主角用修真眼力或小术一招破局。 | 修真手段直接改变现实处境并引出隐藏圈层，世俗身份与因果也持续反过来约束主角。 |
| 都市高武 · 快爽 | 一次越级出手被记分板和身边人同时看见。或没人看见的守护被一个人看见。 | 校园、考核、集训、小队，一位带伤的前辈。考核后尽快接上第一次真实的血。 | 清楚展示战力层级、考核表现和真实交锋的关系。 |
| 战神赘婿 / 身份打脸 · 快爽 | 看低他的人把话放绝、把门堵死后，发现自己得罪了最惹不起的底牌。 | 家宴、岳家、寿宴或酒局，先让对手当众定下苛刻条件或羞辱，再通过一通电话、一份批文或大人物到场当场反转。 | 每次亮底换一种筹码与利益冲突，重在写反派与墙头草的具体改口与代价，避免千篇一律跪地求饶。 |

##### 历史、权谋与谍战

| 题材与参考节奏 | 读者想看什么 | 可直接开写的场面 | 后续写实的重点 |
| --- | --- | --- | --- |
| 古风权谋 · 稳推 | 一封信、一道折子、一句话，满盘局势翻过来。 | 一次可核验的推演，再让最懂行的那个人失态改口。 | 各方按自己的位置和信息推算，让制度与利益真正影响选择。 |
| 历史大类 · 稳推 | 在时代的真实限制里，用对的办法把一件难事办成。 | 一次可核验的推演，让最懂行的人失态改口。制度通过人物的行动出现，写交税那个场面，不写“当时实行某某法”的旁白。 | 时代、制度和器物统一；不确定的史实在规划中标为未核。 |
| 历史脑洞 · 快爽 | 一件现代东西或想法在古代第一次落地并起效。 | 同历史大类，推演可核验，懂行者失态改口。 | 现代办法受材料、制度与当事人利益影响；古人会主动判断。 |
| 抗战谍战 · 稳推 | 情报送到的那一刻，和为它付出的具体代价。 | 一次接头、一道城门盘查、一台电台，写清东西经谁的手、会被谁截。 | 写清信息经谁的手、怎样被核实，以及人物实际承担的代价。 |

##### 悬疑、科幻末世与游戏

| 题材与参考节奏 | 读者想看什么 | 可直接开写的场面 | 后续写实的重点 |
| --- | --- | --- | --- |
| 悬疑刑侦 · 稳推 | 一条线索推翻表象，真相比想的更近、更痛。 | 勘查、物证袋、监控回放。推理写成“看到甲、想到乙、验证丙、得出丁”，一步不跳。 | 从已知证据到推论再到验证逐步推进；结论只到证据支持的范围。 |
| 悬疑灵异 · 稳推 | 未知第一次露出一角，冷意从背上爬上来。 | 第一次出事就立一条规矩，由懂行的人一句冷话点明。每个案子落一门营生或忌讳（红白事、老宅、香烛、风水），写成人物所信。 | 把怪异与人物所信、行当、忌讳相连，让未知通过具体后果出现。 |
| 悬疑脑洞 · 叠档 | 看穿规则的设计意图，反将一军。回头看，答案一直写在原话里。 | 首章第一个死亡就是第一条规则。 | 规则提前建立，人物按动机行动，用已见证据解释破局。 |
| 科幻末世 · 快爽 | 在崩坏的世界里守住一小块能活下去的地方。 | 很快给出倒计时或能源、额度读数，并当场验一次。物资写成账，缺口当场卡住行动。 | 能源、物资、时间与能力读数实际限制行动。 |
| 末世囤货／安全屋 · 快爽 | 灾前被嘲笑的准备在灾后全成了救命硬通货，白眼狼上门求援被当场拒之门外。 | 灾变倒计时加高密度囤货清单与极品邻居/亲戚的嘲讽铺垫；清单留一项变量或缺口，作为灾后首轮冲突引子。 | 囤货账目与消耗清晰，灾后反杀紧扣旧账回扣与物资议价权，内外处境彼此牵动。 |
| 游戏体育 · 快爽 | 关键一局最紧的时候，练过的东西用出来了。 | 赛事目标与结算先说清。一句解说式行话点出局面，再写这一操作的三步。 | 明确比赛目标、得分和对手应对；展开决定胜负的操作。 |

##### 女频与情感

| 题材与参考节奏 | 读者想看什么 | 可直接开写的场面 | 后续写实的重点 |
| --- | --- | --- | --- |
| 都市言情 · 稳推 | 对方第一次为她退了一步，或她第一次不退。 | 初遇或重逢。两人各要什么、什么让他们不能靠近写清。 | 各自目标和靠近的阻力都真实；感情通过选择和相处逐步建立。 |
| 宫斗宅斗 · 稳推 | 算计她的人亲手递出把柄，她只说半句，体面全落在她这边。 | 先定本书争的是位分与圣意，还是管家权、婚事与嫁妆。从请安、宫宴、账册、嫁妆单里的一处破绽进入。 | 让位分、圣意、管家权、财产等具体利益决定对手手段。 |
| 年代七零八零 · 稳推 | 什么都要票的年代，靠手艺和眼光让一家人先吃饱再住好，不落把柄。 | 先定哪一年、哪个地方：那一年什么能买卖、什么算投机倒把，拿不准标“未核”。 | 确定年份、地域和当年的买卖、票证规则；未核史实留待查证。 |
| 大女主事业 / 逆袭 · 稳推或快爽 | 凭真本事亲手拿回被抢走的位置与话语权，曾轻视或背叛她的人回头求她而不得。 | 开篇先写被顶替、被轻视或被断后路的实损，再亮清她进场的硬凭仗（技艺、契约、账目、功绩或规则），首回合当众抢回第一块筹码。 | 逆袭与打脸靠女主自己的眼光、手艺与决断落地，不靠男主代打；利益相关者各有动机。 |
| 快穿 · 快爽 | 进入新世界一眼看清原主的死局，用攒下的本事把命改过来。 | 原主遗愿、任务目标先给清，主角当场认出死局在哪。 | 每个世界的任务、人物关系和资源有差异；长期成长有连续性。 |

##### 新赛道

| 题材与参考节奏 | 读者想看什么 | 可直接开写的场面 | 后续写实的重点 |
| --- | --- | --- | --- |
| 衍生 · 稳推 | 熟悉的人物遇上改变后的局面，做出新的选择。 | 从分歧点切入，原作角色按自己的逻辑回应改变。 | 分别记录原作事实与作者设定的分歧，人物按原有逻辑回应。 |
| 无限流 · 叠档 | 看似必死的副本里找到生路，带着奖励活着出来，下一个更难。 | 每个副本先定给读者的是恐怖、解谜还是人与人的博弈。规则写法同悬疑脑洞。 | 每个副本的规则和回报先确定，结算改变后续处境。 |
| 天幕、读心、直播弹幕 · 快爽 | 屏幕、弹幕或心声精准捅破反派最想藏的底牌，让其在众人面前当场社死或进退两难。 | 先定清“谁能听见/看见、主角知不知情”，首场就让一条外显信息直接拆穿眼前谎言、改变关键人物的当场决策。 | 严格守住知情边界，用弹幕/心声做精准递刀与节奏放大，同时让现实利害行动推进剧情，不沦为纯吐槽集锦。 |
| 领主、历史基建 · 稳推 | 从烂摊子攒出第一批人手和能用的东西，挡住第一个冬天。 | 说清原料从哪来、哪一步会卡住，再写第一次做成。先定主角的知识在这个世界卡在哪一步（材料、工艺、人不信）。 | 资源、人手、工艺和信任决定建设进度，成果在下一轮被使用。 |

### 3.5 直接追加至 `packages/fanqie/profiles/default/examples-write.md` 的完整正文

以下内容直接追加到 `examples-write.md` 末尾（已完全自包含，无外部文件引用）：

```markdown
## 附：番茄快爽核心手艺片段走读与移动端自检

开新书或写关键爽点章时，优先按“快爽打脸”节奏写强反差与扎实反杀；需要长线悬疑、克制情感或第一人称时，再切回稳推/慢燃节奏。只学结构和手艺，不照搬剧情或台词。

### 一、快爽核心手艺八维走读

| 技法维度 | 示范短片段 | 手艺拆解与迁移方法 |
| --- | --- | --- |
| **首屏压势（筹码立冲突）** | “周明远把一沓二十张百元钞票推过玻璃茶几，压在调岗通知书上。‘两千块，现金，不用走报销。’” | 第一句给具体物件、金额与动作，把“抢功＋羞辱＋拿捏软肋”压进首屏，不写三百字背景介绍。 |
| **动作立立场** | “一杠划掉名帖上的‘听候调遣’。” | 第一动作直接拒绝安排，随后的加薪与退押金把立场变成真实代价；身体细节替代简历式交代。 |
| **规则钓鱼反杀** | “既然三哥都说这炉子掺了铅锡不值钱……我拿锤子砸开验验铜色，回头直接卖废品站称斤算了！” | 不与反派嘴炮吵架，顺着反派的谎话做物理动作，逼反派自己掀底牌加价。 |
| **纸面条款钉死** | “旁边还压着一张去年十月签字的《非职务作品确认函》，末尾甲方公章旁边，签着周明远龙飞凤舞的大名。” | 最高级的打脸不是天降大佬救场，而是拿对手当年亲手签下的规则反杀。提前埋好单据、条款或系统边界。 |
| **利害者具体破防** | “门边两个干了七八年的老维修工互相看了一眼，手里的保温杯都忘了拧盖。” / “门口卖糖画的老张拿勺背敲了敲铜锅沿：‘刚才谁说有人开到三万就倒立出门来着？’” | 禁用“众人震惊、倒吸冷气”。挑有具体职业和利害关系的旁观者，写其动作停顿、改口、哄笑或利益重算。 |
| **系统面板克制写法** | `【交易标的：……】` 每次仅 3–5 行核心字段（底价、瑕疵、剩余次数），正文单段均长 40–50 字。 | 面板只放改变当前决策的硬信息，不堆无关属性表；手机竖屏靠短段与动作/对白交替提速。 |
| **章末筹码钩子** | “下周二，省港口冷链一期工程公开招标，总标的四个亿……你拿技术干股，做合伙人。” | 实利落袋后干脆收口，由新建立信任的高位人物抛出更大筹码与新副本，顺手接进下卷主线。 |
| **稳推 / 慢燃 / 第一人称对照** | “漆是软的，直接糊在指肚上。” / 油退到蓝釉线以下 / “我宁可他把椅子踢开，也不想看他这样收拾桌子。” | 稳推靠触感与证据缩小推断；慢燃靠环境物件累积情绪；第一人称靠叙述者偏见与对方外在动作造反差。 |

### 二、移动端快爽写作自检速查

1. **去一阶概括腔**：禁用“经过一番交涉”“众人震惊”“他心中暗喜”“空气仿佛凝固了”，改成具体报价、单据、动作停顿或利害者改口。
2. **去二阶冷硬套话**：不机械堆砌“指节发白”“喉结滚了滚”“瞳孔骤缩”“嘴角勾起一抹冷笑”，按人物性格选带生活气的真实反应。
3. **手机竖屏段长**：快节奏打脸章单段尽量控制在 1–3 行（约 15–80 字），高潮对峙与算账处主动切段留白，避免大段密不透风的文字墙。
```

### 3.6 配置更新（`profile.json` & `stage-map.json`）

1. 在 `packages/fanqie/profiles/default/profile.json` 的 `methods` 数组中新增：

```json
{
  "id": "genres",
  "title": "题材与节奏指南（六大题材适配）"
}
```

2. 将 `packages/fanqie/profiles/default/stage-map.json` 更新为：

```json
{
  "fanqie.book.card": { "take": [{ "file": "overview.md", "maxChars": 2000 }, { "file": "platform.md", "maxChars": 2000 }, { "file": "genres.md", "maxChars": 1500 }] },
  "fanqie.book.foundation": { "take": [{ "file": "plan-foundation.md", "maxChars": 3000 }] },
  "fanqie.book.structure": { "take": [{ "file": "plan-structure.md", "maxChars": 3000 }] },
  "fanqie.book.outline": { "take": [{ "file": "plan-outline.md", "maxChars": 3000 }] },
  "fanqie.chapter.beats": { "take": [{ "file": "scene.md", "maxChars": 2500 }, { "file": "rhythm.md", "maxChars": 1500 }] },
  "fanqie.chapter.draft": { "take": [{ "file": "write-chapter.md", "maxChars": 3500 }, { "file": "prose.md", "maxChars": 2500 }, { "file": "examples-write.md", "maxChars": 1200 }] },
  "fanqie.chapter.select": { "take": [{ "file": "edit.md", "maxChars": 2500 }] },
  "fanqie.chapter.review": { "take": [{ "file": "edit.md", "maxChars": 3000 }, { "file": "continuity.md", "maxChars": 1500 }] },
  "fanqie.chapter.revise": { "take": [{ "file": "revise.md", "maxChars": 2500 }, { "file": "prose.md", "maxChars": 2000 }] },
  "fanqie.ledger.extract": { "take": [{ "file": "continuity.md", "maxChars": 2500 }] },
  "library.dissect": { "take": [{ "file": "library.md", "maxChars": 4000 }] }
}
```

3. **验证**：执行 `npm run assets -- manifest && npm run assets -- check`，并补充单元测试断言 `methodFor(defaultProfile, "fanqie.chapter.revise")` 命中“二阶 AI 腔”、`methodFor(defaultProfile, "fanqie.book.card")` 命中 `genres.md`。

## 4. T2（P0）：轻量「独立去 AI 腔润色」与「半章断点续写」

### 4.1 精确改动文件

* `packages/fanqie/src/pipelines/revise/index.ts`（注意 ≤ 400 行，必要时拆出 `schemas.ts`）
* `packages/fanqie/src/pipelines/chapter/{schemas.ts,stages.ts,index.ts}`
* `packages/fanqie/src/tools/assistant.ts`
* `packages/workbench/src/contract/commands.ts`
* `packages/ui/src/copy/fanqie.ts`
* `apps/desktop/src/renderer/features/workflow/WorkflowStartForm.tsx`

### 4.2 详细规格

1. **独立去 AI 腔 / 润色模式（扩展 `fanqie.revise`）**：
   * 在 `RevisePipelineReq` 新增 `mode: opt(lit("revise", "deai", "polish"))`（默认 `"revise"`）。
   * `mode === "deai"` 时：
     * 无需预先传入 `issues[]`；系统提示词明确锁定“已发生的事件顺序、胜负结果、人物关系、证据链与人名地名一律不得改动”，仅做一阶 + 二阶 AI 腔清除、手机端段落节奏切分与口语活人感恢复。
     * 仅跑单轮修订 + `gateDraft` 硬闸校验，跳过多路重起稿。
     * 产物照常写入 `candidates/<chapterId>/<runId>.md`（及 `.meta.json` 标记 `mode: "deai"`），**严禁覆盖 `chapters/<chapterId>.md`**，交由作者在 `DraftCompare` 中逐段局部采纳。
   * `mode === "polish"` 时：仅做语病、重复词、标点与顺畅度轻润色，改动幅度更克制。
2. **半章断点续写模式（扩展 `fanqie.chapter`）**：
   * 在 `chapterPipeline` 请求 Schema 新增 `continueFromExisting: opt(bool())`（默认 `false`）。
   * 开启时：
     * 读取当前 `chapters/<chapterId>.md` 正文（若无内容则抛 `AppError(CODES.validation, ...)`，拒绝空续写）。
     * 将已有前半段与断点末尾 500 字作为不可篡改前缀注入起稿提示词，要求模型严格承接断点（同一场景、同一视角、同一人称与未完动作）写完后半章。
     * 模型输出后半段后，由代码拼接 `existingPrefix + "\n\n" + continuation` 生成完整候选稿，过 `gateDraft` 后写入 `candidates/<chapterId>/<runId>.md`。
3. **只读助手与前端接入**：
   * `fanqie_start_revise` 与 `fanqie_start_chapter` 透传 `mode` 与 `continueFromExisting` 参数。
   * `WorkflowStartForm.tsx` 为修订面板增加「问题修订 / 去 AI 腔 / 轻润色」三态切换，为写章面板增加「接当前半章断点续写」开关；所有中文标签统一写入 `packages/ui/src/copy/fanqie.ts`。

### 4.3 验收测试

* 在 `test/engine/` 新增用例（使用 `fake-port.mjs` + `clock.mjs`）：
  1. `mode: "deai"` 无需 `issues` 即可跑通，生成候选稿且原 `chapters/C001.md` 字节不变。
  2. `continueFromExisting: true` 拼接前半段与续写段生成完整候选稿；原章为空时抛出规范 `AppError`。

## 5. T3（P1）：单实体跨全书时间线回查（`trace`）

### 5.1 精确改动文件

* `packages/fanqie/src/bible/trace.ts`（新增纯查询模块，≤ 250 行）
* `packages/fanqie/src/bible/index.ts`（导出 `traceEntityTimeline`）
* `packages/fanqie/src/commands/bible.ts`（新增 `traceBibleEntity`）
* `packages/fanqie/src/tools/assistant-insights.ts`（新增 `readonly: true` 工具 `fanqie_trace_entity`）
* `packages/workbench/src/contract/{commands.ts,views.ts}`
* `apps/desktop/src/main/commands-fanqie.ts`（注册 `fanqie.bible.trace`）
* `apps/desktop/src/renderer/features/bible/BibleCenterTabs.tsx`
* `packages/ui/src/copy/fanqie.ts`

### 5.2 详细规格

1. **输入与输出 Schema（`@zhizhang/core/schema`）**：
   * 输入：`{ query: str({ min: 1 }), includeBody: opt(bool()), maxBodyHits: opt(num({ min: 1, max: 100 })) }`（`includeBody` 默认 `false`，`maxBodyHits` 默认 `30`）。
   * 输出 `EntityTraceResult`：
     * `query: string`
     * `matchedEntities`: 命中 `bible/entities` 的实体摘要（`id`, `name`, `kind`, `aliases`）。
     * `events`: 按章号正序（`C001` → `C999`，无章号的全局条目置顶）排列的时间线数组，每项含 `{ chapterId: string | null, source: "entity" | "state" | "knowledge" | "thread" | "chapter_summary" | "body", summary: string, excerpt?: string }`。
     * `truncated: boolean`（当正文命中超过 `maxBodyHits` 时标记）。
2. **检索策略**：
   * 先在 `bible/entities` 按名称与别称做不区分大小写子串匹配，收集关联 `entityId` 与全部别称作为扩展关键词集合。
   * 扫描 `bible/states`、`bible/knowledge`、`bible/threads`、`bible/chapters`，按来源章号/生效章号排序。
   * 当 `includeBody === true` 时，按章号顺序扫描 `chapters/*.md`，提取包含关键词的段落摘录（前后各保留约 40 字上下文，避免输出膨胀）。
3. **只读助手与前端接入**：
   * `fanqie_trace_entity` 标记 `readonly: true`，自动参与只读并发批处理并受 24KB 输出裁剪保护。
   * `BibleCenterTabs.tsx` 顶部增加实体时间线搜索框与「含正文回查」勾选框，结果列表支持点击跳转到对应章节。

### 5.3 验收测试

* 单元测试覆盖：实体别称扩展命中、跨多章状态变更与伏笔回收正序排列、`includeBody: true` 正文摘录与 `maxBodyHits` 截断。

## 6. T4（P1）：连载「可发存稿字数 / 可发天数 / 缺口预警」运营看板

### 6.1 精确改动文件

* `packages/fanqie/src/storage/work.ts`（`WorkMetaSchema` 增补可选字段）
* `packages/fanqie/src/view/snapshot.ts`
* `packages/workbench/src/contract/views.ts`
* `apps/desktop/src/renderer/features/workspace/{dashboard-model.ts,StudioDashboard.tsx}`
* `packages/ui/src/copy/desktop-studio.ts`

### 6.2 详细规格

1. **数据字段扩展（向后兼容 `zhizhang/2.0`）**：
   * `WorkMetaSchema` 增加可选字段：`publishedThrough: opt(str())`（已发布截至章号，如 `"C010"`）、`dailyTargetChars: opt(num({ min: 500, max: 50000 }))`（日更目标字数）。
   * `fanqie.work.settings` 支持读写这两个字段。
2. **精确计算规则（`snapshot.ts`）**：
   * 按章号正序排列全部章节；确定起算点为 `publishedThrough` 的下一章（若未设置或找不到，则从第一章起算）。
   * 从起算点向后连续累加状态为 `final` 的章节，**遇到第一个非 `final`（或缺失章号）立即截断**，得到 `continuousFinalCount` 与 `continuousFinalChars`。
   * 若 `dailyTargetChars` 已配置且 `> 0`，则 `publishableDays = Math.floor(continuousFinalChars / dailyTargetChars)`；否则为 `null`。
   * 截断位置之后仍然存在 `final` 状态的章节，单独收集为 `postGapFinalChapters: string[]`，避免把断档后的零散定稿误算进连续可发存稿。
3. **UI 展示与色彩红线**：
   * 在 `StudioDashboard` 指标区展示「连续可发存稿：X 章 / Y 字（约 Z 天）」。
   * 当 `postGapFinalChapters.length > 0` 时，使用 `--zz-warn`（琥珀色）静默提示存在定稿缺口；**严禁使用 `--zz-decide`（赭橙仅限作者裁决）**。

### 6.3 验收测试

* 单元测试覆盖：① 无 `publishedThrough` 连续 5 章定稿；② `publishedThrough = "C002"` 且 `C004` 为 `drafted`、`C005` 为 `final` 时，`continuousFinalCount = 1` 且 `postGapFinalChapters = ["C005"]`；③ 未配置 `dailyTargetChars` 时 `publishableDays === null`。

## 7. T5（P1）：旧书半路接管批量导入工作流

### 7.1 精确改动文件

* `packages/fanqie/src/commands/import.ts`（新增，≤ 300 行）
* `packages/fanqie/src/commands/index.ts`
* `packages/workbench/src/contract/commands.ts`
* `apps/desktop/src/main/commands-fanqie.ts`（注册 `fanqie.work.importLegacy`）
* `apps/desktop/src/renderer/features/create/NewTargetDialog.tsx`
* `packages/ui/src/copy/fanqie.ts`

### 7.2 详细规格

1. **命令契约**：
   * 输入：`{ root: str(), title: str({ min: 1 }), sourcePath: str({ min: 1 }), splitMode: lit("single_txt", "folder"), markAsFinal: opt(bool()) }`（`markAsFinal` 默认 `true`，将导入旧稿记为 `final` 便于直接续写与体检）。
   * 输出：`{ workPath: string, importedCount: number, totalChars: number, warnings: string[] }`。
2. **解析与安全落盘规则**：
   * `root` 与 `sourcePath` 均须通过 `resolveInsideAsync` / 允许路径校验；读取文本支持 UTF-8 与 GB18030 回退（复用现有解码工具或安全检测）。
   * `splitMode === "single_txt"`：按行首章题正则 `^\s*(?:第[零一二三四五六七八九十百千万两0-9]+[章回节卷]|Chapter\s+\d+|C\d{3,})[\s:：·—-]*.*$` 切分章节，连续编号生成 `C001`、`C002`……；未能切出任何章题时退化为单章导入并在 `warnings` 提示。
   * `splitMode === "folder"`：读取目录下 `.md`/`.txt` 文件，按文件名中的数字/中文章号自然排序后依次导入。
   * 经 `LockService` + `commitIntent` 原子创建 `长篇/<book>/`（标准 `zhizhang/2.0` 的 `work.json`、`chapters/Cxxx.md`、空 `bible/` 结构），并将原始文件/目录只读备份至 `长篇/<book>/sources/legacy-import/`。
   * 导入阶段**不调用任何模型**；导入完成后前端提示作者可一键发起 `fanqie.health`（首轮体检）或 `fanqie.ledger`（补建设定账本）。

### 7.3 验收测试

* 引擎测试验证：含中文百千位章号（如“第一百零二章”）与数字章号的单文件 `.txt` 导入、分章文件夹导入、以及导入后 `listChapters` / `readChapter` / `readBible` 均正常无报错。

## 8. T6（P2）：多分支候选接续链（`derivedFrom`）与设定集三向沉降降噪

### 8.1 精确改动文件

* `packages/fanqie/src/commands/candidate.ts`
* `packages/fanqie/src/context/builder.ts`
* `packages/fanqie/src/pipelines/chapter/{schemas.ts,index.ts}`
* `packages/fanqie/src/pipelines/ledger/index.ts`
* `packages/fanqie/src/bible/schemas.ts`

### 8.2 详细规格

1. **候选稿上游血缘指针（`derivedFrom`）**：
   * 候选稿 `.meta.json` Schema 新增可选字段：`derivedFrom: opt(obj({ kind: lit("final", "candidate"), chapterId: str(), candidateId: opt(str()) }))`。
   * `chapterPipeline` 新增可选 `previousCandidateId: opt(str())`。当传入时，`context/builder.ts` 的 L1 层读取上一章对应候选稿原文（而非正式正文），并在本章候选 `.meta.json` 写入 `derivedFrom: { kind: "candidate", chapterId: prevId, candidateId: previousCandidateId }`，不混入上一章其他候选分支。
2. **采纳归档时的下游分支检测**：
   * 在 `acceptCandidate(workPath, chapterId, candidateId, ...)` 完成后，扫描下一章目录的候选 `.meta.json`：
     * 若某后继候选的 `derivedFrom` 指向当前被采纳的 `candidateId`，将其 `derivedFrom` 更新为 `{ kind: "final", chapterId }`（保持追踪有效）。
     * 若某后继候选的 `derivedFrom` 指向本章**其他未被采纳**的候选稿，不静默修改后继正文，而在返回结果中附带 `staleDownstreamCandidates: Array<{ chapterId: string; candidateId: string; expectedParent: string }>`，由前端提示作者复核或重接上游。
3. **设定集「三向沉降」降噪分类**：
   * 扩展 `bible/pending.json` 中单条待审批提案的可选分类字段 `settlement: opt(lit("resolve_short_term", "settle_long_term", "update_profile"))`：
     * `resolve_short_term`：已结清短期事务，作者批准后从活跃状态移除（原文与章摘要留档）。
     * `settle_long_term`：不可逆长期后果，批准后沉淀至长期伏笔/长线记录并带来源章号。
     * `update_profile`：人物稳定变化，批准后更新实体档案并标注生效章号。
   * 仍严格遵守“所有设定变更先入 `bible/pending.json`，由作者逐条裁决”的红线。

### 8.3 验收测试

* 引擎测试验证：C001 生成 A/B 两份候选 → 沿 B 稿连写 C002（验证 L1 上下文取自 B 稿且写入 `derivedFrom`）→ 采纳 C001 的 A 稿 → 返回的 `staleDownstreamCandidates` 精确报告 C002 候选分支已过期且未篡改 C002 原文。

## 9. 版本口径对齐与全量交付验收

1. **版本号对齐**：当前根与各子包 `package.json` 及 `packages/core/src/version.ts` 中的 `APP_VERSION` 为 `2.0.0`（文档为 `2.2.0`）。在完成本次升级准备发版时，统一将 `package.json`（根 + 全部 workspace）与 `packages/core/src/version.ts` 同步更新为 `2.3.0`（`FORMAT_VERSION` 保持 `"zhizhang/2.0"` 不变），并同步更新 `CHANGELOG.md`、`docs/STATUS.md` 与 `docs/plans/v2.md`（保持核心文档总数 ≤ 8 份）。
2. **强制全量验收命令**（全部 0 错误 0 告警通过）：

```bash
npm run assets -- manifest
npm run assets -- check
npm run check
npm test
npm run build
npm run desktop:build
```

3. **最终验收检查表**：
   * \[ \] `tsc -b` strict 零错误、ESLint 零错误零告警、Prettier 全通过。
   * \[ \] `scripts/guard.mjs` 全项通过：`any = 0`、`! = 0`、`!: = 0`、`as ≤ 116`、`mainRawError = 0`、`unusedExports = 0`、`[G-size]` 单文件 ≤ 400 行零告警、`[G-copy]` 零 JSX 中文硬编码、`[G-docs]` ≤ 8 份。
   * \[ \] 头条与番茄 Python `unittest` 全部通过，Node `test/unit` 与 `test/engine` 全部通过（含 T1–T6 新增用例）。
   * \[ \] Web 预览构建（`npm run build`）与 Electron 暂存构建（`npm run desktop:build`）均零错误通过。