/** Shared gate decision types for improvement ports. */
export declare function deny(code: any, text: string): {
    ok: boolean;
    messages: {
        code: any;
        severity: string;
        text: string;
    }[];
};
export declare function allow(messages?: any): {
    ok: boolean;
    messages: any;
};
export declare function warn(code: any, text: string): {
    code: any;
    severity: string;
    text: string;
};
export declare function info(code: any, text: string): {
    code: any;
    severity: string;
    text: string;
};
export declare function mergeDecisions(...parts: any[]): {
    ok: boolean;
    messages: any[];
};
export declare function formatGateMessages(messages: any, opts?: {
    textOnlyInfo?: Set<string>;
}): any;
