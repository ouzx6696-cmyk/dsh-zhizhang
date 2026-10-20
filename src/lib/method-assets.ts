// @ts-nocheck
/**
 * On-demand creative method assets — Contract 4.0 + writing/review methods.
 * Pure data + getters. Agents pull via zhizhang_method_* / zhizhang_chapter_brief.
 * Framing: tell the model what TO write; engineering gates live in Ports.
 */
import { QualityPolicy } from "./ports/quality-policy.js";
/** AI Contract 4.0 STYLE_CONTRACT — positive craft cues for the live agent. */
const STYLE_CONTRACT_BODY = [
    "【AI Contract 4.0 文风契约】适用于 draft / revise，以及 plan 中与节拍相关的表述：",
    "- **可见取舍**：场面里写出人物怎么选、怎么动；少用「不是…而是…」「与其说…不如说…」这类对照腔，也少用填充性的「一丝/一抹/几分/些许/不禁/不由得」（对白内可保留）。",
    "- **情绪落地**：处境过滤下的具体细节与可见代价代替「他感到/觉得/意识到」+ 抽象情绪、「心中涌起…」「心情无比复杂」。",
    "- **过程在场**：用动作阻力、当场细节或带潜台词的交锋展开亲历冲突，代替「经过一番…便处理妥当」「做出了艰难的抉择」式跳步。",
    "- **章末落点**：落在场内具体的人、声或当场细节上；物件随场面自然带着即可。",
    "- **处境过滤**：环境细节经视角人物的利益、焦虑与注意力偏见（situationLens）过滤；优先亲历冲突。",
    "- **句长有起伏**：长短句交错，偶有停顿或半截念头；整段齐刷短句会像说明书。",
    "- **雷达只拦腔**：语感雷达与禁词表只扫 AI 腔；句式相似不能单独判稿。质量看卖点是否进办法、回报是否在场。",
].join("\n");
const REVIEW_EVIDENCE_BODY = [
    "【审校五类证据范畴】诊断时优先归入下列类别（可并存；无证据就空着）：",
    "1. 结构与锁定/伏笔咬合 — 已发生事实、锁定、伏笔、因果与承诺是否咬合。",
    "2. 视角处境与注意力偏见 — 是否贴合 situationLens；知情范围是否越权。",
    "3. 亲历博弈充实度 — livedScene 是否被概览句吞掉；冲撞有无动作/阻力/代价。",
    "4. AI腔与心理偷懒诊断 — 对照套话腔、抽象情绪、过程跳步、口号式收束（可对照语感雷达；雷达 0 命中 ≠ 好文）。",
    "5. 章末落点质感 — ending 是否兑付为场内具体人/声/细节，而非抽象展望。",
    "规则：只诊断、给证据与可选方向；替换段/续写/改源/自称定稿均须作者另开授权任务。空问题列表 ≠ 作者认可。",
].join("\n");
/**
 * Task packs: Contract 4.0 + skill hard rules (concise). No JSON shape / server
 * permission injection — DSH agent uses tools; shapes stay out of assets.
 */
