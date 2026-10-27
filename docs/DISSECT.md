# 拆书方法论 · 事实 → 聚合 → 抽象 → 报告（0.17.0）

> 拆书不是书评、不是读后感、不是剧情梗概。它是用结构理论逐章逐场景解剖一本小说，产出**可迁移的写作技巧**与**创作理念**，给作者学习用。
>
> 本模块只做确定性存储、校验、拼装；阅读与写作由 Agent 完成。

## 〇、四个问题（先对齐）

**什么是拆书？**
按结构理论把一本小说拆到「章 → 场景 → 词句」三层，记录**事实**（谁做了什么、结果），再聚合成**结构**（剧情条、节奏、人物），最后抽象成**可迁移的模块**（读者想看什么 / 情绪走向 / 戏剧单元 / 可替换 / 不可照搬 / 迁移 / 失败边界）。它不是复述剧情，也不是打分。

**为什么拆？**
为了学作者的**写法**（场面怎么组织、信息怎么漏、钩子怎么断）和**创作理念**（他怎么看待代价、选择、关系）。所以产出必须是「换一本书还能用」的机制，而不是「这本书讲了什么」。

**拆完得到什么？**
1. 逐章事实（白描，可回溯引文）；
2. 剧情条 / 爽点循环 / 断章钩子 / 伏笔地图 / 人物弧光；
3. 模块卡（book/arc/unit → mind；scene/chapter/line → craft）；
4. 一份 19 节报告 + 量化底座（分卷表 / 高频词 / 分布热力 / 锚点章 / 爽点密度），标明档位（Auto/Full）与覆盖率；
5. 组合包（1 book + N scene）→ 灵感或写作 brief。

**怎么拆？**
**L0 代码测绘 → 定档 → 分批读 → 逐章白描 → 聚合 → 出模块 → 报告 → 组包。**

L0 是确定性的：卷界（原文「第X卷」标记）、章长、词频、十等分热力、锚点章，全部由代码扫全书得到，不占抽样额度，也不依赖模型。报告 §1.1 直接引用这些数字；宏观判断必须先踩数字，再谈印象。

**档位决定结论强度**：

| 档位 | 读多少 | 触发 | 结论强度 |
|---|---|---|---|
| **Auto**（默认） | 按字数 10%，分层抽样：前 10 章 + 后 3 章 + 其余按累计字数等距 | 直接开 | 技法/理念可用；全书节奏/伏笔只作「抽样观察」 |
| **Full** | 100% 章节 | 作者明确说「确认全量」 | 可下全书结论 |

Auto 小书规则：10% 不足 3 万字（书 < 30 万字）→ 直接全读，标 `auto:全读（小书）`。

**Full 的两步闸**：
1. `library_plan(mode="full")` → 只出成本回执（章数/字数/tokens/批次数/时长）+ `confirm_token`，**不写盘、不开读**；
2. 作者明确同意后 `library_plan(mode="full", confirm_full=true, confirm_token=…)` → 写 `plan.json` + `plan.md`，记 `consent`。
Token 30 分钟有效；未确认不得代作者决定。

## 一、为什么改

旧版 `dissect_brief → card_stage` 直接要结论，跳过了事实层与聚合层。结果是卡只能靠印象写，写出来是「场面观察」而不是「写作技巧 / 创作理念」。

成熟拆书是分层的：

```
全书（骨架）→ 卷/剧情单元（循环）→ 章（功能/钩子/价值变化）→ 场景（逐段功能/鸿沟）→ 词句（句长/对话比）
```

每一层产出物不同，不能混。

## 二、0–9 阶段

| 阶段 | 做什么 | 工具 | 产出 | 门 |
|---|---|---|---|---|
| 0 元数据 | 解析章号/标题/字数 | `library_plan` | `plan.json` | 章号可解析 |
| 1 定档 | Auto 10% 分层 / Full 全量（须同意） | `library_plan` | `plan.json` + `plan.md` | Full 有 confirm_token |
| 2 黄金三章 | 入局/加压/承诺；钩子/密度/断章 | `dissect_brief(batch=0)` | 本批原文 | 三章共享同一核心问题 |
| 3 逐章事实 | 白描：谁做了什么、结果；没写的写「未明确」 | `library_facts_stage` | `chapters.jsonl` | 引文可回溯、无补动机 |
| 4 聚合 | 剧情条（目标-阻碍-行动-结果-意外-转弯） | `library_structure_stage(kind=plot)` | `plots.jsonl` | 六项齐、≥3 章 |
| 5 节奏 | 情绪折线/爽点循环/断章钩子/伏笔地图 | `structure_stage(kind=rhythm)` | `rhythms.json` | 循环含铺垫/释放/反应/衔接 |
| 6 人物 | 面具与真相/弧光/群像功能 | `structure_stage(kind=character)` | `characters.json` | 弧光有压力事件 |
| 7 文字 | 句长/句短/对话比 | `library_report` | 报告定量节 | 只对已读章节下结论 |
| 8 抽象 | 机制卡 5 项 + 可迁移写法 | `library_card_stage` | `cards/*.json` v2 | 5 项齐、不可照搬非空 |
| 9 报告 | 确定性拼装 19 节；标 Auto/Full 与覆盖率 | `library_report` | `report.md` | Auto 全书结论标「抽样观察」 |

