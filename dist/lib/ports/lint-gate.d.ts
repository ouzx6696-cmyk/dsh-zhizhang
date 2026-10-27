export declare const LintGate: {
    issueToken(dir: string, candidateId: string, hitCount: any, expectedBody?: string): Promise<{
        token: string;
        lintedAt: string;
        hitCount: any;
        chapterId: any;
    }>;
    hitCountOf(cand: any): any;
    evaluateAccept(opts: any): {
        ok: boolean;
        messages: any;
    };
    /** Always include on accept receipt. */
    echoLines(hitCount: any): string[];
};
