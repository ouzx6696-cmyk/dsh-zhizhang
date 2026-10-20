import { type StoragePaths } from "../store.js";
export type AnalysisLayer = "book" | "arc" | "unit" | "chapter" | "scene" | "line";
export type AnalysisDimension = "structure" | "character" | "rhythm" | "hook" | "prose" | "commercial";
export type HookType = "悬念" | "冲突" | "反差" | "代入" | "信息差" | "反转" | "新角色" | "代价" | "决定" | "发现";
export declare const LAYERS: AnalysisLayer[];
export declare const DIMENSIONS: AnalysisDimension[];
export declare const HOOK_TYPES: HookType[];
export declare const HOOK_STRENGTHS: string[];
export declare const WHITE_DESC_HARD_RE: RegExp;
export declare const WHITE_DESC_SOFT_RE: RegExp;
export interface ChapterFactEvent {
    loc?: string;
    desc: string;
    quote: string;
    unknown?: boolean;
}
export interface ChapterFact {
    schemaVersion?: 2;
    n: number;
    title?: string;
    words?: number;
    events: ChapterFactEvent[];
    functions?: string[];
    hook?: {
        type?: string;
        text?: string;
        strength?: string;
    };
    value?: {
        situation?: string;
        relation?: string;
        cognition?: string;
        emotion?: string;
    };
    unknowns?: string[];
    updatedAt?: string;
}
export interface PlotRecord {
    schemaVersion?: 2;
    id?: string;
    title: string;
    chapters: number[];
    goal: string;
    obstacle: string;
    action: string;
    result: string;
    twist: string;
    turn: string;
    ending?: string;
    threads?: string[];
    updatedAt?: string;
}
export interface RhythmRecord {
    schemaVersion?: 2;
    points: Array<{
        chapter: number;
        emotion: number;
        event?: string;
    }>;
    loops: Array<{
        id?: string;
        range?: [number, number];
        setup: string;
        release: string;
        reaction: string;
        transition: string;
        ratio?: number;
    }>;
    hooks: Array<{
        chapter: number;
        type: string;
        text: string;
        strength?: string;
    }>;
    foreshadowing: Array<{
        name: string;
        planted?: number | string;
        paidOff?: number | string | null;
    }>;
    updatedAt?: string;
}
export interface CharacterRecord {
    schemaVersion?: 2;
    name: string;
    role?: string;
    mask: string;
    truth: string;
    arc: Array<{
        chapter: number | string;
        from: string;
        to: string;
        pressure: string;
    }>;
    function?: string;
    updatedAt?: string;
}
export interface ModuleCardV2 {
    layer: AnalysisLayer;
    dimension: AnalysisDimension;
    axis?: "craft" | "mind";
    readerWant: string;
    emotionArc: string;
    dramaticUnit: string;
    replaceables: string[];
    mustNotCopy: string[];
    transfer: string;
    failWhen: string;
    evidence: Array<{
        quote: string;
        chapter: number | string;
    }>;
}
export interface AnalysisMeta {
    schemaVersion: 2;
    sourceId: string;
    stage: "meta" | "opening" | "facts" | "plots" | "rhythm" | "characters" | "modules" | "report";
    scope: {
        mode: "none" | "opening" | "chapters" | "sample" | "full";
        chapters: number;
    };
    totalChapters: number;
    lastRead: number;
    createdAt?: string;
    updatedAt?: string;
}
export interface AnalysisBundle {
    meta: AnalysisMeta | null;
    chapters: ChapterFact[];
    plots: PlotRecord[];
    rhythms: RhythmRecord;
    characters: CharacterRecord[];
}
export interface AnalysisCoverage {
    facts: number;
    scope: number;
    ratio: number;
    quotePass: number;
    dimensions: number;
    confidence: number;
    needsReview: boolean;
}
export declare function assertSourceId(id: string): string;
export declare function quoteOk(quote: string, text: string): boolean;
export declare function analysisPaths(paths: StoragePaths, sourceId: string): {
    dir: string;
    meta: string;
    chapters: string;
    plots: string;
    rhythms: string;
    characters: string;
    report: string;
};
export declare function chapterIndex(text: string): Array<{
    n: number;
    title: string;
    start: number;
    end: number;
}>;
export declare function totalChapters(index: ReturnType<typeof chapterIndex>): number;
export declare function chapterText(text: string, index: ReturnType<typeof chapterIndex>, n: number): string | null;
export declare function chapterTitle(index: ReturnType<typeof chapterIndex>, n: number): string;
export declare function nearestChapter(index: ReturnType<typeof chapterIndex>, ratio: number): number | null;
export declare function ensureAnalysis(paths: StoragePaths, sourceId: string, sourceText: string): Promise<AnalysisMeta>;
export declare function writeAnalysisMeta(paths: StoragePaths, sourceId: string, patch: Partial<AnalysisMeta>): Promise<AnalysisMeta>;
export declare function readAnalysisBundle(paths: StoragePaths, sourceId: string): Promise<AnalysisBundle>;
export declare function validateChapterFacts(facts: ChapterFact, sourceText: string, index: ReturnType<typeof chapterIndex>): {
    errors: string[];
    warnings: string[];
};
export declare function validatePlot(plot: PlotRecord): {
    errors: string[];
    warnings: string[];
};
export declare function validateRhythm(rhythm: RhythmRecord): {
    errors: string[];
    warnings: string[];
};
export declare function validateCharacter(character: CharacterRecord): {
    errors: string[];
    warnings: string[];
};
export declare function deriveAxis(layer: string, dimension: string): "craft" | "mind";
export declare function validateModule(card: ModuleCardV2 & Record<string, unknown>): {
    errors: string[];
    warnings: string[];
};
export declare function textStats(text: string): {
    chars: number;
    sentences: number;
    avgSentence: number;
    dialogueRatio: number;
};
export declare function computeCoverage(meta: AnalysisMeta | null, facts: ChapterFact[], modules: Array<Record<string, unknown>>, quoteStats: {
    total: number;
    ok: number;
}): AnalysisCoverage;
export declare function buildReport(input: {
    sourceTitle: string;
    meta: AnalysisMeta | null;
    facts: ChapterFact[];
    plots: PlotRecord[];
    rhythms: RhythmRecord;
    characters: CharacterRecord[];
    modules: Array<Record<string, unknown>>;
    coverage: AnalysisCoverage;
    stats: Array<{
        n: number;
        chars: number;
        sentences: number;
        avgSentence: number;
        dialogueRatio: number;
    }>;
    benchmark?: string;
    notes?: string;
}): string;
export declare function upsertChapter(paths: StoragePaths, sourceId: string, facts: ChapterFact, sourceText: string, index: ReturnType<typeof chapterIndex>): Promise<{
    warnings: string[];
    count: number;
}>;
export declare function upsertPlot(paths: StoragePaths, sourceId: string, plot: PlotRecord): Promise<{
    count: number;
}>;
export declare function writeRhythm(paths: StoragePaths, sourceId: string, rhythm: RhythmRecord): Promise<{
    warnings: string[];
    loops: number;
}>;
export declare function upsertCharacter(paths: StoragePaths, sourceId: string, character: CharacterRecord): Promise<{
    count: number;
}>;
export declare function verifyModuleEvidence(card: {
    evidence?: Array<{
        quote?: string;
        chapter?: string | number;
    }>;
}, sourceText: string, index: ReturnType<typeof chapterIndex>): string[];
export declare function listAnalyses(paths: StoragePaths): Promise<Array<{
    sourceId: string;
    stage: string;
    facts: number;
    totalChapters: number;
    scope: AnalysisMeta["scope"];
    plots: number;
    updatedAt?: string;
}>>;
export declare const AnalysisPort: {
    id: string;
    version: string;
    summary: string;
    LAYERS: AnalysisLayer[];
    DIMENSIONS: AnalysisDimension[];
    HOOK_TYPES: HookType[];
};
