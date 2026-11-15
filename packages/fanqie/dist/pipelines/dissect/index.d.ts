import type { PipelineDefinition, StageSpec } from "@zhizhang/core/pipeline";
import { type Infer } from "@zhizhang/core/schema";
export declare const DissectReq: import("@zhizhang/core/schema").Parser<{
    sourceId: string;
    title: string;
    sourcePath: string | undefined;
}>;
export type DissectInput = Infer<typeof DissectReq>;
export interface DissectPlanOutput {
    dimensions: string[];
    focusQuestions: string[];
}
export interface DissectAnalyzeOutput {
    observations: Array<{
        dimension: string;
        finding: string;
        evidence: string;
    }>;
    pacingNotes: string;
}
export interface TechniqueCard {
    id: string;
    title: string;
    category: string;
    pattern: string;
    example: string;
    usage: string;
}
export interface DissectCardsOutput {
    cards: TechniqueCard[];
    summary: string;
}
export interface DissectResult {
    sourceId: string;
    title: string;
    plan: DissectPlanOutput;
    analysis: DissectAnalyzeOutput;
    cards: TechniqueCard[];
    cardCount: number;
    summary: string;
}
export declare const dissectPlanStage: StageSpec<{
    sourceId: string;
    title: string;
    sample: string;
}, DissectPlanOutput>;
export declare const dissectAnalyzeStage: StageSpec<{
    sourceId: string;
    title: string;
    plan: DissectPlanOutput;
    chunks: string[];
}, DissectAnalyzeOutput>;
export declare const dissectCardsStage: StageSpec<{
    sourceId: string;
    title: string;
    analysis: DissectAnalyzeOutput;
}, DissectCardsOutput>;
export declare const dissectPipeline: PipelineDefinition<DissectInput, DissectResult>;
//# sourceMappingURL=index.d.ts.map