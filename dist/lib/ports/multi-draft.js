import { getPortConfig } from "./config.js";
import { Scheduler } from "./scheduler.js";
import { PLUGIN_VERSION } from "../version.js";
export const MULTI_DRAFT_DISABLED_CODE = "multi_draft_disabled";
function countWordsLocal(text) {
    if (typeof text !== "string" || text.length === 0)
        return 0;
    const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
        ?.length ?? 0;
    const latin = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
    return cjk + latin;
}
export function envMultiDraftFlag() {
    const raw = String(process.env.DSH_ZHIZHANG_MULTI_DRAFT ?? "")
        .trim()
        .toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
export function isMultiDraftEnabled() {
    if (getPortConfig().multiDraftEnabled)
        return true;
    return envMultiDraftFlag();
}
function clipPreview(body, max = 280) {
    const t = String(body ?? "").replace(/\s+/g, " ").trim();
    if (t.length <= max)
        return t;
    return t.slice(0, max) + "…";
}
export const MultiDraftPort = {
    id: "port.multi_draft",
    version: PLUGIN_VERSION,
    disabledCode: MULTI_DRAFT_DISABLED_CODE,
    isEnabled: isMultiDraftEnabled,
    enableHint() {
        return ("开启方式：插件 config.multiDraft.enabled=true，或 setPortConfig({ multiDraftEnabled: true })，" +
            "或环境变量 DSH_ZHIZHANG_MULTI_DRAFT=1。开启后不改变默认单候选链。");
    },
    /** Refuse unify tools when feature off. Throws Error with .code = multi_draft_disabled. */
    requireEnabled() {
        if (MultiDraftPort.isEnabled())
            return;
        const err = new Error(`多草稿统一整理未开启（${MULTI_DRAFT_DISABLED_CODE}）。${MultiDraftPort.enableHint()}`);
        err.code = MULTI_DRAFT_DISABLED_CODE;
        throw err;
    },
    parentView(cand) {
        return {
            id: cand.id,
            draftLabel: cand.draftLabel,
            wordCount: countWordsLocal(cand.body),
            note: cand.note || undefined,
            preview: clipPreview(cand.body),
        };
    },
    /**
     * Positive merge brief — keep plot/pressure, pick best voice edges, one continuous chapter.
     * No 不要xx stacks.
     */
    formatUnifyBrief(input) {
        const n = input.parents.length;
        const words = input.parents.map((p) => Number(p.wordCount ?? 0));
        const avg = words.length > 0
            ? Math.round(words.reduce((a, b) => a + b, 0) / words.length)
            : 0;
        const lo = words.length ? Math.min(...words) : 0;
        const hi = words.length ? Math.max(...words) : 0;
        const target = input.targetWords ?? (hi > 0 ? Math.round((lo + hi) / 2) : avg);
        const lines = [
            `【统一整理 · 多草稿合并】章 ${input.chapterId}` +
                (input.workKey ? ` · 作品 ${input.workKey}` : ""),
            `父候选 ${n} 份（均须待采纳、同章）。目标篇幅约 ${target || "沿父稿"} 字（父稿 ${lo}–${hi}，均 ${avg}）。`,
            "",
            "【要写成什么样】",
            "1. 一条连续本章：情节因果、压力链与章末落点对齐；从各稿里挑最稳的场面推进，拼成可读的一整章。",
            "2. 口气取长：保留各稿里最有人味的口癖、半截念头、长短呼吸；统一视角与时态，不拼贴成拼盘说明书。",
            "3. 卖点与阻力：关键处用带阻力的动作与博弈台词；景物作生路/破绽/财物信息。",
            "4. 毛边可留：去空转连接与万能套话时，别把起伏熨平；结尾落具体残局/物品/威胁。",
            "",
            "【父稿一览】",
        ];
        for (const p of input.parents) {
            const label = p.draftLabel ? `「${p.draftLabel}」` : "";
            lines.push(`- ${p.id}${label} · ${p.wordCount} 字` + (p.note ? ` · ${p.note}` : ""));
            lines.push(`  摘录：${p.preview || "（空）"}`);
        }
        lines.push("", "【硬边界】", "- 只输出合并后的本章正文，无对比报告。", "- 不新增无关支线；不静默写 chapters/。", "- 整理稿经 unify_stage 暂存后，仍须 style_lint → candidate_accept。", "", `下一步：${Scheduler.nextHint("candidate_unify_brief")}`);
        return lines.join("\n");
    },
    afterUnifyStageLines(opts) {
        return [
            `统一整理候选已暂存：${opts.unifyCandId}`,
            `- 章：${opts.chapterId}`,
            `- 合并自：${opts.parentIds.join("、")}`,
            `- 约 ${opts.wordCount} 字`,
            `- 尚未写入正式章；source=unify`,
            `下一步：${Scheduler.nextHint("candidate_unify_stage")}`,
        ];
    },
};