**Auto 只读 10% → 全书结论只作「抽样观察」；要全书骨架须 Full。**

## 三、三个 schema

### 1. 章事实（`chapters.jsonl`，一行一章）

```json
{"schemaVersion":2,"n":3,"title":"你们是一伙儿的！","words":4562,
 "events":[{"loc":"P1-P3","desc":"槐诗被带进房间，见到艾晴","quote":"原文片段"}],
 "functions":["入局"],
 "hook":{"type":"悬念","text":"艾晴是谁","strength":"强"},
 "value":{"situation":"被控制","relation":"陌生人","cognition":"发现被设局"},
 "unknowns":["艾晴为何出现"]}
```

纪律：
- `desc` 只写动作与结果；心理/评价词（觉得/认为/害怕/后悔/其实/精彩/感人/震撼）会被拒。
- 原文没写的动机/身份/后果写 `unknowns`，**禁止补**。
- 可在事实中用 `readingLevel` 如实申报“正文已读”或“深读”；不填即未声明。代码无法证明阅读深度，历史数据不会自动标成已读。
- `quote` 必须能在该章原文找到（归一化后）；跨段用省略号，按片段核对。

### 2. 聚合（`plots.jsonl` / `rhythms.json` / `characters.json`）

剧情条六项：`goal / obstacle / action / result / twist / turn`，按「完整剧情问题」组织，可跨章，不按章硬切。

节奏表：
- `points[]`：章 / 情绪(-1..1) / 事件
- `loops[]`：`setup / release / reaction / transition / range / ratio`
- `hooks[]`：章 / 类型 / 文本 / 强度
- `foreshadowing[]`：伏笔 / 埋设章 / 兑付章

人物：`mask`（外人看到的样子）/ `truth`（压力下才露的本性）/ `arc[]`（章 / from / to / pressure）/ `function`（群像功能）。

### 3. 模块卡（`cards/*.json`，schemaVersion 2）

```json
{"schemaVersion":2,"layer":"scene","dimension":"character","axis":"craft",
 "readerWant":"看人物在压力下站哪边",
 "emotionArc":"被拉拢-拒绝-沉默-留名片",
 "dramaticUnit":"两方拉拢，第三方用沉默表态",
 "replaceables":["阵营","邀请物","中间人"],
 "mustNotCopy":["夏尔玛","生态瓶","黄金黎明"],
 "transfer":"换成两个组织抢人，主角只拒不见",
 "failWhen":"写成反派逼供或主角自白",
 "evidence":[{"quote":"…","chapter":928}],
 "mechanisms":[{"name":"拒绝即选择","failWhen":"…"}],
 "body":"…"}
```

- `layer`：book / arc / unit / chapter / scene / line
- `dimension`：structure / character / rhythm / hook / prose / commercial
- `axis` 由层+维度推导：book/arc/unit → `mind`；scene/chapter/line → `craft`（可显式覆盖）
- `axis=mind` 的旧卡仍要求 MindSpec 六字段

## 四、校验与审计

| 检查 | 规则 | 错误码 |
|---|---|---|
| 白描 | `desc` 含心理/评价词 → 拒 | `bad_facts` |
| 引文 | 该章原文找不到 → 拒 | `bad_facts` |
| 未明确 | 动机/身份/后果进 `unknowns` | — |
| 模块 5 项 | readerWant / emotionArc / dramaticUnit / replaceables / mustNotCopy 缺一 → 拒 | `bad_module` |
| 迁移/失败边界 | transfer / failWhen 空 → 拒 | `bad_module` |
| 证据 | 模块 evidence 引文找不到 → 拒 | `bad_evidence` |
| 层级 | scene 卡写全书结论 → 软警告 | — |
| 覆盖率 | facts / scope 章数；材料完备度（机械指标）= 0.4×覆盖 + 0.3×引文通过 + 0.2×结构 + 0.1×维度/6；Auto 封顶 0.84；<0.85 → needs_review | — |

`library_audit` 对 v2 模块走模块校验（不再套旧「## 证据」段检查）；旧 v1 卡仍走原审计。

## 五、对标

至少 5 本同网站同题材样本，优先「可复制样本」而非唯一头部；跨网站不混拆。报告第 17 节记录对标结论，不填则提示未填。

## 六、从拆书到写作

- `chapter_brief(lean)`：注入 `layer∈{scene,chapter}` 且 `dimension∈{prose,hook,rhythm}` 的模块。
- `inspire_start`：注入 `layer∈{book,arc,unit}` 或 `dimension∈{structure,character,commercial}` 的模块。
- `library_combo_suggest`：1 个 book 层 + N 个 scene 层，可跨书。

## 七、参考

- 罗伯特·麦基《故事》：七步骨架、鸿沟、压力下的选择、人物弧光
- 许荣哲《小说课》：七问题公式（目标→阻碍→努力→结果→意外→转弯→结局）
- 布兰德《成为作家》：写改分离、诚实原创
- 网文实操：黄金三章（入局/加压/承诺）、爽点循环、断章钩子、反应篇幅比
- ZenStory 拆书五步与机制卡五项；novel-deconstruct 18 章报告框架
