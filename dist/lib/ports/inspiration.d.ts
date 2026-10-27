import type { StoragePaths } from "../types.js";
export declare const InspirationPort: {
    id: string;
    status: string;
    title: string;
    summary: string;
    capabilities(): {
        id: string;
        title: string;
        ready: boolean;
    }[];
    startSession(paths: StoragePaths, input: any): Promise<{
        sessionId: string;
        craftOnly: boolean;
        mindCount: number;
        craftCount: number;
    }>;
    getSession(paths: StoragePaths, sessionId: any): Promise<any>;
    listSessions(paths: StoragePaths): Promise<{
        id: any;
        goal: any;
        genre: any;
        cardIds: any;
        forgeAt: any;
        updatedAt: any;
    }[]>;
    /** Previously applied candidates remain available as an author-readable decision history. */
    listWorkHistory(paths: StoragePaths, workKey: string): Promise<{
        total: number;
        rows: {
            id: any;
            kind: any;
            title: any;
            at: any;
        }[];
    }>;
    getCandidate(paths: StoragePaths, candidateId: string): Promise<any>;
    forgeBrief(paths: StoragePaths, sessionId: any): Promise<string>;
    stageEmit(paths: StoragePaths, sessionId: any, input: any): Promise<{
        candId: string;
        kind: any;
        styleReminder: string;
    }>;
    acceptEmit(paths: StoragePaths, candId: any, opts: any): Promise<{
        candId: string;
        applied: boolean;
        workKey: string;
        detail: string;
        bindingWarning: string;
    }>;
    /**
     * Resolve technique cards for chapter_brief / writing path.
     * Priority: explicit cardIds → inspire sessions applied to work → none.
     * 不做「按 genre 猜卡」：技法卡不含题材词，猜出来也是无关卡。
     */
    resolveCardsForBrief(paths: StoragePaths, opts?: any): Promise<{
        cards: any[];
        source: string;
        note: string;
        cardIds: any[];
    }>;
    /**
     * Craft shatter/feel cue blob for Accept + human_feel_audit (same source).
     * Empty string when no craft cards or cues.
     */
    resolveCraftCue(paths: StoragePaths, opts?: any): Promise<string>;
    /**
     * Markdown section for chapter_brief.
     * lean：只主注 craft（写法+状态）；mind 不整段灌句式。
     */
    formatCardsSection(cards: any, meta: any): string;
};
