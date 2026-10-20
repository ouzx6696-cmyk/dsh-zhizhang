import { type StoragePaths } from "../store.js";
import { type TechniqueCard } from "./library.js";
import type { PillarStatus } from "./library.js";
export interface InspirationCapability {
    id: string;
    title: string;
    ready: boolean;
}
export interface InspirationSession {
    schemaVersion: 1;
    id: string;
    goal: string;
    genre: string;
    cardIds: string[];
    /** 0.7.0：仅技法试写（无 mind 卡时须显式） */
    craftOnly?: boolean;
    createdAt: string;
    updatedAt: string;
    forgeAt?: string;
    lastBriefPreview?: string;
}
export type InspireEmitKind = "foundation" | "outline";
export interface InspirationCandidate {
    schemaVersion: 1;
    id: string;
    sessionId: string;
    kind: InspireEmitKind;
    payload: Record<string, unknown>;
    status: "staged" | "accepted";
    createdAt: string;
    updatedAt: string;
    acceptedAt?: string;
    appliedWorkKey?: string;
}
export declare const InspirationPort: {
    id: "port.inspiration";
    status: PillarStatus;
    title: string;
    summary: string;
    capabilities(): InspirationCapability[];
    startSession(paths: StoragePaths, input: {
        goal: string;
        genre?: string;
        cardIds: string[];
        craftOnly?: boolean;
    }): Promise<{
        sessionId: string;
        craftOnly: boolean;
        mindCount: number;
        craftCount: number;
    }>;
    getSession(paths: StoragePaths, sessionId: string): Promise<InspirationSession>;
    listSessions(paths: StoragePaths): Promise<Array<Pick<InspirationSession, "id" | "goal" | "genre" | "cardIds" | "forgeAt" | "updatedAt">>>;
    forgeBrief(paths: StoragePaths, sessionId: string): Promise<string>;
    stageEmit(paths: StoragePaths, sessionId: string, input: {
        kind: InspireEmitKind;
        payload: Record<string, unknown>;
    }): Promise<{
        candId: string;
        kind: InspireEmitKind;
        styleReminder: string;
    }>;
    acceptEmit(paths: StoragePaths, candId: string, opts: {
        workKey: string;
        apply?: boolean;
        title?: string;
        genre?: string;
        premise?: string;
    }): Promise<{
        candId: string;
        applied: boolean;
        workKey: string;
        detail: string;
    }>;
    /**
     * Resolve technique cards for chapter_brief / writing path.
     * Priority: explicit cardIds → inspire sessions applied to work → genre tag search → none.
     */
    resolveCardsForBrief(paths: StoragePaths, opts?: {
        cardIds?: string[];
        workKey?: string;
        genre?: string;
        limit?: number;
    }): Promise<{
        cards: TechniqueCard[];
        source: "explicit" | "inspire_apply" | "genre_tags" | "none";
        note: string;
        cardIds: string[];
    }>;
    /**
     * Craft shatter/feel cue blob for Accept + human_feel_audit (same source).
     * Empty string when no craft cards or cues.
     */
    resolveCraftCue(paths: StoragePaths, opts?: {
        workKey?: string;
        cardIds?: string[];
        genre?: string;
        limit?: number;
    }): Promise<string>;
    /**
     * Markdown section for chapter_brief.
     * lean：只主注 craft（写法+状态）；mind 不整段灌句式。
     */
    formatCardsSection(cards: TechniqueCard[], meta: {
        source: string;
        note: string;
        lean?: boolean;
    }): string;
};
