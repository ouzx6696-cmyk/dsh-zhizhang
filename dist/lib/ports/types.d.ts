/** Shared gate decision types for improvement ports. */
export type GateSeverity = "error" | "warning" | "info";
export interface GateMessage {
    code: string;
    severity: GateSeverity;
    text: string;
}
/** ok===false means hard refuse; warnings still allow when ok===true. */
export interface GateDecision {
    ok: boolean;
    messages: GateMessage[];
}
export declare function deny(code: string, text: string): GateDecision;
export declare function allow(messages?: GateMessage[]): GateDecision;
export declare function warn(code: string, text: string): GateMessage;
export declare function info(code: string, text: string): GateMessage;
export declare function mergeDecisions(...parts: GateDecision[]): GateDecision;
export declare function formatGateMessages(messages: GateMessage[]): string[];
