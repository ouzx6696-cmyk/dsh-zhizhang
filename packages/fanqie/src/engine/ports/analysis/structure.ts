import { assertNoPendingCard } from "../../storage/card-journal.js";
/** 聚合层：剧情条 / 节奏表 / 人物。 */
import { withResourceLock } from "../../storage/process-lock.js";
import type { StoragePaths } from "../../types.js";
import { NovelError } from "../../errors.js";
import { analysisPaths, ensureDir, nowIso, readJson, readJsonl } from "./paths.js";
import { commitAnalysisUpdate } from "./meta.js";
import { snapshotFile } from "../../storage/recovery-common.js";

export function validatePlot(plot: any) {
    const errors = [];
    const p = plot ?? {};
    if (!String(p.title ?? "").trim())
        errors.push("title 为空");
    if (!Array.isArray(p.chapters) || !p.chapters.length)
        errors.push("chapters 不能为空");
    for (const k of ["goal", "obstacle", "action", "result", "twist", "turn"]) {
        if (!String(p[k] ?? "").trim())
            errors.push(`${k} 为空（剧情条必须六项齐）`);
    }
    return { errors, warnings: [] };
}

export function validateRhythm(r: any) {
    const errors = [];
    const warnings: string[] = [];
    const v = r ?? {};
    if (!Array.isArray(v.points) || !v.points.length)
        errors.push("points 不能为空（情绪折线）");
    else {
        for (const [i, pt] of v.points.entries()) {
            if (!Number.isFinite(Number(pt?.chapter)))
                errors.push(`points[${i}].chapter 非数字`);
            if (!Number.isFinite(Number(pt?.emotion)) || Number(pt.emotion) < -1 || Number(pt.emotion) > 1)
                errors.push(`points[${i}].emotion 应为 -1..1`);
        }
    }
    if (!Array.isArray(v.loops) || !v.loops.length)
        errors.push("loops 不能为空（至少一条爽点循环）");
    else {
        for (const [i, lp] of v.loops.entries()) {
            for (const k of ["setup", "release", "reaction", "transition"]) {
                if (!String(lp?.[k] ?? "").trim())
                    errors.push(`loops[${i}].${k} 为空（铺垫/释放/反应/衔接）`);
            }
            if (!Array.isArray(lp?.range) || lp.range.length !== 2)
                warnings.push(`loops[${i}].range 建议写 [起章, 止章]`);
        }
    }
    if (v.hooks !== undefined && !Array.isArray(v.hooks))
        errors.push("hooks 必须是数组");
    if (v.foreshadowing !== undefined && !Array.isArray(v.foreshadowing))
        errors.push("foreshadowing 必须是数组");
    return { errors, warnings };
}

export function validateCharacter(c: any) {
    const errors = [];
    const v = c ?? {};
    if (!String(v.name ?? "").trim())
        errors.push("name 为空");
    if (!String(v.mask ?? "").trim())
        errors.push("mask 为空（面具：外人看到的样子）");
    if (!String(v.truth ?? "").trim())
        errors.push("truth 为空（真相：压力下才露出的本性）");
    if (!Array.isArray(v.arc) || !v.arc.length)
        errors.push("arc 不能为空（至少一个压力事件）");
    else {
        for (const [i, a] of v.arc.entries()) {
            for (const k of ["chapter", "from", "to", "pressure"]) {
                if (!String(a?.[k] ?? "").trim())
                    errors.push(`arc[${i}].${k} 为空`);
            }
        }
    }
    return { errors, warnings: [] };
}

export async function upsertPlot(paths: StoragePaths, sourceId: any, plot: any) {
    const { errors } = validatePlot(plot);
    if (errors.length)
        throw new NovelError("bad_plot", `剧情条未通过：${errors.join("；")}`);
    const p = analysisPaths(paths, sourceId);
    await ensureDir(p.dir);
    // count 直接取锁内已读的行数，不再为拿个数整读一遍文件。
    let count = 0;
    await withResourceLock(paths.library, async () => {
        await assertNoPendingCard(paths.library);
        const before = await snapshotFile(p.plots);
        const rows = await readJsonl(p.plots);
        const rec = { ...plot, id: plot.id || `p${String(rows.length + 1).padStart(3, "0")}`, schemaVersion: 2, updatedAt: nowIso() };
        const at = rows.findIndex((r: any) => r.id === rec.id);
        if (at >= 0)
            rows[at] = rec;
        else
            rows.push(rec);
        await commitAnalysisUpdate(paths, sourceId, "plots.jsonl", before, rows.length ? rows.map((r: any) => JSON.stringify(r)).join("\n") + "\n" : "", () => ({ stage: "plots" }));
        count = rows.length;
    });
    return { count };
}

export async function writeRhythm(paths: StoragePaths, sourceId: any, rhythm: any) {
    const { errors, warnings } = validateRhythm(rhythm);
    if (errors.length)
        throw new NovelError("bad_rhythm", `节奏表未通过：${errors.join("；")}`);
    const p = analysisPaths(paths, sourceId);
    await ensureDir(p.dir);
    await withResourceLock(paths.library, async () => {
        await assertNoPendingCard(paths.library);
        const before = await snapshotFile(p.rhythms);
        const rec = {
            schemaVersion: 2,
            points: rhythm.points ?? [],
            loops: rhythm.loops ?? [],
            hooks: rhythm.hooks ?? [],
            foreshadowing: rhythm.foreshadowing ?? [],
            updatedAt: nowIso(),
        };
        await commitAnalysisUpdate(paths, sourceId, "rhythms.json", before, `${JSON.stringify(rec, null, 2)}\n`, () => ({ stage: "rhythm" }));
    });
    return { warnings, loops: rhythm.loops?.length ?? 0 };
}

export async function upsertCharacter(paths: StoragePaths, sourceId: any, character: any) {
    const { errors } = validateCharacter(character);
    if (errors.length)
        throw new NovelError("bad_character", `人物未通过：${errors.join("；")}`);
    const p = analysisPaths(paths, sourceId);
    await ensureDir(p.dir);
    let count = 0;
    await withResourceLock(paths.library, async () => {
        await assertNoPendingCard(paths.library);
        const before = await snapshotFile(p.characters);
        const current = await readJson(p.characters, []);
        if (!Array.isArray(current))
            throw new NovelError("bad_analysis", `人物记录格式损坏：${p.characters}；请保留原文件并核对。`);
        const rows = current;
        const rec = { ...character, schemaVersion: 2, updatedAt: nowIso() };
        const at = rows.findIndex((r: any) => r.name === rec.name);
        if (at >= 0)
            rows[at] = rec;
        else
            rows.push(rec);
        await commitAnalysisUpdate(paths, sourceId, "characters.json", before, `${JSON.stringify(rows, null, 2)}\n`, () => ({ stage: "characters" }));
        count = rows.length;
    });
    return { count };
}
