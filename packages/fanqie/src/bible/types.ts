export interface Provenance {
  source: "plan" | "ledger" | "author";
  run?: string;
  chapter?: number;
  at: string;
}

export interface Evidence {
  chapter: number;
  quote: string;
  located: boolean;
}

export interface Entity {
  id: string;
  kind: "character" | "item" | "place" | "faction" | "rule" | "term";
  name: string;
  aliases: string[];
  matchCase?: boolean;
  summary: string;
  locked: string[];
  global?: boolean;
  related?: string[];
  provenance: Provenance;
}

export interface StateEntry {
  id: string;
  entity: string;
  field: string;
  value: string;
  since: number;
  until?: number;
  mode: "replace" | "add";
  status: "planned" | "confirmed";
  evidence?: Evidence;
  provenance: Provenance;
}

export interface ThreadBeat {
  chapter: number;
  kind: "plant" | "push" | "pay";
  note: string;
  evidence?: Evidence;
}

export interface Thread {
  id: string;
  title: string;
  kind: "foreshadow" | "mystery" | "promise" | "debt";
  opened: number;
  plannedPayoff?: number;
  beats: ThreadBeat[];
  status: "open" | "paid" | "dropped";
}

export interface KnowledgeRow {
  id: string;
  fact: string;
  holder: string;
  level: "不知" | "怀疑" | "误认" | "知情" | "公开";
  since: number;
  evidence?: Evidence;
}

export interface ChapterRecord {
  chapter: string;
  position: number;
  revision: string;
  summary: string;
  handoff: {
    ending: string;
    openQuestions: string[];
    positions: Record<string, string>;
    carried: string[];
  };
  hook: string;
  emotion: string;
}

export interface StyleContract {
  contract: string;
  rules: Array<{ id: string; condition: string; change: string; why: string }>;
  voiceSamples: string[];
}

export type BibleOp =
  | { type: "entity.upsert"; entity: Entity }
  | { type: "state.add"; entry: StateEntry }
  | { type: "thread.upsert"; thread: Thread }
  | { type: "knowledge.set"; row: KnowledgeRow }
  | { type: "chapter.record"; record: ChapterRecord };

export type SettlementKind = "resolve_short_term" | "settle_long_term" | "update_profile";

export interface PendingItem {
  id: string;
  op: BibleOp;
  evidence?: Evidence;
  located: boolean;
  run?: string;
  conflictsWith?: string;
  settlement?: SettlementKind;
}

export interface Bible {
  entities: Entity[];
  states: StateEntry[];
  threads: Thread[];
  knowledge: KnowledgeRow[];
  chapters: ChapterRecord[];
  style: StyleContract;
  pending: PendingItem[];
}

export interface BibleView {
  position: number;
  entities: Entity[];
  states: StateEntry[];
  threads: Thread[];
  knowledge: KnowledgeRow[];
}

export interface EntityHit {
  entity: Entity;
  count: number;
  firstIndex: number;
  matchedTerm: string;
}

export interface AuditFinding {
  kind: "forgotten_thread" | "due_unpaid" | "knowledge_leak" | "state_conflict";
  severity: "warn" | "bad";
  title: string;
  detail: string;
  refId: string;
}
