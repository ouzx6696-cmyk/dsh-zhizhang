import { type GateDecision } from "./types.js";
export declare const SaveBypassGate: {
    evaluate(opts: {
        /** undefined = content omitted (metadata/status only). */
        contentProvided: boolean;
        wordCount: number;
        confirmBypass: boolean;
        threshold?: number;
    }): GateDecision;
};
