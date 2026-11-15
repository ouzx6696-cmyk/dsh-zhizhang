import { type LockService } from "@zhizhang/core/lock";
import type { PipelineDefinition, StageSpec } from "@zhizhang/core/pipeline";
import { type Infer } from "@zhizhang/core/schema";
export declare const BookPipelineReq: import("@zhizhang/core/schema").Parser<{
    title: string;
    premise: string;
    genre: string | undefined;
    grade: "economy" | "standard" | "premium" | undefined;
    outlineCount: number | undefined;
}>;
export type BookReq = Infer<typeof BookPipelineReq>;
export interface BookCardOutput {
    title: string;
    genre: string;
    hook: string;
    sellingPoints: string[];
    targetAudience: string;
}
export interface BookFoundationOutput {
    protagonist: {
        name: string;
        goal: string;
        flaw: string;
        goldenFinger: string;
    };
    worldview: string;
    powerSystem: string;
    coreConflict: string;
}
export interface BookVolume {
    volume: number;
    title: string;
    summary: string;
    startChapter: number;
    endChapter: number;
}
export interface BookStructureOutput {
    volumes: BookVolume[];
}
export interface ChapterOutlineItem {
    position: number;
    title: string;
    synopsis: string;
    conflict: string;
    hook: string;
}
export interface BookOutlineOutput {
    chapters: ChapterOutlineItem[];
}
export interface BookPlanResult {
    card: BookCardOutput;
    foundation: BookFoundationOutput;
    structure: BookStructureOutput;
    outline: BookOutlineOutput;
    outlineCount: number;
}
export declare const cardStage: StageSpec<BookReq, BookCardOutput>;
export declare const foundationStage: StageSpec<{
    req: BookReq;
    card: BookCardOutput;
}, BookFoundationOutput>;
export declare const structureStage: StageSpec<{
    req: BookReq;
    card: BookCardOutput;
    foundation: BookFoundationOutput;
}, BookStructureOutput>;
export declare const outlineStage: StageSpec<{
    req: BookReq;
    card: BookCardOutput;
    foundation: BookFoundationOutput;
    structure: BookStructureOutput;
    outlineCount: number;
}, BookOutlineOutput>;
export declare function applyBookPlan(workPath: string, runId: string, plan: BookPlanResult, lock?: LockService): Promise<{
    backupDir: string;
    backedUpFiles: string[];
    writtenPlanFiles: string[];
}>;
export declare const bookPipeline: PipelineDefinition<BookReq, BookPlanResult>;
//# sourceMappingURL=index.d.ts.map