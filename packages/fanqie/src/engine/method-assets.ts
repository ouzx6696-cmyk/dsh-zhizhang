/**
 * On-demand creative method assets — writing/review methods.
 * Pure data + getters. Agents pull via fanqie_method_* / fanqie_chapter_brief.
 * Framing: tell the model what TO write; engineering gates live in Ports.
 */
import { QualityPolicy } from "./ports/quality-policy.js";
import { scoreEnding } from "./domain/ending-consistency.js";
import { WRITING_GUIDANCE, REVIEW_GUIDANCE, PLANNING_GUIDANCE, REFERENCE_GUIDANCE, EDITING_GUIDANCE } from "./domain/creative-guidance.js";
const ASSETS = [
    { id: "style_contract", title: "本书讲法与现场写作", whenToUse: "写作时按本书需要加载", body: WRITING_GUIDANCE },
    { id: "review_evidence_kinds", title: "内容核验与阅读损失", whenToUse: "审读与记录依据", body: REVIEW_GUIDANCE },
    { id: "plan", title: "规划与交接", whenToUse: "从目标发展到可开写章纲", body: PLANNING_GUIDANCE },
    { id: "draft", title: "正文落稿", whenToUse: "按现行依据写候选", body: WRITING_GUIDANCE },
    { id: "review", title: "编辑审读", whenToUse: "先列问题再改并回读", body: REVIEW_GUIDANCE },
    { id: "edit", title: "编辑过稿与修订层级", whenToUse: "candidate_edit_brief 之后按授权改稿（L1–L3）", body: EDITING_GUIDANCE },
    { id: "revise", title: "受控修订", whenToUse: "已授权范围内改稿", body: REVIEW_GUIDANCE + "\n修订先核原稿基线，保留历史，复核当前候选；只有一个现行正文，不自动回滚他人改动。" },
    { id: "analyze", title: "有范围的参考分析", whenToUse: "拆解指定原文", body: REFERENCE_GUIDANCE },
    { id: "develop", title: "原创发展", whenToUse: "发展作者材料", body: PLANNING_GUIDANCE },
    { id: "tomato_four_q", title: "本章体验自检", whenToUse: "按本书目标核实际推进", body: "本章读者经历什么？人物凭什么行动？回应如何成立？结果或体验怎样在场落地？按本书档位判断，不要求固定反转与钩子。" },
    { id: "novel_sense", title: "长篇接续", whenToUse: "续写与连读", body: "从前章实际正文接续，识别相邻单元的真实变化。计划不是已发生；正文角色说法不是客观真相。完整收束、安静体验和信息进展都可成立。" },
    { id: "recommend", title: "按目标选择方法", whenToUse: "决定当前任务需要什么", body: "按最终产物选分析、规划、写作或修订，补必要上游，不把所有步骤串成强制长链。平台信息须有当期来源。" },
];
const BY_ID = new Map(ASSETS.map((a: any) => [a.id, a]));
export const METHOD_ASSET_IDS = ASSETS.map((a: any) => a.id);
export function listMethodAssets() {
    return ASSETS.map(({ id, title, whenToUse }) => ({ id, title, whenToUse }));
}
export function getMethodAsset(id: string) {
    const key = id.trim();
    if (!key)
        return undefined;
    return BY_ID.get(key);
}
export function getMethodAssets(ids: any) {
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
        // includes 展开：依赖资产插在引用者之后；已显式列出或已展开过的只保留原位。
        for (const dep of asset?.includes ?? []) {
            if (seen.has(dep))
                continue;
            seen.add(dep);
            const depAsset = BY_ID.get(dep);
            if (depAsset)
                found.push(depAsset);
        }
    }
    return { found, missing };
}
/** Default packs pulled by fanqie_chapter_brief for drafting. */
/** Lean default: style only. novel_sense/draft/tomato via method_get or brief_mode=full. */
export const CHAPTER_BRIEF_ASSET_IDS = ["style_contract"];
/** Full brief pack (explicit brief_mode=full). */
export const CHAPTER_BRIEF_FULL_ASSET_IDS = ["novel_sense", "style_contract", "draft", "tomato_four_q"];
export function formatAssetForAgent(asset: any) {
    return [`## 方法资产 · ${asset.id} · ${asset.title}`, `适用：${asset.whenToUse}`, "", asset.body].join("\n");
}
/** Truncate long foundation fields for brief injection. */
export function truncateForBrief(text: string, max: any = 480) {
    const t = String(text ?? "").trim();
    if (!t)
        return "";
    if (t.length <= max)
        return t;
    return `${t.slice(0, max).trimEnd()}…`;
}
/** Preserve the latest recorded outcomes in a compact brief, and label any omission. */
function recentHappenedForBrief(value: string, max: number) {
    const text = value.trim();
    if (text.length <= max) return text;
    const tail = text.slice(-max);
    const boundary = tail.indexOf("\n");
    if (boundary >= 0 && boundary < tail.length - 1)
        return `（较早记录省略，以下为近期状态；完整记录可通过根基查看）\n${tail.slice(boundary + 1)}`;
    const prefix = text.slice(0, Math.min(60, Math.floor(max / 4))).trimEnd();
    return `（记录过长，中间省略；完整记录可通过根基查看）\n${prefix}…${text.slice(-(max - prefix.length - 1))}`;
}
/** Soft max for pathological chapter length; typical chapters inject in full. */
export const PREV_CHAPTER_BODY_SOFT_MAX = 16000;
/**
 * Resolve previous-chapter prose for brief injection.
 * Prefers `body` (full); falls back to `bodyTail` for legacy callers.
 */
