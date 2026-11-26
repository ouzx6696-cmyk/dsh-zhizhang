import {
  arr,
  int,
  lit,
  obj,
  opt,
  record,
  str,
  unknownValue,
  type Infer,
} from "@zhizhang/core/schema";
import type { ClaimCandidate } from "../../domain/claims.js";
import type { ArticleStatus } from "../../domain/status.js";
import type { QaCheckResult } from "../../rules/bridge.js";

export const ArticlePipelineReq = obj({
  articleId: str({ min: 1 }),
  genre: str({ min: 1 }),
  driver: str({ min: 1 }),
  line: opt(str()),
  note: opt(str()),
  sourceText: opt(str()),
  sourceKind: opt(lit("paste", "file", "classic")),
  draftCount: opt(int({ min: 1, max: 5 })),
  profileDir: opt(str()),
  ledgerPath: opt(str()),
  recentOpenings: opt(arr(str())),
  recentEndings: opt(arr(str())),
});

export type ArticleReq = Infer<typeof ArticlePipelineReq>;

export const CardOutputSchema = record(unknownValue);

export const TitleCandidateSchema = obj(
  {
    text: str({ min: 1 }),
    motif: str({ min: 1 }),
  },
  { strict: false },
);

export const TitleMatrixOutputSchema = obj(
  {
    main: TitleCandidateSchema,
    alternatives: opt(arr(TitleCandidateSchema)),
  },
  { strict: false },
);

export const BlueprintOutputSchema = obj(
  {
    openingStyle: str(),
    endingStyle: str(),
    sections: arr(
      obj(
        {
          heading: str(),
          question: str(),
          action: str(),
        },
        { strict: false },
      ),
    ),
    extensionStart: opt(str()),
  },
  { strict: false },
);

export const FactCheckOutputSchema = obj(
  {
    claims: arr(
      obj(
        {
          id: str({ min: 1 }),
          status: lit("supported", "unsupported", "unlocated"),
          sourceId: opt(str()),
          evidence: opt(str()),
        },
        { strict: false },
      ),
    ),
  },
  { strict: false },
);

export const ReviewIssueSchema = obj(
  {
    kind: lit("skeleton", "ai-taste", "fact", "pacing"),
    quote: str(),
    issue: str(),
    fix: str(),
  },
  { strict: false },
);

export const ReviewOutputSchema = obj(
  {
    issues: arr(ReviewIssueSchema),
    summary: str(),
  },
  { strict: false },
);

export type TitleCandidate = Infer<typeof TitleCandidateSchema>;
export interface TitleMatrixOutput {
  main: TitleCandidate;
  alternatives: TitleCandidate[];
}
export type BlueprintOutput = Infer<typeof BlueprintOutputSchema>;
export type FactCheckOutput = Infer<typeof FactCheckOutputSchema>;
export type ReviewIssue = Infer<typeof ReviewIssueSchema>;
export type ReviewOutput = Infer<typeof ReviewOutputSchema>;

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

export interface ArticlePipelineResult {
  articleId: string;
  title: string;
  draft: string;
  qa: QaCheckResult;
  claims: ClaimCandidate[];
  antigaming: AntiGamingReport;
  status: ArticleStatus;
}

export interface ArticlePipelineState extends Record<string, unknown> {
  draftTrack?: "news" | "story" | "micro";
  finalStatus?: ArticleStatus;
  selectedDraftIndex?: number;
}
