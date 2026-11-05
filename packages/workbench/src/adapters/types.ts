export type Json = any;

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, { status = 0, code = "" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type RequestOptions = {
  method?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type DesktopBridge = {
  request: (
    operation: string,
    options: { method?: string; query?: Record<string, unknown>; body?: unknown },
  ) => Promise<{ status: number; data: Json }>;
};

export type SaveChapterInput = {
  base?: string;
  work: string;
  chapter: string;
  body: string;
  expectedRevision: string;
  force?: boolean;
  mode?: "candidate";
  editOf?: string;
  draftLabel?: string;
};
export type SavedChapter = { ok: boolean; chapterId: string; revision?: string; candidateId?: string; status?: string };
export type SaveDraftInput = {
  root: string;
  id: string;
  text: string;
  expectedRev: number;
  expectedSha256: string;
};
export type SavedDraft = {
  rev: number;
  status: string;
  chars: number;
  sha256: string;
  warning?: string;
};

export interface FanqieData {
  projects(refresh?: boolean, signal?: AbortSignal): Promise<Json>;
  snapshot(base?: string, work?: string, signal?: AbortSignal, scope?: string): Promise<Json>;
  chapter(
    base: string | undefined,
    work: string | undefined,
    id: string,
    signal?: AbortSignal,
  ): Promise<Json>;
  saveChapter(payload: SaveChapterInput): Promise<SavedChapter>;
  candidate(
    base: string | undefined,
    work: string | undefined,
    id: string,
    signal?: AbortSignal,
  ): Promise<Json>;
  diagnose(payload: Json, signal?: AbortSignal): Promise<Json>;
  stageRevision(payload: Json): Promise<Json>;
  accept(payload: Json): Promise<Json>;
  chapterAction(action: string, payload: Json): Promise<Json>;
  unifyPrepare(payload: Json): Promise<Json>;
  capabilities(base?: string, signal?: AbortSignal): Promise<Json>;
  deliver(payload: Json): Promise<Json>;
}

export interface ToutiaoData {
  articles(signal?: AbortSignal): Promise<Json>;
  article(root: string, id: string, signal?: AbortSignal): Promise<Json>;
  adopt(article: Json): Promise<Json>;
  saveDraft(payload: SaveDraftInput): Promise<SavedDraft>;
  deliver(payload: Json): Promise<Json>;
}

export interface ProfilesData {
  list(signal?: AbortSignal): Promise<Awaited<ReturnType<typeof import("../../../core/src/profiles.js").listProfiles>>>;
  detail(profile: string, signal?: AbortSignal): Promise<Json>;
  method(profile: string, id: string, signal?: AbortSignal): Promise<Json>;
  use(profile: string): Promise<Json>;
  create(payload: Json): Promise<Json>;
  save(profile: string, id: string, text: string): Promise<Json>;
  reset(profile: string, id: string): Promise<Json>;
  rename(profile: string, name: string, note?: string): Promise<Json>;
  remove(profile: string): Promise<Json>;
}

export interface WorkbenchData {
  host: "desktop";
  fanqie: FanqieData;
  toutiao: ToutiaoData;
  profiles(mode: "fanqie" | "toutiao" | string): ProfilesData;
}
