/**
 * 引文核对 — 全插件唯一来源。
 *
 * 只做「这段引文能否在原文里查到」；不判断卡好不好。
 * 白描、模块 evidence、卡正文引文、审计共用同一套归一化。
 */
/** 归一化：去空白与标点，只留汉字/字母/数字，避免排版差异误杀。 */
export declare function normalizeQuoteText(input: unknown): string;
/** 引文核对：整段可查；跨段/省略号则按片段核对（每段≥4字）。 */
export declare function quoteOk(quote: unknown, text: unknown): boolean;
/**
 * 抽取卡正文里的引文（“…” / 「…」）。
 * 只把「声称来自原文」的引文算进核对范围；其余视为示例引语，跳过。
 */
export declare function extractBodyQuotes(body: unknown): {
    quote: string;
    strict: boolean;
}[];
/** 卡正文引文核对汇总；total 只算 strict。 */
export declare function verifyBodyQuotes(card: any, sourceText: unknown): {
    total: number;
    ok: number;
    bad: string[];
    skipped: number;
};
