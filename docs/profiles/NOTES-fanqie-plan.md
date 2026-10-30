# NOTES：fanqie-plan 分组（开书规划与拆书）

原件范围：inspiration-forge 与 inspiration-forge-library 两套下全部 .md，共 61 份，约 305KB（含两套里逐字相同的交接契约、库位置各一份）。新稿 6 份约 44KB，另有 aliases-fanqie-plan.json。

## 各份来源

| 新 id | 合并了哪些原件 |
|---|---|
| plan-foundation | inspiration-forge 的 SKILL、方法论第 2–4 节与 11.1、11.3、11.4 节、交接契约 7.1、7.2 节、题材包第 5 节、题材红线、命名、番茄平台（只留对立项的影响） |
| plan-structure | 工作流、方法论第 5、6、8、9 节与 11.2、11.6 节、幕转章纲、结构形状、规模参数、幕骨架模板、变更提案的思路 |
| plan-outline | 方法论第 7 节、章纲示例（只留颗粒度对照）、novel-writer 交接格式第 3 节、索引层第 4 节、黄金三章示例的 C001 章纲（改写成 8 字段），加上 fanqie_outline_check 的真实判定规则 |
| library | 拆书套件的 SKILL、工作流、方法论、字段规范、证据示例、锚点体系、锚点判据、拆解对照（压成一组正反例）、并发规程与多本比较类模板（只留原则），按引擎九步工具链改写 |
| templates-plan | 模板目录下的故事根基、人物、规则（并入物品、势力、地点、时间线的必要字段）、卷纲、幕纲、章纲、伏笔台账、变更提案，加精简拆解模板、拆解卡模板（改为 v2 卡字段） |
| examples-plan | 这座山归我了规划、雾港旧声铺规划、开篇拆解与技法卡提取示例（技法卡改写为 v2 字段） |

## 删掉的内容类型

- 所有自有目录与文件落位（state/、workspace/volumes、acts、outlines、库根、顶层认知、批次台账、库位置.yaml、环境变量解析、待归平台）和 python 脚本命令，一律换成长篇工具。库位置、库结构、库根模板三份整体删除，只剩“只读指定材料、拆书不入库不算入库”的原则。
- 反复出现的免责声明与自我限定（“本技能未证明能提升质量”“不是市场统计”“不是固定参数”每份都说一遍），只在必要处留一句。
- 题材包的 24 题材 id 表与可选阶段名表（标签性内容，无判据）；只留八类主体验速查和高发逻辑坑。
- 平台画像、题材页、对照表、假设台账、总结报告、阅读卡、深拆卡模板：引擎的 fanqie_library_report 已固定报告结构，这些只留“多本比较”的几条原则。
- 并发拆解规程、子代理派单格式、跨会话交接字段、hash 与版本纪律：属于宿主与工具行为，不再写进方法。
- 热烈叙事与群体反应、组织选择与取舍两份案例：主题是正文讲法与胜利享有，属于写作侧；规划侧只保留“回报在场兑现”一条。
- world 模板的世界状态随章表、写章前世界四问，当前状态模板（当前状态归写作分组的 templates-write 与 continuity）。

## 修正的矛盾（以代码为准）

1. 目标篇幅：原件允许“篇幅未定可注明”；fanqie_outline_check 要求 targetWords 为正整数，否则判错。新稿要求必填整数，未定时填 2000–2500 估算值并告知作者可改。1500–6000 字以外只警告。
2. 占位判定：原件只泛说“不留占位”；新稿按章纲检查的实际正则写明 TODO、TBD、待填写、待补、待正文发挥、模板提示语留在【】里会判错，“无额外锁定”这类明写可以通过。
3. 抽样：原件反对固定抽样、默认通读授权范围；引擎 fanqie_library_plan 默认 Auto 约 10% 分层抽样，Full 须作者确认。新稿照工具走，同时保留“抽样结论只算抽样观察、不外推全书”。
4. 技法卡字段：原件的技法卡（技法名、适用瓶颈、三步做法、容易写成套话、必须重造与舍弃、失效边界）与引擎 v2 卡字段不一致。新稿以 fanqie_library_card_stage 的必填项为准（readerWant、emotionArc、dramaticUnit、replaceables、mustNotCopy、transfer、failWhen、evidence），原字段映射进 steps、bannedDiction、mustNotCopy、transfer。
5. 根基落位：原件故事根基模板是自由文档；新稿按 fanqie_foundation_set 的实际字段（locks、characters、planned、threads、readerKnowledge、style、pace、happened）落位，卖点进 fanqie_project_create 的 premise。
6. 卷幕规划：原件写成独立文件；引擎有 fanqie_inspire_stage 的全书、卷、幕规划候选与 fanqie_inspire_accept 采纳，新稿走这条。写作分组的 overview 写的是“卷纲幕纲交作者确认，必要部分写进章纲头注”，两者不冲突，但建议总纲补一句这两个 kind。
7. 精简拆解：原件不入库的分析对应 fanqie_reference_analyze（默认不保存、不入公共库），引文核对对应 fanqie_quote_check。

