/** 事实层：逐章白描校验与落盘。 */
import { withLock } from "../../store.js";
import type { StoragePaths } from "../../types.js";
import { ZhizhangError } from "../../errors.js";
import { HOOK_STRENGTHS, HOOK_TYPES } from "../../domain/card-schema.js";
import { quoteOk } from "../../domain/evidence.js";
import { analysisPaths, ensureDir, nowIso, readJson, readJsonl, writeJsonl } from "./paths.js";
import { writeAnalysisMeta } from "./meta.js";

/** 白描硬禁：心理/评价词。desc 里出现即视为「替人物补动机/下判断」。 */
export const WHITE_DESC_HARD_RE = /(心里|心中|内心|觉得|认为|希望|害怕|恐惧|愤怒|悲伤|难过|失望|后悔|其实|显然|精彩|感人|震撼)/;
/** 白描软警告：因果/意图词（原文事实可含，提示改写为动作）。 */
export const WHITE_DESC_SOFT_RE = /(因为|所以|于是|想要|打算|决定)/;

export function validateChapterFacts(facts: any, sourceText: any, index: { n: number; title: string; start: number; end: number }[]) {
    const errors = [];
    const warnings: string[] = [];
    const f = facts ?? {};
    const n = Number(f.n);
    const chapter = index.find((c: any) => c.n === n);
    if (!Number.isInteger(n) || !chapter) {
        errors.push(`章号不存在：${f.n}`);
        return { errors, warnings };
    }
    const text = String(sourceText).slice(chapter.start, chapter.end);
    if (!Array.isArray(f.events) || f.events.length === 0) {
        errors.push("events 不能为空：至少一条白描");
        return { errors, warnings };
    }
    for (const [i, ev] of f.events.entries()) {
        const desc = String(ev?.desc ?? "").trim();
        const quote = String(ev?.quote ?? "").trim();
        if (!desc)
            errors.push(`events[${i}].desc 为空`);
        if (desc.length > 300)
            warnings.push(`events[${i}].desc 超过 300 字，建议拆成两条`);
        if (!quote)
            errors.push(`events[${i}].quote 为空（白描必须带原文引文）`);
        else if (!quoteOk(quote, text))
            errors.push(`events[${i}].quote 在该章原文找不到：${quote.slice(0, 40)}`);
        if (WHITE_DESC_HARD_RE.test(desc))
            errors.push(`events[${i}].desc 含心理/评价词（${desc.match(WHITE_DESC_HARD_RE)?.[0]}）：白描只写动作与结果，动机写进 unknowns`);
        else if (WHITE_DESC_SOFT_RE.test(desc))
            warnings.push(`events[${i}].desc 含因果/意图词（${desc.match(WHITE_DESC_SOFT_RE)?.[0]}）：能改成动作就改`);
    }
    if (!f.hook || typeof f.hook !== "object" || !String(f.hook.text ?? "").trim()) {
        warnings.push("hook.text 为空：本章没有记录章末钩子");
    }
    else {
        if (f.hook.type && !HOOK_TYPES.includes(String(f.hook.type)))
            warnings.push(`hook.type 不在词表：${f.hook.type}（可用：${HOOK_TYPES.join("/")}）`);
        if (f.hook.strength && !HOOK_STRENGTHS.includes(String(f.hook.strength)))
            warnings.push(`hook.strength 应为 弱/中/强：${f.hook.strength}`);
    }
    if (!f.value || typeof f.value !== "object") {
        warnings.push("value 为空：建议记处境/关系/认知/情绪至少两项变化");
    }
    else {
        const filled = ["situation", "relation", "cognition", "emotion"].filter((k: any) => String(f.value[k] ?? "").trim());
        if (filled.length < 2)
            warnings.push("value 少于两项变化：本章的价值推进可能没记全");
    }
    if (f.unknowns !== undefined && !Array.isArray(f.unknowns))
        errors.push("unknowns 必须是数组（原文没写的动机/身份/后果写这里）");
    return { errors, warnings };
}

export async function upsertChapter(paths: StoragePaths, sourceId: any, facts: any, sourceText: any, index: { n: number; title: string; start: number; end: number }[]) {
    const { errors, warnings } = validateChapterFacts(facts, sourceText, index);
    if (errors.length)
        throw new ZhizhangError("bad_facts", `事实未通过：${errors.join("；")}`);
    const p = analysisPaths(paths, sourceId);
    await ensureDir(p.dir);
    let count = 0;
    await withLock(`analysis:${sourceId}`, async () => {
        const rows = await readJsonl(p.chapters);
        const rec = { ...facts, n: Number(facts.n), schemaVersion: 2, updatedAt: nowIso() };
        const at = rows.findIndex((r: any) => Number(r.n) === rec.n);
        if (at >= 0)
            rows[at] = rec;
        else
            rows.push(rec);
        rows.sort((a: any, b: any) => Number(a.n) - Number(b.n));
        await writeJsonl(p.chapters, rows);
        const meta = (await readJson(p.meta, null)) ?? {};
        const scope = meta.scope ?? { mode: "none", chapters: 0 };
        const maxN = rows.reduce((m: any, r: any) => Math.max(m, Number(r.n) || 0), 0);
        const planned = scope.mode === "sample" ? rows.length : scope.mode === "auto" || scope.mode === "full" ? 0 : maxN;
        await writeAnalysisMeta(paths, sourceId, {
            stage: "facts",
            lastRead: Math.max(Number(meta.lastRead ?? 0), rec.n),
            scope: { ...scope, chapters: Math.max(Number(scope.chapters ?? 0), planned) },
        });
        count = rows.length;
    });
    return { warnings, count };
}
