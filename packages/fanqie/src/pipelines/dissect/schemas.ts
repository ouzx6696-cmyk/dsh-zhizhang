import { arr, int, lit, obj, opt, str, type Infer } from "@zhizhang/core/schema";

export const DissectReq = obj({
  sourceId: str({ min: 1 }),
  title: str({ min: 1 }),
  sourcePath: opt(str()),
});

export type DissectInput = Infer<typeof DissectReq>;

export interface DissectPlanOutput {
  dimensions: string[];
  focusQuestions: string[];
}

export interface DissectAnalyzeOutput {
  observations: Array<{ dimension: string; finding: string; evidence: string }>;
  pacingNotes: string;
}

export type TechniqueLayer = "book" | "arc" | "unit" | "chapter" | "scene" | "line";
export type TechniqueDimension =
  "structure" | "character" | "rhythm" | "hook" | "prose" | "commercial";

export const TechniqueCardSchema = obj({
  id: str({ min: 1 }),
  title: str({ min: 1 }),
  category: str({ min: 1 }),
  pattern: str({ min: 1 }),
  example: str(),
  usage: str(),
  layer: opt(lit("book", "arc", "unit", "chapter", "scene", "line")),
  dimension: opt(lit("structure", "character", "rhythm", "hook", "prose", "commercial")),
  readerWant: opt(str()),
  emotionArc: opt(str()),
  dramaticUnit: opt(str()),
  replaceables: opt(arr(str({ min: 1 }), { max: 12 })),
  mustNotCopy: opt(arr(str({ min: 1 }), { max: 12 })),
  transfer: opt(str()),
  failWhen: opt(str()),
  steps: opt(arr(str({ min: 1 }), { max: 12 })),
  bannedDiction: opt(arr(str({ min: 1 }), { max: 12 })),
  quoteStatus: opt(lit("verified", "partial", "unverified")),
  quoteLine: opt(int({ min: 1 })),
});

export type TechniqueCard = Infer<typeof TechniqueCardSchema>;

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
  sampling: {
    totalChars: number;
    chapterCount: number;
    sampledCount: number;
    readScope: "full" | "sampled";
    hookSummary: string;
  };
  quoteAudit: { verified: number; partial: number; unverified: number };
}

export const DissectPlanSchema = obj({
  dimensions: arr(str({ min: 1 }), { max: 12 }),
  focusQuestions: arr(str({ min: 1 }), { max: 20 }),
});

export const DissectAnalyzeSchema = obj({
  observations: arr(
    obj({
      dimension: str({ min: 1 }),
      finding: str({ min: 1 }),
      evidence: str({ min: 1 }),
    }),
    { max: 40 },
  ),
  pacingNotes: str({ min: 1 }),
});

export const DissectCardsSchema = obj({
  cards: arr(TechniqueCardSchema, { max: 30 }),
  summary: str({ min: 1 }),
});
