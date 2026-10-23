/**
 * 引文核对 — 全插件唯一来源。
 *
 * 只做「这段引文能否在原文里查到」；不判断卡好不好。
 * 白描、模块 evidence、卡正文引文、审计共用同一套归一化。
 */

/** 归一化：去空白与标点，只留汉字/字母/数字，避免排版差异误杀。 */
export function normalizeQuoteText(input: unknown): string {
    return String(input ?? "")
        .toLowerCase()
        .replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
}

/** 引文核对：整段可查；跨段/省略号则按片段核对（每段≥4字）。 */
export function quoteOk(quote: unknown, text: unknown): boolean {
    const q = normalizeQuoteText(quote);
    if (!q)
        return false;
    const hay = normalizeQuoteText(text);
    if (hay.includes(q))
        return true;
    const frags = String(quote)
        .split(/[…]+|\.{2,}|——+/)
        .map(normalizeQuoteText)
        .filter((f) => f.length >= 4);
    return frags.length > 0 && frags.every((f) => hay.includes(f));
}

/** 卡正文里「声称来自原文」的引文：前后文点明原文/原著/章号，或引文本身≥20字。 */
const STRICT_CONTEXT_RE = /(原文|原著|原书|第\s*[0-9０-９一二三四五六七八九十百千万零〇两]+\s*[章回节]|引用)/;

/**
 * 抽取卡正文里的引文（“…” / 「…」）。
 * 只把「声称来自原文」的引文算进核对范围；其余视为示例引语，跳过。
 */
export function extractBodyQuotes(body: unknown): { quote: string; strict: boolean }[] {
    const text = String(body ?? "");
    const out = [];
    const re = /[“「]([^”」]{8,200})[”」]/g;
    let m;
    while ((m = re.exec(text))) {
        const quote = (m[1] ?? "").trim();
        if (!quote)
            continue;
        const ctx = text.slice(Math.max(0, m.index - 40), Math.min(text.length, m.index + m[0].length + 40));
        const strict = quote.length >= 20 || STRICT_CONTEXT_RE.test(ctx);
        out.push({ quote, strict });
    }
    return out;
}

/** 卡正文引文核对汇总；total 只算 strict。 */
export function verifyBodyQuotes(card: any, sourceText: unknown) {
    const rows = extractBodyQuotes(card?.body);
    const strict = rows.filter((r) => r.strict);
    const bad = strict.filter((r) => !quoteOk(r.quote, sourceText)).map((r) => r.quote);
    return {
        total: strict.length,
        ok: strict.length - bad.length,
        bad,
        skipped: rows.length - strict.length,
    };
}
