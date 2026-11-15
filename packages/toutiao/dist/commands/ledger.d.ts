import { type Infer } from "@zhizhang/core/schema";
import { type LedgerMutateResult, type LedgerShowResult } from "../rules/bridge.js";
export declare const LedgerShowReq: import("@zhizhang/core/schema").Parser<{
    ledgerPath: string;
    last: number | undefined;
    scriptsDir: string | undefined;
}>;
export declare const LedgerAddReq: import("@zhizhang/core/schema").Parser<{
    cardPath: string;
    ledgerPath: string;
    articleId: string | undefined;
    status: string | undefined;
    date: string | undefined;
    scriptsDir: string | undefined;
}>;
export declare const LedgerStatusReq: import("@zhizhang/core/schema").Parser<{
    title: string;
    to: string;
    ledgerPath: string;
    articleId: string | undefined;
    scriptsDir: string | undefined;
}>;
export declare const MetricsImportReq: import("@zhizhang/core/schema").Parser<{
    articleId: string;
    metricsJson: string;
    ledgerPath: string;
    url: string | undefined;
    scriptsDir: string | undefined;
}>;
export type LedgerShowInput = Infer<typeof LedgerShowReq>;
export type LedgerAddInput = Infer<typeof LedgerAddReq>;
export type LedgerStatusInput = Infer<typeof LedgerStatusReq>;
export type MetricsImportInput = Infer<typeof MetricsImportReq>;
export declare function ledgerShowCommand(rawInput: unknown): Promise<LedgerShowResult>;
export declare function ledgerAddCommand(rawInput: unknown): Promise<LedgerMutateResult>;
export declare function ledgerStatusCommand(rawInput: unknown): Promise<LedgerMutateResult>;
export declare function metricsImportCommand(rawInput: unknown): Promise<LedgerMutateResult>;
//# sourceMappingURL=ledger.d.ts.map