const ASSETS = [
    {
        id: "style_contract",
        title: "文风契约（Contract 4.0）",
        whenToUse: "写正文、改稿、或梳理章纲节拍前加载，压住 AI 腔与偷懒叙述",
        body: STYLE_CONTRACT_BODY,
    },
    {
        id: "review_evidence_kinds",
        title: "审校五类证据",
        whenToUse: "做 review / 写审校留痕 issues 前加载，按五类归类诊断",
        body: REVIEW_EVIDENCE_BODY,
    },
    {
        id: "plan",
        title: "章纲规划方法",
        whenToUse: "写/改章纲（outline）时：产出可用规划候选，不是正文",
        body: [
            "【任务：plan · 规划方法 + Contract 4.0】",
            "产出可用的章节规划候选（不是正文）。复用已采纳根基与想法/来源交接；事件链自行重造。",
            "",
            "推导链：欲望 → 形态 → 近端兑现 → 相邻变化 → 远端候选。近端先说清读者拿到什么，再谈远端。",
            "- **卖点进办法**：把期望体验落到主角具体做法、对方在知情范围内的可行反应、近期可得收益；职业/能力换掉仍无差别 = 卖点未参与故事。",
            "- **开篇先尝卖点**：先设计一次小而真的体验，再展开设定；慢热也要有近端到手感。",
            "- **回报在场**：反击改控制、悬疑给可排除的小答案、关系双方重新选择、经营成果被使用——读者须能感到，而不只是听到播报。",
            "- **相邻须有变化**：试推下一自然单元时，问题/主动权/关系/办法/所得要有不同（换对象重跑同一核查链不够）。",
            "- **对手已知处境 → 可行回应**：把主角将用的证据放进对手已知或当场可见信息再推；对方按自己所求行动，一贯侥幸须当场付代价。",
            "- **状态四类**：已发生 / 作者锁定 / 当前采纳 / 候选 —— 分清；远端明示未采纳候选。",
            "有助于手感时填 situationLens / livedScene / stateLens（状态/写法透镜）；宁空不编。字数是工作预算不是质量分。入库与定稿只经工具 accept。",
            "",
            STYLE_CONTRACT_BODY,
        ].join("\n"),
    },
    {
        id: "draft",
        title: "正文起草方法",
        whenToUse: "写本章正文前按需加载；默认 lean brief 不含本包；交稿 brief→stage→lint→（可选 edit）→accept",
        body: [
            "【任务：draft · 写作方法】文风契约见同 brief 的 style_contract；质量面见 QualityPolicy。",
            "只交付所请求边界内的完整散文正文。有已采纳依据则用之；新开设定须与已确立事实咬合。",
            "通读所提供的前章与已存本章全文。独立开篇如实开篇，不作虚假连续性声明。",
            "",
            "创作要点：",
            "- **卖点进入主角办法**：读者值得等的用法写进行动——他注意到什么、据什么判断、敢采取哪一步；职业名词/「早有预料」不能代替关键动作。主角可弱势误判，关键场面仍要由他动手。",
            "- **回报写在场**：不只写「赢了/心动了/找到线索」；写改变怎样来到、对方不得不调整或双方重新选择；关键场面（说服/相认/胜利用法）尽量在场。",
            "- **相邻单元须有变化**：章末从已有结果生出行动、选择、局面变化或有分量的未知；相邻章换压力即可，不必机械切在答案前。",
            "- **对手已知处境 → 可行回应**：对手/配角按已有信息利用条件、拒绝或改价；重要他人从自己所求接话。",
            "- **压程序保留转向依据**：压缩劝说/核验/搬运时，仍留下让对方改主意的事实、关系或证物。",
            "- **证据边界人物化**：证明范围用人物追问、止步或换办法显露。",
            "- **先读体验再对雷达**：写完先读实际体验（在等什么/主角做了什么/收到什么），再对照承诺；雷达与禁词只拦腔调。",
            "",
            "工程交稿：未保存候选走 zhizhang_chapter_brief → candidate_stage → style_lint →（可选 edit）→ candidate_accept。*_audit 仅诊断旁路。持久化只经显式 accept。",
            "尊重当前章纲处境三字段与 ending 兑付；环境细节经 situationLens 过滤；亲历冲突优先；已确立事实保持一致。",
            "- **文风**：见同 brief 已载的 style_contract；禁词/雷达 ≠ 兑付过关。",
            "- **质量面**：人味吃技法卡；书感吃读者合同+novel_sense；毒点见 QualityPolicy。",
        ].join("\n"),
    },
    {
        id: "review",
        title: "审校诊断方法",
        whenToUse: "审校已存章/候选时：只诊断，不代写替换段",
        body: [
            "【任务：review · 审改方法 · 仅诊断】",
            "先完整读实际稿，再核本书承诺：后台写着「主角高光」不能证明读者已看到。",
            "**先定位主要阅读损失，再定改动层级**（位置—症状—损失—层级/保留理由）。主问题由阅读判断。",
            "",
            "番茄四问（按本书主体验，不要求每章齐全）：",
            "- 进入：能否认得当下，近期是否先尝到卖点？",
            "- 主角与主看点：独特办法/关系/声音是否进入决定性行动？还是只剩称谓、程序、他人认证？",
            "- 回报：关键选择与结果是否在场？得到后有没有使用或承受的时间？",
            "- 继续：结果是否带来新条件与**不同**的想看？相邻是否换了压力？后段是否仍供给开篇承诺？",
            "",
            "若诊断卖点稀薄或相邻同压，却只建议删两句点题 = 主问题未处理，须标结构级方向或明示权限不足。",
            "问题尽量归入五类证据；区分必要修补与口味偏好。保住有效声线与人物能动性。",
            "本任务只诊断：替换段、续写、改源、选定版本、声称批准均须另开授权任务；自审 ≠ 独立编辑 ≠ 读者反馈 ≠ 市场验证。",
            "**雷达 0 命中 ≠ 质量过关**；「没有硬伤」不是审改终点。",
            "可写 zhizhang_review_ledger；落盘正文仍须作者显式工具。建议对照 zhizhang_payoff_audit。",
            "",
            REVIEW_EVIDENCE_BODY,
            "",
            STYLE_CONTRACT_BODY,
        ].join("\n"),
    },
    {
        id: "revise",
        title: "改稿方法",
        whenToUse: "在授权范围内实际改稿（polish/restructure）前加载",
        body: [
            "【任务：revise · 仅做授权范围内的实际改稿】",
            "先识别主要阅读损失，再在完整改稿正文中落实相应修改（损失层级决定动场面还是动词句）。",
            "polish：保留情节解法、责任归属与结构；若需重构则报 unresolved，停在授权边界内。",
            "restructure：真正修补已授权的结构损失；已获重构权就按结构动，不只换词或回以建议。",
            "保住有效声线与人物能动性。**压程序保留转向依据**；**重构后扫已发生**（新增数字/付款人/责任/称谓是否与已发生一致）。",
            "复核谁付出、承诺、因果与已发生事实；改稿理由须与已发生对齐。范围仅限本章；跨章记 unresolved。",
            "删句先辨是复读还是在增偏心/讽刺/情绪；用禁词表磨平声音会伤可读性。",
            "改稿结果仍是未保存候选：brief（若新开写）→ stage → style_lint → accept；持久化只经显式 accept。回读完整版本。",
            "",
            STYLE_CONTRACT_BODY,
        ].join("\n"),
    },
    {
        id: "analyze",
        title: "材料分析方法",
        whenToUse: "分析所供阅读材料时（只读事实/推断/未知，不授权入库）",
        body: [
            "【任务：analyze】",
            "只分析实际提供的阅读范围。区分文本事实、人物信念、推断的读者效果与未知项。",
            "交接四字段：意图用途、可迁移经验、必须重造者、必须丢弃者。",
            "可迁移的是写法与创作思维；人物组合与核心事件链自行重造。非理性对手只作观察，不当成可照搬技法。",
            "分析本身不入库、不进规划；只谈已提供的原文范围。",
        ].join("\n"),
    },
    {
        id: "develop",
        title: "想法发展方法",
        whenToUse: "从已有材料长出可用想法/规划文档（停在规划，不写正文）",
        body: [
            "【任务：develop】",
            "从所请求产出与已有充足材料出发；在既有材料上生长，不强套模板。",
            "推导：欲望 → 形态 → 近端兑付 → 相邻变化 → 远处候选。",
            "- **卖点放进主角具体做法**；其他重要人物在知情范围内可行地行动（对手已知→可行回应）。",
            "- 近详远略；远处明示为未采纳候选。**相邻单元须有变化**（换职业名同构选题不够）。",
            "- 状态：已发生 / 锁定 / 采用 / 候选分清。不设反转/情节点/悬念配额。",
            "停在可用规划；正文与采纳另走工具链。",
        ].join("\n"),
    },
    {
        id: "tomato_four_q",
        title: "番茄四问（主体验速查）",
        whenToUse: "开写/审改前速查：进入、主角与卖点、回报、继续——按本书主体验，不要求每章齐全",
        body: [
            "【番茄四问 · 主体验速查】按本书主体验自检，不要求每章四问齐满分：",
            "1. 进入：读者能否认得当下场面？近期是否先尝到卖点（而非设定讲座）？",
            "2. 主角与主看点：独特办法/关系/声音是否进入决定性行动？还是只剩称谓、程序、他人认证？",
            "3. 回报：关键选择与结果是否在场？得到后有没有使用或承受的时间？",
            "4. 继续：结果是否带来新条件与不同的想看？相邻是否换了压力？后段是否仍供给开篇承诺？",
            "用法：写前对照章纲 ending/beats；写后可先自答四问再 stage。雷达 0 命中 ≠ 四问过关。",
        ].join("\n"),
    },
    {
        id: "novel_sense",
        title: "书感（长篇一章）",
        whenToUse: "开写/续写正文前必载：你在写整本书的一章，不是独立短篇；配合 brief「本书读者合同」",
        body: [
            "【书感 · novel_sense】你在写长篇/连载的**一章**，不是可单独完结的精致短文。",
            "- **身份**：本章是整本书里的一截；读者合同（premise / 近端计划 / 伏笔）贯穿。",
            "- **消耗前结果**：续写接着已发生与前章落点往下推。",
            "- **留书债**：回报在场后再留下行动、选择、局面变化或有分量未知；完整闭环 ≠ 追读动力。",
            "- **相邻须变**：问题 / 主动权 / 关系 / 办法 / 所得要有不同。",
            "- **形态**：默认连载章；短篇须显式声明。人味归拆书库卡；书感归本资产 + brief 读者合同。",
            "- **质量面**：" + QualityPolicy.poisonHint,
        ].join("\n"),
    },
    {
        id: "recommend",
        title: "参考推荐方法",
        whenToUse: "仅在所供目录元数据内检索推荐时（只读）",
        body: [
            "【任务：recommend】",
            "只搜索所提供的目录元数据。只用其中的 referenceId，写明适用条件与失败边界。",
            "目录简介只代表元数据，不等于通读全文或当前市场表现。本任务只读，不创建分析条目。",
        ].join("\n"),
    },
];
const BY_ID = new Map(ASSETS.map((a) => [a.id, a]));
export const METHOD_ASSET_IDS = ASSETS.map((a) => a.id);
export function listMethodAssets() {
    return ASSETS.map(({ id, title, whenToUse }) => ({ id, title, whenToUse }));
}
export function getMethodAsset(id) {
    const key = id.trim();
    if (!key)
        return undefined;
    return BY_ID.get(key);
}
export function getMethodAssets(ids) {
    const found = [];
    const missing = [];
    const seen = new Set();
    for (const raw of ids) {
        const id = String(raw ?? "").trim();
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        const asset = BY_ID.get(id);
        if (asset)
            found.push(asset);
        else
            missing.push(id);
    }
    return { found, missing };
}
/** Default packs pulled by zhizhang_chapter_brief for drafting. */
/** Lean default: style only. novel_sense/draft/tomato via method_get or brief_mode=full. */
export const CHAPTER_BRIEF_ASSET_IDS = ["style_contract"];
/** Full brief pack (explicit brief_mode=full). */
export const CHAPTER_BRIEF_FULL_ASSET_IDS = ["novel_sense", "style_contract", "draft", "tomato_four_q"];
export function formatAssetForAgent(asset) {
    return [`## 方法资产 · ${asset.id} · ${asset.title}`, `适用：${asset.whenToUse}`, "", asset.body].join("\n");
}
/** Truncate long foundation fields for brief injection. */
export function truncateForBrief(text, max = 480) {
    const t = String(text ?? "").trim();
    if (!t)
        return "";
    if (t.length <= max)
        return t;
    return `${t.slice(0, max).trimEnd()}…`;
}
/** Soft max for pathological chapter length; typical chapters inject in full. */
export const PREV_CHAPTER_BODY_SOFT_MAX = 16000;
/**
 * Resolve previous-chapter prose for brief injection.
 * Prefers `body` (full); falls back to `bodyTail` for legacy callers.
 */
