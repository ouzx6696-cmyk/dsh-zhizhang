export declare function auditHumanFeel(text: string, opts: any): {
    hitCount: number;
    hits: {
        code: string;
        text: string;
        evidence: string;
    }[];
    summary: string;
};
export declare function formatHumanFeelAudit(label: string, result: any): string;
export declare const HumanFeelGate: {
    audit: typeof auditHumanFeel;
    evaluateAccept(opts: any): {
        ok: boolean;
        messages: any;
    };
};
