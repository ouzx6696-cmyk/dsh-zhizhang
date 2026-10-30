/**
 * 单卡机械审计 — 引文回溯 / 章号对齐 / 字段占位 / mind 剧情分段。
 * 只诊断，不改卡；机械面通过 ≠ 卡能用。
 */
import { chapterIndex } from "../analysis.js";
import { parseChapterNumber } from "../../domain/chapter-heading.js";

const EVIDENCE_QUOTE_RE = /[“"]([^”"\n]{4,240})[”"]/g;

export function normForMatch(s: string) {
    return String(s ?? "").replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "");
}

export function extractEvidence(body: string) {
    const lines = String(body ?? "").split("\n");
    const start = lines.findIndex((line: string) => /^##\s*证据/.test(line));
    if (start < 0)
        return { heading: null, quotes: [] };
    const quotes = [];
    for (let i = start + 1; i < lines.length; i += 1) {
        if (/^##\s/.test(lines[i]))
            break;
        EVIDENCE_QUOTE_RE.lastIndex = 0;
        let mm;
        while ((mm = EVIDENCE_QUOTE_RE.exec(lines[i])))
            quotes.push(mm[1]);
    }
    return { heading: lines[start].trim(), quotes };
}

export function quoteFragments(q: any) {
    return String(q).split(/……|——|\.{3,}/).map((x: any) => x.trim()).filter((x: any) => x.length >= 4);
}

/** 章号归一：第2章 / 第二章 → "ch2"；序章 → "ch0"。 */
export function chapterKey(label: string) {
    const n = parseChapterNumber(label);
    return Number.isFinite(n) ? `ch${n}` : null;
}

function chapterLabelAt(index: { n: number; title: string; start: number }[], pos: number) {
    let hit = null;
    for (const c of index) {
        if (c.start <= pos)
            hit = c;
        else
            break;
    }
    if (!hit)
        return null;
    return hit.n === 0 ? "序章" : `第${hit.n}章`;
}

function locateQuoteChapters(q: any, text: string, index: { n: number; title: string; start: number }[]) {
    const cands = [String(q), ...String(q).split(/[^\u4e00-\u9fa5A-Za-z0-9]+/)]
        .filter((x: any) => x.length >= 8)
        .sort((a: any, b: any) => b.length - a.length);
    const found = new Set();
    for (const frag of cands) {
        let from = 0;
        while (true) {
            const at = text.indexOf(frag, from);
            if (at < 0)
                break;
            const label = chapterLabelAt(index, at);
            if (label)
                found.add(label);
            from = at + 1;
        }
        if (found.size)
            break;
    }
    return found;
}

/** 单卡内容审计：引文能否回溯、章号是否对得上、字段是否占位、mind 是否写成剧情分段。 */
export function auditCardContent(card: any, sourceText: any, normSourceCache: any) {
    const warnings = [];
    const body = String(card.body ?? "");
    const { heading, quotes } = extractEvidence(body);
    const normSource = normSourceCache ?? normForMatch(sourceText);
    const index = chapterIndex(sourceText);
    if (!heading)
        warnings.push("缺「## 证据」段：引文无法核对");
    const unverifiable = [];
    const skipped = [];
    const located = [];
    for (const q of quotes) {
        const frags = quoteFragments(q).map(normForMatch).filter((f: any) => f.length >= 4);
        if (!normSource) {
            unverifiable.push(q);
            continue;
        }
        if (!frags.length) {
            skipped.push(q);
            continue;
        }
        if (!frags.every((f: any) => normSource.includes(f)))
            unverifiable.push(q);
        const chs = locateQuoteChapters(q, sourceText, index);
        if (chs.size === 1) {
            const label = [...chs][0];
            located.push({ key: chapterKey(String(label)) ?? String(label), label: String(label) });
        }
    }
    let chapterOk = null;
    const headChs = heading ? [...heading.matchAll(/第\s*[0-9０-９一二三四五六七八九十百千零两]+\s*[章回节]/g)].map((m: any) => m[0]) : [];
    const headKeys = new Set(headChs.map((c: any) => chapterKey(c)).filter(Boolean));
    if (headChs.length && located.length) {
        const counts = new Map();
        for (const item of located)
            counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
        const top = [...counts.entries()].sort((x: any, y: any) => y[1] - x[1])[0];
        const label = located.find((l: any) => l.key === top[0])?.label ?? top[0];
        if (top[1] >= 2) {
            chapterOk = headKeys.size ? located.some((l: any) => headKeys.has(l.key)) : String(heading ?? "").includes(label);
            if (!chapterOk)
                warnings.push("证据标题章号「" + headChs.join("、") + "」与引文实际位置「" + label + "」不一致");
        }
    }

    const rr = String(card.readingRange ?? "").trim();
    if (!rr || /^见拆书简报$/.test(rr))
        warnings.push("readingRange 仍是占位（见拆书简报）：应写真实抽样范围");
    if (card.axis === "mind") {
        const m = card.mind ?? {};
        const staging = String(m.infoStaging ?? "");
        if (/前段|中段|后段/.test(staging) || /第\s*[0-9０-９一二三四五六七八九十]+\s*章\s*[：:]/.test(staging))
            warnings.push("infoStaging 像剧情分段（第1章/前段/中段/后段）：应写信息按什么顺序交付");
        const pm = String(m.pressureMachine ?? "");
        if (pm && !/vs|VS|→|逼|对/.test(pm))
            warnings.push("pressureMachine 没写出「谁逼谁做什么选择」");
        if (!m.sellIntoCost || String(m.sellIntoCost).length < 20)
            warnings.push("sellIntoCost 过短：卖点与代价可能没写清");
        if (body.includes("## 世界与能力怎么设计"))
            warnings.push("mind 卡仍用旧段「世界与能力怎么设计」：容易写成设定复述");
        if (!/设计决策/.test(body) && !/检验方法/.test(body))
            warnings.push("疑似设定复述（缺「设计决策」与「检验方法」）：脚本只报形状，须人读确认");
    }
    else if (card.axis === "craft") {
        if (!card.humanFeel)
            warnings.push("craft 卡缺 humanFeel");
        else if (!String(card.humanFeel.stateOnPage ?? "").trim())
            warnings.push("humanFeel.stateOnPage 为空");
        if (!/##\s*写法|写法：/.test(body))
            warnings.push("craft 卡缺「写法」段：拿不到这一场怎么写");
    }
    return {
        evidenceQuotes: quotes.length,
        evidenceVerified: quotes.length - unverifiable.length - skipped.length,
        skippedShort: skipped,
        unverifiable,
        located: [...new Set(located.map((l: any) => l.label))],
        chapterOk,
        warnings,
    };
}
