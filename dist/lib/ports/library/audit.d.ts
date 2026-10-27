export declare function normForMatch(s: string): string;
export declare function extractEvidence(body: string): {
    heading: null;
    quotes: never[];
} | {
    heading: string;
    quotes: string[];
};
export declare function quoteFragments(q: any): any[];
/** 章号归一：第2章 / 第二章 → "ch2"；序章 → "ch0"。 */
export declare function chapterKey(label: string): string | null;
/** 单卡内容审计：引文能否回溯、章号是否对得上、字段是否占位、mind 是否写成剧情分段。 */
export declare function auditCardContent(card: any, sourceText: any, normSourceCache: any): {
    evidenceQuotes: number;
    evidenceVerified: number;
    skippedShort: string[];
    unverifiable: string[];
    located: any[];
    chapterOk: boolean | null;
    warnings: string[];
};
