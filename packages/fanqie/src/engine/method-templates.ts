import { QualityPolicy } from "./ports/quality-policy.js";
interface SourceHeading {
  id: string;
  title: string;
  author?: string;
  readingRange?: string;
  charCount?: number;
}
export function dissectBatchHeader(
  meta: SourceHeading,
  total: number,
  factCount: number,
  batch: { n: number }[],
) {
  return [
    `# 拆书批次 · ${meta.title}${meta.author ? `（${meta.author}）` : ""}`,
    `- sourceId：${meta.id}`,
    `- 全书章数：${total} · 已拆：${factCount}`,
    `- 本批：${batch.map((b) => `第${b.n}章`).join("、") || "（无）"}`,
  ];
}
export function dissectBriefHeader(meta: SourceHeading) {
  return [
    `# 拆书简报 · ${meta.title}${meta.author ? `（${meta.author}）` : ""}`,
    `- sourceId：${meta.id}`,
    `- readingRange：${meta.readingRange}`,
    `- 导入字数：${meta.charCount}`,
    "",
    "【工程说明】本工具只注入摘录与方法包，**不代写分析**。请你按双轴提炼后调用 fanqie_library_card_stage；须 fanqie_library_card_accept 才入库。",
    "",
    "## 双轴准入（只拆两样）",
    QualityPolicy.surfaceLine(),
    "",
    "## 怎么算拆完（脚本核不了，必须真读）",
    QualityPolicy.cardJudgmentLine(),
    "拆完的标志不是字段齐，而是：每张卡都能回答上面五条；mind 卡另有一句「检验方法」（遮住结局，读者能否用已给信息推出___）；craft 卡能说清这一场怎么写。",
    "禁止用「字段齐全 / 引文能搜到 / 审计通过」冒充合格。",
    "",
    "### A. craft（写作技法）→ 指导 **具体写作** / chapter_brief",
    "算：场面取舍、信息怎么漏、节奏/小物、状态如何落纸、失败边界可迁到**另一本书的正文**。",
    "必填：`axis=craft` + **humanFeel**（writerCraft / craftRange / characterState / stateOnPage / allowedEdges / failAsTemplate）。",
    "另填：**bookCraft**（章级续写面 continueWhy / adjacentChange / failAsShortStory）——≠ 完整创作思维。",
    "`characterState` = 这一刻场面状态（慌/赖/在算/会错半拍）；写法+状态，不是人设墙或台词范本。",
    "",
    "#### craft · 打碎僵硬（反完美感；书无关逻辑 + 本书载体）",
    "对原文另问四句：①呼吸哪里故意不齐？②哪里半截、作者也没立刻补课？③关键信息从讲义出还是从误认/失手/身体/跑题漏？载体是什么？④第一反应哪里不对？戏完纸上还留什么？",
    "逻辑名（可并列）：呼吸不齐 / 念头半截 / 信息侧漏 / 先错半拍 / 局部余震 / 口气拧着 / 意义不收齐——每条只记**逻辑名 + 本书载体**。",
    "`allowedEdges` 写成「本场应落纸：…」（打碎正向句 + 本书载体）。`failAsTemplate` 点名僵硬版（句句收齐、反应全对、讲义说明、意义被收完）。",
    "迁的是打碎逻辑名 + 本书载体；不同书的场面外壳各自不同，只记这一本自己怎么把文字写散。",
    "",
    "### B. mind（创作思维）→ 指点 **设定层 / 章纲 / 卷纲**（inspire）",
    "算：能力与代价如何设计、冲突飞轮、信息分期、章/卷压力如何换、读者合同如何立——可迁到**另一本书的设定/纲**。",
    "必填：`axis=mind` + **mind**（sellIntoCost / infoStaging / pressureMachine / debtAndSwap / readerContract / failAsEncyclopedia）。",
    "mind 供 inspire 规划；lean 正文 brief 只吃 craft 写法+状态。",
    "",
    "### 准入样子（两轴）",
    "- craft：可迁到另一本书正文的写法与场面状态",
    "- mind：可迁到另一本书设定/纲的创作思维",
    "- kind 是场面粒度次标签（craft|scene|book），axis 才是双轴",
    "",
    "### 其它",
    "1. **mechanisms** 须含 `name` + `failWhen`；discard 写清丢弃的原作剧情与人名。",
    "2. 可选 **handoff**；可选 **kind**（`craft`|`scene`|`book`）——axis=mind 才进创作思维轨。",
    "3. 同一 source 宜拆：**多张 craft + 至少一张 mind**（完整迁技）；仅技法试写可后注明。",
    "4. 缺证据块时 stage 可软警告通过；准入硬闸拦百科表与台词范本教嘴。",
    "5. **质量面 · 毒点**：" + QualityPolicy.poisonPolicyLine(),
    "",
  ];
}