export function resolvePreviousBody(prev) {
    const raw = (prev.body?.trim() || prev.bodyTail?.trim() || "");
    if (!raw)
        return { text: "", clipped: false, source: "empty" };
    const source = prev.body?.trim() ? "body" : "bodyTail";
    if (raw.length <= PREV_CHAPTER_BODY_SOFT_MAX) {
        return { text: raw, clipped: false, source };
    }
    return {
        text: `${raw.slice(0, PREV_CHAPTER_BODY_SOFT_MAX).trimEnd()}…`,
        clipped: true,
        source,
    };
}
/**
 * Top-of-brief「本书读者合同」— book identity for the drafting agent.
 * For n≥2, previous chapter **body** is primary; ending + happened are indexes.
 */
export function formatReaderContract(input) {
    const lean = Boolean(input.lean);
    const planMax = lean ? 200 : 480;
    const threadMax = lean ? 200 : 480;
    const happenedMax = lean ? 240 : 480;
    const lines = [
        "## 本书读者合同",
        lean ? "（lean · 保幕与上一章正文；砍肥肉）" : "（你在写整本书的一章）",
        QualityPolicy.surfaceLine(),
        QualityPolicy.poisonHintLine(),
    ];
    if (lean) {
        lines.push("- 书感三弹：①接着前章正文往下推 ②相邻章换压力/主动权/办法 ③章末留未了局面或未说完的话");
    }
    if (!input.previous && !input.continuation) {
        lines.push(lean
            ? "- 开篇写法：先用一场小而真的体验立合同；设定嵌进动作与当场压力，篇幅跟着戏走。"
            : "- 开篇写法：先设计一次近端可感的卖点体验，再展开设定；慢热也要有到手感。");
    }
    lines.push(`- 承诺/premise：${truncateForBrief(input.premise, lean ? 200 : 360) || "（空）"}`);
    lines.push(`- 近端计划 planned：${truncateForBrief(input.planned, planMax) || "（空）"}`);
    lines.push(`- 未结伏笔 threads：${truncateForBrief(input.threads, threadMax) || "（空）"}`);
    if (input.happened?.trim()) {
        lines.push(`- 状态·已发生：${truncateForBrief(input.happened, happenedMax)}`);
    }
    // lean：本章 ending 只在处境区（renderOutlineLean）出现一次，避免合同+处境双信号
    if (input.chapterEnding?.trim() && !lean) {
        lines.push(`- 本章 ending 承诺：${truncateForBrief(input.chapterEnding, 120)}`);
    }
    const prev = input.previous;
    if (prev) {
        lines.push("### 前章索引（ending / 摘要 · 辅助）");
        lines.push(`- 前章：${prev.id}《${prev.title || prev.id}》ending=${truncateForBrief(prev.ending, lean ? 120 : 360) || "（无 ending）"}`);
        if (!lean && prev.summary?.trim()) {
            lines.push(`- 前章摘要：${truncateForBrief(prev.summary, 360)}`);
        }
        const resolved = resolvePreviousBody(prev);
        if (resolved.text) {
            lines.push("### 前章正文（续写必读 · 以正文为准）");
            if (resolved.clipped) {
                lines.push(`（前章较长，已保留近全文前 ${PREV_CHAPTER_BODY_SOFT_MAX} 字；续写以注入正文为准）`);
            }
            lines.push(resolved.text);
        }
        else {
            lines.push("### 前章正文（续写必读 · 以正文为准）");
            lines.push("（前章正文为空 — 仅有 ending 索引时，接着该落点换压力往下推）");
        }
        // soft: ending vs body drift
        if (resolved.text && prev.ending?.trim()) {
            const end = prev.ending.trim();
            const hay = resolved.text;
            const cjkEnd = end.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
            const hit = cjkEnd.filter((w) => hay.includes(w)).length;
            if (cjkEnd.length >= 2 && hit === 0) {
                lines.push("- ⚠️ 前章纲末与正文可能不一致 — 续写以注入的前章正文与状态·已发生为准。");
            }
        }
    }
    else if (input.continuation) {
        lines.push("### 前章正文（续写必读）");
        lines.push("- ⚠️ 前章缺失：按位序应为续写，但找不到前一章。请先确认章节顺序或补写前章。");
    }
    else {
        lines.push("- 前章：（本章为开篇或尚无前章）");
    }
    const warns = (input.warnings ?? []).map((w) => w.trim()).filter(Boolean);
    if (warns.length > 0) {
        lines.push("### 书感软提示");
        for (const w of warns)
            lines.push(`- ⚠️ ${w}`);
    }
    return lines.join("\n");
}
