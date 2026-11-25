export interface ProfileSummaryView {
  id: string;
  name: string;
  base?: string;
  note?: string;
  builtin: boolean;
}

export interface ProfileFileView {
  id: string;
  size: number;
  modified?: boolean;
}

export interface ProfileMethodView {
  id: string;
  text: string;
  from: "builtin" | "user";
}

export interface TechniqueCardView {
  id: string;
  title: string;
  category: string;
  pattern: string;
  example: string;
  usage: string;
  layer?: "book" | "arc" | "unit" | "chapter" | "scene" | "line";
  dimension?: "structure" | "character" | "rhythm" | "hook" | "prose" | "commercial";
  readerWant?: string;
  emotionArc?: string;
  dramaticUnit?: string;
  replaceables?: string[];
  mustNotCopy?: string[];
  transfer?: string;
  failWhen?: string;
  steps?: string[];
  bannedDiction?: string[];
  quoteStatus?: "verified" | "partial" | "unverified";
  quoteLine?: number;
}

export interface ReferenceBindingView {
  sourceId: string;
  cardIds: string[];
  scope?: "work" | "chapter";
  chapterId?: string;
  boundAt: string;
}
