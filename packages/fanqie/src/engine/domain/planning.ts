/** Author-approved book and volume plans. Old works may have no planning field. */
import { NovelError } from "../errors.js";
interface PlanSection {content:string;title?:string;source?:unknown;[key:string]:unknown}
interface PlanGroup extends PlanSection {id:string;chapters:string[];volumeId?:string}
interface Planning {[key:string]:unknown;schemaVersion:1;book?:PlanSection;volumes:PlanGroup[];acts:PlanGroup[];updatedAt?:string}
function section(value:unknown):value is PlanSection {
    if (!value || typeof value!=="object" || Array.isArray(value)) return false;
    const p=value as Record<string,unknown>;
    return typeof p.content==="string" && (p.title===undefined || typeof p.title==="string");
}
function group(value:unknown):value is PlanGroup {
    if (!section(value)) return false;
    return typeof value.id==="string" && Array.isArray(value.chapters) && value.chapters.every((c:unknown)=>typeof c==="string") && (value.volumeId===undefined || typeof value.volumeId==="string");
}
export function readPlanning(meta:{planning?:unknown}):Planning|null {
    const p=meta.planning;
    if(p===undefined || p===null) return null;
    if(typeof p!=="object" || Array.isArray(p)) throw new NovelError("bad_planning", "作品规划格式无法识别；请保留元数据并检查。");
    const raw=p as Record<string,unknown>;
    if(raw.schemaVersion!==1 || !Array.isArray(raw.volumes) || !raw.volumes.every(group) || (raw.book!=null && !section(raw.book)) || (raw.acts!==undefined && (!Array.isArray(raw.acts) || !raw.acts.every(group))))
        throw new NovelError("bad_planning", "作品规划格式无法识别；请保留元数据并检查。");
    return {...raw,schemaVersion:1,book:raw.book as PlanSection|undefined,volumes:raw.volumes,acts:(raw.acts ?? []) as PlanGroup[]};
}
function clip(value: string, max: number) { return value.length > max ? `${value.slice(0, max)}\n（后续内容省略；可用 fanqie_inspire_status(work=…) 查看完整规划）` : value; }
function sourceLine(p:PlanSection) {
    const raw=p.source;
    if (!raw || typeof raw!=="object" || Array.isArray(raw)) return "来源未记录";
    const source=raw as Record<string,unknown>;
    const ids=Array.isArray(source.selectedCardIds) ? source.selectedCardIds.filter((x:unknown)=>typeof x==="string").slice(0,24):[];
    const goal=typeof source.authorGoal==="string" ? source.authorGoal:"";
    return `作者目标：${goal.length > 300 ? goal.slice(0, 300) + "…" : goal || "未记录"}；所选参考卡：${ids.length ? ids.join("、") : "无"}；工作区迁移参考：${Array.isArray(source.selectedReferenceIds) ? source.selectedReferenceIds.join("、") || "无" : "无"}（记录选择，不证明实际阅读或具体影响）`;
}
export function formatPlanningBrief(meta: import("../types.js").WorkMeta, chapterId: string) {
    const planning = readPlanning(meta);
    if (!planning) return "";
    const volumes = planning.volumes.filter((v) => v.chapters.includes(chapterId));
    const acts = planning.acts.filter((v) => v.chapters.includes(chapterId));
    const lines: string[] = [];
    if (planning.book) lines.push("## 已采纳全书规划", clip(planning.book.content, 1400), `- ${sourceLine(planning.book)}`);
    for (const volume of volumes.slice(0, 3)) lines.push(`## 已采纳卷规划 · ${volume.title || volume.id}`, clip(volume.content, 1200), `- ${sourceLine(volume)}`);
    for (const act of acts.slice(0, 3)) lines.push(`## 已采纳幕规划 · ${act.title || act.id}`, clip(act.content, 1200), `- ${sourceLine(act)}`);
    if (volumes.length > 3) lines.push(`（另有 ${volumes.length - 3} 个卷规划关联本章，请查看完整规划。）`);
    if (volumes.length > 1) lines.push("（本章关联多个卷规划，请核对归属。）");
    if (acts.length > 3) lines.push(`（另有 ${acts.length - 3} 个幕规划关联本章，请查看完整规划。）`);
    return lines.join("\n");
}
export function formatPlanningStatus(meta: import("../types.js").WorkMeta) {
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
