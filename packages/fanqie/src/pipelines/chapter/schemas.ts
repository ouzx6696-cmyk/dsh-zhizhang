import { arr, int, lit, num, obj, opt, str, type Infer } from "@zhizhang/core/schema";

export const WritingBriefSchema = obj({
  goal: opt(str({ max: 600 })),
  agreedBeats: opt(arr(str({ min: 1, max: 300 }), { max: 12 })),
  mustKeepQuotes: opt(arr(str({ min: 1, max: 400 }), { max: 10 })),
  avoidPatterns: opt(arr(str({ min: 1, max: 200 }), { max: 10 })),
  boundCardIds: opt(arr(str({ min: 1, max: 120 }), { max: 12 })),
});

export type WritingBrief = Infer<typeof WritingBriefSchema>;

export const ChapterPipelineReq = obj({
  chapterId: str({ min: 1 }),
  position: opt(str()),
  grade: opt(lit("economy", "standard", "premium")),
  golden: opt(lit("true", "false")),
  note: opt(str()),
  brief: opt(WritingBriefSchema),
  targetWords: opt(int({ min: 500, max: 20000 })),
});

export type ChapterReq = Infer<typeof ChapterPipelineReq>;

export interface DraftOutput {
  title: string;
  body: string;
}

export interface BeatsOutput {
  scenes: Array<{
    title: string;
    goal: string;
    conflict: string;
    hook?: string;
  }>;
}

export interface ReviewIssue {
  kind: "continuity" | "reader";
  quote: string;
  issue: string;
  fix: string;
}

export interface ReviewResult {
  verdict: "pass" | "revise" | "reject";
  issues: ReviewIssue[];
  summary: string;
}

export interface ScoreResult {
  score: number;
  strengths: string[];
  weaknesses: string[];
  summary: string;
}

export interface CompareResult {
  winner: "A" | "B" | "tie";
  reason: string;
}

export interface GateReport {
  passed: boolean;
  wordCount: number;
  reasons: string[];
  hits: string[];
}

export interface ChapterRunResult {
  title: string;
  body: string;
  beats: BeatsOutput;
  gate: GateReport;
  review: ReviewResult;
  editorPass: boolean;
  editorRejections: number;
}

export interface ChapterPipelineState extends Record<string, unknown> {
  outlineText?: string;
  grade?: "economy" | "standard" | "premium";
  beats?: BeatsOutput;
  passingDrafts?: DraftOutput[];
  topTwo?: [DraftOutput, DraftOutput];
  currentDraft?: DraftOutput;
  pendingIssues?: ReviewIssue[];
}

export const BeatsSchema = obj({
  scenes: arr(
    obj({
      title: str({ min: 1 }),
      goal: str({ min: 1 }),
      conflict: str({ min: 1 }),
      hook: opt(str()),
    }),
    { max: 20 },
  ),
});

export const ReviewIssueSchema = obj({
  kind: lit("continuity", "reader"),
  quote: str(),
  issue: str({ min: 1 }),
  fix: str({ min: 1 }),
});

export const ReviewResultSchema = obj({
  verdict: lit("pass", "revise", "reject"),
  issues: arr(ReviewIssueSchema, { max: 50 }),
  summary: str({ min: 1 }),
});

export const ContinuityResultSchema = obj({
  issues: arr(ReviewIssueSchema, { max: 50 }),
});

export const ScoreResultSchema = obj({
  score: num({ min: 0, max: 100 }),
  strengths: arr(str(), { max: 10 }),
  weaknesses: arr(str(), { max: 10 }),
  summary: str({ min: 1 }),
});

export const CompareResultSchema = obj({
  winner: lit("A", "B", "tie"),
  reason: str({ min: 1 }),
});

export const DraftJsonSchema = obj({
  title: str({ min: 1 }),
  body: str({ min: 1 }),
});
