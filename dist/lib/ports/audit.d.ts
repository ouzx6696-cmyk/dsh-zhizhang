export declare const StyleLinterPort: {
    lint(text: string): import("../style-linter.js").StyleHit[];
    summarize(hits: any): {
        cliche_syntax: number;
        lazy_emotion: number;
        process_skip: number;
        slogan_ending: number;
    };
    format(label: string, hits: any, summary: any): string;
};
export declare const PayoffAuditorPort: {
    audit(outline: any, body: string, opts: any): {
        ok: boolean;
        warningCount: number;
        findings: ({
            code: string;
            severity: string;
            message: string;
            promise: string;
            evidence?: undefined;
        } | {
            code: string;
            severity: string;
            message: string;
            promise: string;
            evidence: string | undefined;
        } | {
            code: string;
            severity: string;
            message: string;
            evidence: string | undefined;
            promise?: undefined;
        })[];
        checked: {
            endingTokens: string[];
            endingHits: string[];
            endingMisses: string[];
            endingScore: number | null;
            speechPromise: boolean;
            breathReveal: boolean;
        };
    };
    format(label: string, result: any): string;
};
export declare const HumanFeelAuditorPort: {
    /** Pass craftCue so stiffness_tidy matches Accept (shatter cues from craft cards). */
    audit(text: string, opts: any): {
        hitCount: number;
        hits: {
            code: string;
            text: string;
            evidence: string;
        }[];
        summary: string;
    };
    format(label: string, result: any): string;
};
export declare const NovelSenseAuditorPort: {
    audit(text: string, opts: any): {
        hitCount: number;
        hits: {
            code: string;
            text: string;
            evidence: string;
        }[];
        summary: string;
    };
    format(label: string, result: any): string;
};
