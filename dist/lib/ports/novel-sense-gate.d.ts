export declare function auditNovelSense(text: string, opts: any): {
    hitCount: number;
    hits: {
        code: string;
        text: string;
        evidence: string;
    }[];
    summary: string;
};
export declare function formatNovelSenseAudit(label: string, result: any): string;
export declare const NovelSenseGate: {
    audit: typeof auditNovelSense;
    evaluateAccept(opts: any): {
        ok: boolean;
        messages: any;
    };
};
