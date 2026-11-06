export type CardAxis = "craft" | "mind";
export interface MechanismInput {
  name: string;
  failWhen: string;
  experience?: string;
  rebuild?: string;
  discard?: string;
}
interface HumanFeel {
  writerCraft: string;
  craftRange: string;
  characterState: string;
  stateOnPage: string;
  allowedEdges: string;
  failAsTemplate: string;
}
export type HumanFeelInput = Partial<HumanFeel> & {
  voice?: string;
  voiceRange?: string;
  realness?: string;
  voice_range?: string;
  writer_craft?: string;
  craft_range?: string;
  character_state?: string;
  state_on_page?: string;
  allowed_edges?: string;
  fail_as_template?: string;
};
export interface BookCraft {
  continueWhy: string;
  adjacentChange?: string;
  failAsShortStory?: string;
}
export type BookCraftInput = Partial<BookCraft> & {
  continue_why?: string;
  adjacent_change?: string;
  fail_as_short_story?: string;
};
export interface Mind {
  sellIntoCost: string;
  infoStaging: string;
  pressureMachine: string;
  debtAndSwap: string;
  readerContract: string;
  failAsEncyclopedia: string;
}
export type MindInput = Partial<Mind> & {
  sell_into_cost?: string;
  info_staging?: string;
  pressure_machine?: string;
  debt_and_swap?: string;
  reader_contract?: string;
  fail_as_encyclopedia?: string;
};
export interface Handoff {
  purpose: string;
  experience: string;
  rebuild: string;
  discard: string;
}
export interface CardEvidence {
  quote: string;
  chapter: string | number;
  loc?: string;
}
interface ModuleFields {
  layer?: string;
  dimension?: string;
  readerWant?: string;
  emotionArc?: string;
  dramaticUnit?: string;
  replaceables?: string[];
  mustNotCopy?: string[];
  transfer?: string;
  failWhen?: string;
  evidence?: CardEvidence[];
  steps?: string[];
  bannedDiction?: string[];
}
export interface StageCardInput extends ModuleFields {
  title: string;
  body: string;
  sourceId: string;
  readingRange?: string;
  axis?: string;
  kind?: string;
  tags?: string[];
  mechanisms: MechanismInput[];
  humanFeel?: HumanFeelInput;
  bookCraft?: BookCraftInput;
  mind?: MindInput;
  handoff?: Partial<Handoff>;
}
export interface ImportSourceInput {
  title: string;
  author?: string;
  text?: string;
  file?: string;
  readingRange?: string;
}
export interface CardFilter {
  status?: string;
  sourceId?: string;
  sourceIds?: string[];
  sourceTitle?: string;
  axis?: CardAxis;
  tag?: string;
  limit?: number;
}
export interface ComboInput {
  craftCount?: number;
  query?: string;
  preferMindSourceIds?: string[];
  sourceIds?: string[];
  sourceTitle?: string;
}
interface SourceIndexRow {
  id: string;
  title: string;
  author?: string;
  createdAt?: string;
}
export interface SourceMeta extends SourceIndexRow {
  readingRange?: string;
  charCount?: number;
  excerptPath?: string;
  encoding?: string;
  updatedAt?: string;
}
export interface CardIndexRow {
  id: string;
  title: string;
  sourceId?: string;
  tags?: string[];
  status?: string;
  updatedAt?: string;
  axis?: string;
  layer?: string;
  dimension?: string;
}
export interface LibraryIndex {
  schemaVersion: number;
  sources: SourceIndexRow[];
  cards: CardIndexRow[];
}
export interface TechniqueCard extends ModuleFields {
  schemaVersion: number;
  id: string;
  title: string;
  sourceId: string;
  body: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  axis: CardAxis;
  mechanisms: Required<MechanismInput>[];
  tags: string[];
  readingRange?: string;
  kind?: string;
  humanFeel?: HumanFeel;
  bookCraft?: BookCraft;
  mind?: Mind;
  handoff?: Handoff;
  acceptedAt?: string;
  acceptedCardId?: string;
  readingEvidence?: {
    capturedAt: string;
    sourceHash?: string;
    planMode: string;
    chapters: {
      chapter: number;
      readingLevel: string;
      sourceHash?: string;
      sourceStart?: number;
      sourceMatches: boolean | null;
    }[];
    note: string;
  };
}
