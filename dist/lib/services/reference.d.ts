import type { StoragePaths } from "../types.js";
export interface TransferPackage {
    experience: string;
    steps: string[];
    recreate: string[];
    discard: string[];
    failWhen: string;
}
export declare function validateTransfer(value: unknown): TransferPackage;
export declare function analyzeReference(paths: StoragePaths, input: {
    text: string;
    question: string;
    report?: string;
    quotes?: string[];
    transfer?: unknown;
    save?: boolean;
}): Promise<{
    schemaVersion: number;
    id: string;
    sourceHash: string;
    sourceText: string;
    scope: string;
    question: string;
    report: string | undefined;
    quotes: string[];
    transfer: TransferPackage | undefined;
    note: string;
}>;
export declare function readReference(paths: StoragePaths, id: string): Promise<any>;
