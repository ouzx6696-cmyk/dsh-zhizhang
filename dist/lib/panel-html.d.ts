/**
 * Styled HTML fragment for zhizhang_panel_snapshot / HTTP snapshot.
 * Class names (zz-*) are the contract the React client and tests assert on.
 * Info architecture aligned with the Web console: 总览 / Library / Inspiration / Writing / 留痕.
 */
import type { BriefBreadcrumb, ChapterStatus, PayoffAuditStored } from "./types.js";
import type { PanelInspirationView, PanelLibraryView, PanelProductView } from "./panel-enrich.js";
export interface PanelHtmlInput {
    workKey: string;
    title: string;
    genre: string;
    totals: {
        chapters: number;
        words: number;
        final: number;
        drafted: number;
        planned: number;
    };
    foundation: {
        locks: string;
        happened: string;
        threads: string;
        style: string;
    };
    chapters: Array<{
        id: string;
        title: string;
        position: number;
        status: ChapterStatus;
        wordCount: number;
        situationLens: string;
        livedScene: string;
        stateLens: string;
        briefRecent: boolean;
    }>;
    candidates: Array<{
        id: string;
        chapterId: string;
        stagedAt: string;
        pending: boolean;
        wordCount: number;
        note: string;
        editOf?: string;
        editMode?: string;
        draftLabel?: string;
        unifyOf?: string[];
        source?: string;
        hasLintPass?: boolean;
        lintHitCount?: number;
    }>;
    ledgerRecent: Array<{
        id: string;
        at: string;
        kind: string;
        chapterId: string;
        summary: string;
    }>;
    briefCrumbsRecent: BriefBreadcrumb[];
    lastPayoffByChapter: Record<string, PayoffAuditStored>;
    nextHints: string[];
    product?: PanelProductView;
    library?: PanelLibraryView;
    inspiration?: PanelInspirationView;
}
export declare function renderPanelHtml(input: PanelHtmlInput): string;
