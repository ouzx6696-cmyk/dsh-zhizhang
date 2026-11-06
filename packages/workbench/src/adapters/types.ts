/** 服务端回执体：调用方按路由形状收窄；这里只承诺它是 JSON 值。 */
export type Json = unknown;

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
export type SaveDraftInput = {
  root: string;
  id: string;
  text: string;
  expectedRev: number;
  expectedSha256: string;
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
  saveChapter(payload: SaveChapterInput): Promise<Json>;
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
  /** article 为 articleDetail 台账行/详情：adopt 只读 root/id/rev/draft.sha256。 */
  adopt(article: {
    root: string;
    id: string;
    rev: number;
    draft: { sha256: string };
  }): Promise<Json>;
  saveDraft(payload: SaveDraftInput): Promise<Json>;
  deliver(payload: Record<string, unknown>): Promise<Json>;
}

export interface ProfilesData {
  list(signal?: AbortSignal): Promise<Json>;
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