export function resolvePreviousBody(prev: any) {
    const raw = (prev.body?.trim() || prev.bodyTail?.trim() || "");
    if (!raw)
        return { text: "", clipped: false, source: "empty" };
    const source = prev.body?.trim() ? "body" : "bodyTail";
    if (raw.length <= PREV_CHAPTER_BODY_SOFT_MAX) {
        return { text: raw, clipped: false, source };
    }
    return {
        text: `${raw.slice(0, PREV_CHAPTER_BODY_SOFT_MAX / 2).trimEnd()}\n\n[中间正文省略；续写前请按需读取完整前章]\n\n${raw.slice(-PREV_CHAPTER_BODY_SOFT_MAX / 2).trimStart()}`,
        clipped: true,
        source,
    };
}
/**
 * Top-of-brief「本书读者合同」— book identity for the drafting agent.
 * For n≥2, previous chapter **body** is primary; ending + happened are indexes.
 */
export function formatReaderContract(input: any) {
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
        lines.push("- 书感三弹：①接着前章正文往下推 ②相邻章换压力/主动权/办法 ③按本章体验选择开放接口或完整收束");
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
        lines.push(`- 作者状态记录（可能含旧摘要，须核正文）：${recentHappenedForBrief(input.happened, happenedMax)}`);
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
                lines.push(`（前章较长，已保留开头和结尾各约 ${PREV_CHAPTER_BODY_SOFT_MAX / 2} 字，中间省略；请用 chapter_read 读取完整前章，补齐前不能声称已具备完整接续依据。）`);
            }
            lines.push(resolved.text);
        }
        else {
            lines.push("### 前章正文（续写必读 · 以正文为准）");
            lines.push("（前章正文为空，仅有未来纲末不能代表已发生；请核实前稿或明确以条件规划续写）");
        }
        // soft: ending vs body drift —— 与 payoff 审计共用 scoreEnding（domain 单源），
        // 阈值更宽（0.25，跨章提示口径）：score<0.25 才警并打印分值。
        if (resolved.text && prev.ending?.trim()) {
            const sc = scoreEnding(prev.ending.trim(), resolved.text);
            if (sc.score !== null && sc.score < 0.25) {
                lines.push(`- ⚠️ 前章纲末与正文可能不一致（加权命中 ${(sc.score ?? 0).toFixed(2)}）— 续写以注入的前章正文与状态·已发生为准。`);
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
    const warns = (input.warnings ?? []).map((w: any) => w.trim()).filter(Boolean);
    if (warns.length > 0) {
        lines.push("### 书感软提示");
        for (const w of warns)
            lines.push(`- ⚠️ ${w}`);
    }
    return lines.join("\n");
}
