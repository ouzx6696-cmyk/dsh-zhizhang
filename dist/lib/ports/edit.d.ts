/**
 * EditPort — optional post-draft edit pass (去AI味/润色) before accept.
 * Aligns with docs/skills/web-novel-master-optimizer.md §0.5 A/B/C.
 * Never silent-accept: A requires confirm_accept_after_edit; unset → B safety default.
 * 0.11.1+: depolish brief keeps breath/rough edges; forbids flattening for “去AI味”.
 */
import { type GateDecision } from "./types.js";
/** Canonical polish modes from the optimizer skill; default = polish-depolish. */
export declare const EDIT_MODE_IDS: readonly ["polish-depolish", "polish-rhythm", "polish-condense", "polish-expand", "polish-style", "polish-literary", "proofread"];
export type EditModeId = (typeof EDIT_MODE_IDS)[number];
/** Category-scoped depolish: polish-depolish-{connector|action|psychology|adjective|tone}. */
export type EditMode = EditModeId | `polish-depolish-${string}`;
export type EditUserChoice = "A" | "B" | "C";
export interface EditModeInfo {
    id: string;
    title: string;
    focus: string;
    lengthHint: string;
}
export interface EditBriefInput {
    mode?: string | null;
    /** Optional one-line shatter / 应落纸 cue from craft. */
    shouldLandLine?: string | null;
    /** Optional chapter situation / conflict for context. */
    situation?: string | null;
}
export interface EditAcceptFlagsInput {
    /** User intent path A: accept this edit as formal chapter. */
    acceptAfterEdit?: boolean;
    /** Explicit one-shot confirm for A. Required when acceptAfterEdit. */
    confirmAcceptAfterEdit?: boolean;
    /** Candidate carries editOf (is an edit result). */
    candidateIsEdit?: boolean;
}
export interface EditSoftHit {
    code: string;
    text: string;
}
export declare const EditPort: {
    id: "port.edit";
    version: string;
    defaultMode: EditModeId;
    skillDoc: string;
    listModes(): EditModeInfo[];
    normalizeMode(raw?: string | null): string;
    modeInfo(mode: string): EditModeInfo;
    /**
     * Agent-facing edit brief — positive craft framing; hard ban-list stays short.
     * Model must NOT claim已定稿; user picks A/B/C after rewrite.
     * Depolish: keep breath & rough edges; forbid flattening for “去AI味”.
     */
    formatEditBrief(input?: EditBriefInput): string;
    /** Parse user/agent choice; null = unset (safety = B). */
    resolveChoice(raw?: string | null): EditUserChoice | null;
    choiceMenuLine(): string;
    /**
     * Soft hints after edit_stage — surface uniform_short_run etc. without blocking.
     */
    softHintLines(hits: EditSoftHit[]): string[];
    /** Receipt lines right after edit_stage (never accept here). */
    afterStageLines(opts: {
        editCandId: string;
        parentCandId: string;
        mode: string;
        chapterId: string;
        softHits?: EditSoftHit[];
    }): string[];
    /**
     * Accept-path flags for A.
     * - acceptAfterEdit without confirm → hard deny (never silent A)
     * - acceptAfterEdit + confirm but candidate not an edit → deny
     * - no acceptAfterEdit → allow (normal / B accept)
     */
    evaluateAcceptFlags(input: EditAcceptFlagsInput): GateDecision;
    /** Receipt extras when A succeeded. */
    acceptPathAReceiptLines(): string[];
    decideChoiceLines(choice: EditUserChoice, opts: {
        candId: string;
        parentId?: string;
        mode?: string;
    }): string[];
};
