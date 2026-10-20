/**
 * Panel / HTTP accept — same hard gates as zhizhang_candidate_accept.
 * Never silent success: missing confirm / gate fail → structured error.
 */
import { type StoragePaths } from "./store.js";
export interface PanelAcceptRequest {
    work: string;
    candidate: string;
    /** UI must always send true after dialog confirm — never silent. */
    confirm: boolean;
    mode?: "replace" | "append";
    force?: boolean;
    lintPassToken?: string;
    skipBrief?: boolean;
    strictLint?: boolean;
    requirePayoff?: boolean;
    strictHuman?: boolean;
    strictNovel?: boolean;
    acceptAfterEdit?: boolean;
    confirmAcceptAfterEdit?: boolean;
}
export interface PanelAcceptOk {
    ok: true;
    candidateId: string;
    chapterId: string;
    title: string;
    wordCount: number;
    status: string;
    receipt: string;
    nextHint: string;
}
export interface PanelAcceptFail {
    ok: false;
    error: string;
    code: string;
    needConfirm?: boolean;
    needEditConfirm?: boolean;
}
/**
 * Run the same AcceptPolicy + store accept + happened append as the tool.
 * Panel always requires `confirm===true` (misclick guard). Edit path A additionally
 * needs confirmAcceptAfterEdit (or acceptAfterEdit+confirmAcceptAfterEdit).
 */
export declare function runPanelAccept(paths: StoragePaths, req: PanelAcceptRequest): Promise<PanelAcceptOk | PanelAcceptFail>;