## 与兄弟分组的分工（避免重复）

- 节奏档位刻度表和“卖点改变局面、对手主动出招、慢不等于少”三条硬要求由写作分组的 rhythm 承载，plan-foundation 只讲立项时怎样选档并指向 rhythm。
- 番茄签约、推荐节点和 AI 声明由 platform 承载，plan-foundation 只讲对立项的两点影响。
- 四态（已发生、锁定、采用、候选）详细规则在 continuity，本组只在根基字段落位时提一句。

## 原件的明显问题

- 极度重复：同一组限定语（不强制四拍、不硬造代价、不强加钩子、样本不是规律）在十几份文件里各写一遍，真正的判据被淹没。
- 交接契约、库位置两套逐字重复；拆书侧近十份模板大多是“按需、可选、不要求”的空壳。
- 方法论第 1–10 节与第 11 节自相拉扯：前面反复说“不是每章配额、不要钩子”，第 11 节又给快爽刻度，需要靠“按档位读”来和解，模型很难抓重点。
- 黄金三章示例的 C001 章纲用“【切入】【交锋】”自定格式，不符合本插件 8 字段，已改写。
- 雾港旧声铺原件 22KB，单份规划细到救援动作，作为示例过长，已压成“做对了什么”。

## 补：novel-writer 三份结构原件的去向

story_craft、structure_craft、serial_orientation 三份原本由写作分组映射到本组（aliases-fanqie-write.json 已有，归宿不变：story_craft → plan-foundation，另两份 → plan-structure），本组二次核对后整合如下。

| 原件 | 进了哪里 | 没进的内容与原因 |
|---|---|---|
| story_craft | 主体本已在 plan-foundation 第 2、3 节（决策引擎四问、只建会影响行动的规则、人物以为的版本与客观规则分开）；新补三句：不为立体硬造秘密缺点、配角工具人判据、硬机制规则的消耗。成长后不写回旧状态、与正文冲突先停，放进 plan-structure 第 7、8 节 | 状态文件分工（story_foundation、constraints、current_state 各放什么）：本插件按 fanqie_foundation_set 字段落位，已删 |
| structure_craft | 卷纲接续、幕纲因果、章纲“够不够”判据并入 plan-structure 第 3、4、6 节；“这章的人和事能否与别章互换”改写成换位、换人两次替换加四条补足标准（第 6 节）；写后逆向校准的因果、人物两组并入第 7 节 | 章纲四块格式（被 plan-outline 8 字段取代）；前台后台（scene 第七节已有）；节奏项（rhythm 第六节已有）；表达项（prose、edit 已有）；接收外部规划的落位目录（换成 fanqie_inspire_accept） |
| serial_orientation | 四层架构改写为“落在哪、向下约束、用不上时的病”表加五步自下而上互锁检查（plan-structure 第 2 节）；天堑前置改写为四步倒推加一个正反对照例（第 3 节）；自增殖危机链改写为三步做法、一条压缩链例和判据（第 4 节）；双向校准三抓手并入第 7 节；能力与代价闭环压成一条进 plan-foundation 第 3 节；“冲突具体到人和阻拦”进互锁检查第 4 步 | 三个结构问题诊断与钩子、收束：rhythm 第五、六节已有；启用条件、免责与“不是平台规定”类声明 |

修正的矛盾：plan-foundation 原写“规则被情节绕过，回来补限制”，structure_craft 要求“规则已被正文使用或作者锁定时不补限制救纲，先报告冲突”。两者分阶段适用：规划阶段可补限制，规则一旦进了定稿正文或被锁定就只报冲突。两份新稿已按此统一。
