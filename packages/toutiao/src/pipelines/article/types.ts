import type { ClaimCandidate } from "../../domain/claims.js";
import type { ArticleStatus } from "../../domain/status.js";
import type { QaCheckResult } from "../../rules/bridge.js";
import { arr, int, lit, obj, opt, str, type Infer } from "@zhizhang/core/schema";

export const ArticlePipelineReq = obj({
  articleId: str({ min: 1 }),
  genre: str({ min: 1 }),
  driver: str({ min: 1 }),
  line: opt(str()),
  note: opt(str()),
  sourceText: opt(str()),
  sourceKind: opt(lit("paste", "file", "classic")),
  draftCount: opt(int({ min: 1, max: 5 })),
  scriptsDir: opt(str()),
  profileDir: opt(str()),
  ledgerPath: opt(str()),
  recentOpenings: opt(arr(str())),
  recentEndings: opt(arr(str())),
});

export type ArticleReq = Infer<typeof ArticlePipelineReq>;

export interface TitleCandidate {
  text: string;
  motif: string;
}

export interface TitleMatrixOutput {
  main: TitleCandidate;
  alternatives: TitleCandidate[];
}

export interface BlueprintOutput {
  openingStyle: string;
  endingStyle: string;
  sections: Array<{ heading: string; question: string; action: string }>;
  extensionStart?: string;
}

export interface FactCheckOutput {
  claims: Array<{
    id: string;
    status: "supported" | "unsupported" | "unlocated";
    sourceId?: string;
    evidence?: string;
  }>;
}

export interface ReviewIssue {
  kind: "skeleton" | "ai-taste" | "fact" | "pacing";
  quote: string;
  issue: string;
  fix: string;
}

export interface ReviewOutput {
  issues: ReviewIssue[];
  summary: string;
}

export interface AntiGamingCounts {
  oralMarkers: number;
  headings: number;
}

export interface AntiGamingReport {
  before: AntiGamingCounts;
  after: AntiGamingCounts;
  oralDelta: number;
  headingDelta: number;
  warnings: string[];
}

export type QaGate =
  | "pass"
  | {
      score: number;
      passScore: number;
      fails: QaCheckResult["fails"];
      hardGates: string[];
    };

export interface ArticlePipelineResult {
  articleId: string;
  title: string;
  draft: string;
  qa: QaCheckResult;
  claims: ClaimCandidate[];
  antigaming: AntiGamingReport;
  status: ArticleStatus;
  qaGate: QaGate;
}
