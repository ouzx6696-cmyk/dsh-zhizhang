/** Author-approved book and volume plans. Old works may have no planning field. */
import { ZhizhangError } from "../errors.js";
export function readPlanning(meta: any) {
    const p = meta?.planning;
    if (p === undefined || p === null) return null;
    if (typeof p !== "object" || Array.isArray(p) || p.schemaVersion !== 1 || !Array.isArray(p.volumes) ||
        (p.book != null && (typeof p.book !== "object" || Array.isArray(p.book) || typeof p.book.content !== "string")) ||
        p.volumes.some((v: any) => !v || typeof v !== "object" || typeof v.id !== "string" || typeof v.content !== "string" || !Array.isArray(v.chapters) || v.chapters.some((c: any) => typeof c !== "string")) ||
        (p.acts !== undefined && (!Array.isArray(p.acts) || p.acts.some((v: any) => !v || typeof v !== "object" || typeof v.id !== "string" || typeof v.content !== "string" || !Array.isArray(v.chapters) || v.chapters.some((c: any) => typeof c !== "string")))))
        throw new ZhizhangError("bad_planning", "作品规划格式无法识别；请保留元数据并检查。");
    return { ...p, acts: p.acts ?? [] };
}
function clip(value: string, max: number) { return value.length > max ? `${value.slice(0, max)}\n（后续内容省略；可用 zhizhang_inspire_status(work=…) 查看完整规划）` : value; }
function sourceLine(p: any) {
    const source = p?.source;
    if (!source || typeof source !== "object") return "来源未记录";
    const ids = Array.isArray(source.selectedCardIds) ? source.selectedCardIds.filter((x: any) => typeof x === "string").slice(0, 24) : [];
    const goal = typeof source.authorGoal === "string" ? source.authorGoal : "";
    return `作者目标：${goal.length > 300 ? goal.slice(0, 300) + "…" : goal || "未记录"}；所选参考卡：${ids.length ? ids.join("、") : "无"}（记录选择，不证明实际阅读或具体影响）`;
}
export function formatPlanningBrief(meta: any, chapterId: string) {
    const planning = readPlanning(meta);
    if (!planning) return "";
    const volumes = planning.volumes.filter((v: any) => v.chapters.includes(chapterId));
    const acts = planning.acts.filter((v: any) => v.chapters.includes(chapterId));
    const lines: string[] = [];
    if (planning.book) lines.push("## 已采纳全书规划", clip(planning.book.content, 1400), `- ${sourceLine(planning.book)}`);
    for (const volume of volumes.slice(0, 3)) lines.push(`## 已采纳卷规划 · ${volume.title || volume.id}`, clip(volume.content, 1200), `- ${sourceLine(volume)}`);
    for (const act of acts.slice(0, 3)) lines.push(`## 已采纳幕规划 · ${act.title || act.id}`, clip(act.content, 1200), `- ${sourceLine(act)}`);
    if (volumes.length > 3) lines.push(`（另有 ${volumes.length - 3} 个卷规划关联本章，请查看完整规划。）`);
    if (volumes.length > 1) lines.push("（本章关联多个卷规划，请核对归属。）");
    if (acts.length > 3) lines.push(`（另有 ${acts.length - 3} 个幕规划关联本章，请查看完整规划。）`);
    return lines.join("\n");
}
export function formatPlanningStatus(meta: any) {
    const planning = readPlanning(meta);
    if (!planning) return "尚未保存全书或卷规划。旧作品根基和章纲仍可使用。";
    const lines: string[] = [`# 作品规划 · ${meta.title || meta.key}`];
    if (planning.book) lines.push("", "## 全书规划", planning.book.content, `- ${sourceLine(planning.book)}`);
    else lines.push("", "## 全书规划", "（未设置）");
    if (!planning.volumes.length) lines.push("", "（尚无卷规划）");
    for (const v of planning.volumes) lines.push("", `## ${v.title || v.id}（${v.id}）`, `- 章节：${v.chapters.join("、") || "未指定"}`, v.content, `- ${sourceLine(v)}`);
    for (const a of planning.acts) lines.push("", `## ${a.title || a.id}（${a.id}）`, `- 所属卷：${a.volumeId || "未指定"} · 章节：${a.chapters.join("、") || "未指定"}`, a.content, `- ${sourceLine(a)}`);
    return lines.join("\n");
}
