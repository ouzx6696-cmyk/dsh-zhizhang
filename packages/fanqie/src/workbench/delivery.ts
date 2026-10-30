/**
 * 写作台（番茄长篇模式）→ 对话投递的指令文本。
 *
 * 面板只能发三种固定动作，正文仍由 Agent 在会话里创作；投递的是一条普通用户消息，
 * 作者在对话里能看到原文、能打断。作者附言限 300 字，原样附在末尾。
 */
import { readWorkMeta } from "../engine/work-store.js";
import { NovelError } from "../engine/errors.js";

export const DELIVERY_ACTIONS = ["continue", "review", "revise"] as const;
export type DeliveryAction = (typeof DELIVERY_ACTIONS)[number];

export const ENABLE_HINT_FANQIE = "（本会话若还没启用：先 writer_enable mode=fanqie。）";

interface Row { id: string; title: string; position: number; status: string; wordCount?: number }

function label(row: Row) {
    return `第 ${row.position} 章「${row.title}」（${row.id}）`;
}

/** 下一章：按章序第一章还没有正文的（0 字；建章纲时状态是 planned，写了正文也可能仍是 planned，所以看字数）；都写过了就是新的一章 */
export function pickNextChapter(rows: Row[]): Row | undefined {
    return rows.find(r => r.status !== "final" && !(Number(r.wordCount) > 0));
}

export async function buildDeliveryPrompt(dir: string, input: { action: string; chapter?: string; note?: string }) {
    if (!(DELIVERY_ACTIONS as readonly string[]).includes(input.action))
        throw new NovelError("bad_action", `不支持的动作：${input.action}`);
    const action = input.action as DeliveryAction;
    const meta = await readWorkMeta(dir);
    const rows: Row[] = [...((meta as any).chapters ?? [])].sort((a: Row, b: Row) => a.position - b.position);
    const note = (input.note ?? "").trim().slice(0, 300);
    const named = input.chapter ? rows.find(r => r.id === input.chapter) : undefined;
    if (input.chapter && !named)
        throw new NovelError("chapter_not_found", `《${meta.title}》没有这一章：${input.chapter}`);
    const lines: string[] = [];
    let chapterId: string | undefined;
    if (action === "continue") {
        const target = named ?? pickNextChapter(rows);
        chapterId = target?.id;
        const prev = target ? rows.filter(r => r.position < target.position).at(-1) : rows.at(-1);
        lines.push(target
            ? `【写作台】续写《${meta.title}》${label(target)}。`
            : `【写作台】续写《${meta.title}》新的一章（第 ${(rows.at(-1)?.position ?? 0) + 1} 章，章纲还没建，先补章纲再写）。`);
        lines.push(`按长篇日更流程：读${prev ? `上一章${label(prev)}与` : ""}本章章纲，写成候选并自检，再派编辑子代理审读，把审读结论告诉我。不要定稿。`);
    }
    else {
        const target = named;
        if (!target)
            throw new NovelError("chapter_required", action === "review" ? "派编辑审读须指明章节" : "按回报修改须指明章节");
        chapterId = target.id;
        lines.push(action === "review"
            ? `【写作台】派编辑子代理审读《${meta.title}》${label(target)}：完整回读当前正文，按编辑方法出审读回报（fanqie_review_report）。编辑不改正文、不定稿。`
            : `【写作台】按最新编辑审读回报修改《${meta.title}》${label(target)}：只改回报里的硬伤与 L1–L3 位置，出候选并自检，再派编辑复审。不要定稿。`);
    }
    lines.push(ENABLE_HINT_FANQIE);
    if (note)
        lines.push(`作者附言：${note}`);
    return { action, chapterId, text: lines.join("\n") };
}
