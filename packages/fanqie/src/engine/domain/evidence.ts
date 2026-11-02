

/** Claimed literal quotations must occur verbatim; fuzzy normalization is diagnostic only. */
export function quoteOk(quote: unknown, text: unknown): boolean {
    const q = String(quote ?? "").trim();
    return q.length > 0 && String(text ?? "").includes(q);
}

/** 卡正文里「声称来自原文」的引文：前后文点明原文/原著/章号，或引文本身≥20字。 */
const STRICT_CONTEXT_RE = /(原文|原著|原书|第\s*[0-9０-９一二三四五六七八九十百千万零〇两]+\s*[章回节]|引用)/;

/**
 * 抽取卡正文里的引文（“…” / 「…」）。
 * 只把「声称来自原文」的引文算进核对范围；其余视为示例引语，跳过。
 */
function extractBodyQuotes(body: unknown): { quote: string; strict: boolean }[] {
    const text = String(body ?? "");
    const out = [];
    const re = /[“「]([^”」]{1,2000})[”」]/g;
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
