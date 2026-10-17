/**
 * Local on-disk store for dsh-zhizhang (Writing + shared path roots).
 *
 * Layout under <root>/.zhizhang/ (or config.rootDir):
 *   works/<key>/…          — Writing (live)
 *   manuscripts/<key>.md   — Writing assemble
 *   library/…              — Library pillar (sources, cards, candidates) via LibraryPort
 *   inspiration/…          — Inspiration pillar (sessions, candidates) via InspirationPort
 *
 * Sections below (search markers):
 *   § utilities · § storage paths · § works · § chapters · § ledger
 *   § candidates · § brief crumbs · § payoff audits · § panel · § assemble
 *
 * Patterns: atomic write, path sandbox, process-local locks, CJK-aware word count.
 * Strategy decisions stay in ports/; this module only persists and queries.
 */
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CHAPTER_STATUSES,
  EMPTY_FOUNDATION,
  EMPTY_OUTLINE,
  SCHEMA_VERSION,
  type BriefBreadcrumb,
  type BriefCrumbFile,
  type CandidateFile,
  type ChapterMeta,
  type ChapterRecord,
  type ChapterStatus,
  type Foundation,
  type LedgerEntry,
  type LedgerFile,
  type Outline,
  type PayoffAuditFile,
  type PayoffAuditStored,
  type WorkMeta,
} from "./types.js";
import { ZhizhangError } from "./errors.js";

const locks = new Map<string, Promise<unknown>>();
let tmpSeq = 0;


// —— § utilities (lock, count, slug) ——
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => gate);
  locks.set(key, current);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

export function countWords(text: string): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  const cjk =
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latin;
}

const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function slugify(title: string): string {
  const cleaned = Array.from(
    String(title ?? "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, ""),
  )
    .slice(0, 60)
    .join("");
  if (cleaned.length === 0) return `work-${Date.now().toString(36)}`;
  return RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function sessionCwd(exec: unknown): string {
  const cwd = (exec as { agent?: { session?: { header?: { cwd?: string } } } })?.agent?.session?.header
    ?.cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : process.cwd();
}


// —— § storage paths ——
export interface StoragePaths {
  base: string;
  works: string;
  manuscripts: string;
  library: string;
  inspiration: string;
}

export function storagePaths(
  exec: unknown,
  config: { rootDir?: string; storageRoot?: string } | undefined,
  workingDir?: string,
): StoragePaths {
  const cwd = sessionCwd(exec);
  let base: string;
  if (workingDir !== undefined && workingDir !== "") {
    base = path.isAbsolute(workingDir) ? workingDir : path.resolve(cwd, workingDir);
  } else if (config?.storageRoot) {
    base = path.resolve(config.storageRoot);
  } else {
    base = path.resolve(cwd, config?.rootDir ?? ".zhizhang");
  }
  return {
    base,
    works: path.join(base, "works"),
    manuscripts: path.join(base, "manuscripts"),
    library: path.join(base, "library"),
    inspiration: path.join(base, "inspiration"),
  };
}

export async function ensureStorage(
  exec: unknown,
  config: { rootDir?: string; storageRoot?: string } | undefined,
  workingDir?: string,
): Promise<StoragePaths> {
  const paths = storagePaths(exec, config, workingDir);
  await mkdir(paths.works, { recursive: true });
  await mkdir(paths.manuscripts, { recursive: true });
  await mkdir(paths.library, { recursive: true });
  await mkdir(paths.inspiration, { recursive: true });
  return paths;
}

export async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${tmpSeq++}.tmp`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, file);
}

function assertInside(base: string, target: string, label: string): string {
  const resolved = path.resolve(target);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`${label} 越界：${target}`);
  }
  return resolved;
}

export function workDir(paths: StoragePaths, key: string): string {
  const safe = slugify(key);
  if (safe.includes("..") || path.isAbsolute(safe)) throw new Error("作品 key 非法");
  return assertInside(paths.works, path.join(paths.works, safe), "作品目录");
}

function metaPath(dir: string): string {
  return path.join(dir, "meta.json");
}
function chaptersDir(dir: string): string {
  return path.join(dir, "chapters");
}
function ledgerPath(dir: string): string {
  return path.join(dir, "ledger.json");
}
function candidatesDir(dir: string): string {
  return path.join(dir, "candidates");
}
function briefCrumbsPath(dir: string): string {
  return path.join(dir, "brief-crumbs.json");
}
function payoffAuditsPath(dir: string): string {
  return path.join(dir, "payoff-audits.json");
}

/** Recency window for brief / payoff soft·hard checks on accept (12h). */
export const BRIEF_RECENT_MS = 12 * 60 * 60 * 1000;

/** chapter_save: body over this word count needs confirm_bypass=true. */
export const SAVE_BYPASS_WORD_THRESHOLD = 200;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeOutline(raw: Partial<Outline> | null | undefined): Outline {
  const base = EMPTY_OUTLINE();
  if (!raw || typeof raw !== "object") return base;
  return {
    pov: String(raw.pov ?? ""),
    targetWords: typeof raw.targetWords === "number" && raw.targetWords > 0 ? raw.targetWords : 2500,
    locks: String(raw.locks ?? ""),
    knowledge: String(raw.knowledge ?? ""),
    synopsis: String(raw.synopsis ?? ""),
    conflict: String(raw.conflict ?? ""),
    beats: String(raw.beats ?? ""),
    ending: String(raw.ending ?? ""),
    situationLens: String(raw.situationLens ?? ""),
    livedScene: String(raw.livedScene ?? ""),
    // 0.6: stateLens; legacy voiceTone still readable
    stateLens: String(
      (raw as { stateLens?: unknown }).stateLens ??
        (raw as { voiceTone?: unknown }).voiceTone ??
        "",
    ),
  };
}

function normalizeFoundation(raw: Partial<Foundation> | null | undefined): Foundation {
  const base = EMPTY_FOUNDATION();
  if (!raw || typeof raw !== "object") return base;
  return {
    locks: String(raw.locks ?? ""),
    happened: String(raw.happened ?? ""),
    characters: String(raw.characters ?? ""),
    readerKnowledge: String(raw.readerKnowledge ?? ""),
    planned: String(raw.planned ?? ""),
    threads: String(raw.threads ?? ""),
    style: String(raw.style ?? ""),
  };
}

function chapterFile(dir: string, id: string): string {
  return path.join(chaptersDir(dir), `${id}.md`);
}

function serializeChapterMarkdown(record: ChapterRecord): string {
  const fm = {
    id: record.id,
    title: record.title,
    position: record.position,
    status: record.status,
    wordCount: record.wordCount,
    updatedAt: record.updatedAt,
    outline: record.outline,
  };
  return `---\n${JSON.stringify(fm, null, 2)}\n---\n\n${record.body ?? ""}\n`;
}

function parseChapterMarkdown(raw: string, fallbackId: string): ChapterRecord {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return {
      id: fallbackId,
      title: fallbackId,
      position: 0,
      status: "drafting",
      wordCount: countWords(raw),
      updatedAt: nowIso(),
      body: raw,
      outline: EMPTY_OUTLINE(),
    };
  }
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(match[1]!) as Record<string, unknown>;
  } catch {
    throw new Error(`章节 front matter 不是合法 JSON：${fallbackId}`);
  }
  // serializeChapterMarkdown always appends a trailing newline; strip it on read.
  const body = (match[2] ?? "").replace(/^\n/, "").replace(/\n$/, "");
  const status = CHAPTER_STATUSES.includes(meta.status as ChapterStatus)
    ? (meta.status as ChapterStatus)
    : "drafting";
  return {
    id: String(meta.id ?? fallbackId),
    title: String(meta.title ?? fallbackId),
    position: typeof meta.position === "number" ? meta.position : 0,
    status,
    wordCount: countWords(body),
    updatedAt: String(meta.updatedAt ?? nowIso()),
    body,
    outline: normalizeOutline(meta.outline as Partial<Outline>),
  };
}


// —— § works ——
export async function createWork(
  paths: StoragePaths,
  input: { title: string; genre?: string; premise?: string; key?: string },
): Promise<{ meta: WorkMeta; dir: string }> {
  const key = slugify(input.key?.trim() || input.title);
  let dir = workDir(paths, key);
  let finalKey = path.basename(dir);
  if (await exists(metaPath(dir))) {
    finalKey = `${key}-${Date.now().toString(36)}`;
    dir = workDir(paths, finalKey);
  }
  await mkdir(chaptersDir(dir), { recursive: true });
  await mkdir(candidatesDir(dir), { recursive: true });
  const stamp = nowIso();
  const meta: WorkMeta = {
    schemaVersion: SCHEMA_VERSION,
    key: finalKey,
    title: input.title.trim(),
    genre: (input.genre ?? "").trim(),
    premise: (input.premise ?? "").trim(),
    foundation: EMPTY_FOUNDATION(),
    createdAt: stamp,
    updatedAt: stamp,
    chapters: [],
  };
  await atomicWrite(metaPath(dir), JSON.stringify(meta, null, 2) + "\n");
  await atomicWrite(
    ledgerPath(dir),
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, workKey: finalKey, entries: [] } satisfies LedgerFile, null, 2) +
      "\n",
  );
  return { meta, dir };
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

export async function listWorks(paths: StoragePaths): Promise<WorkMeta[]> {
  let names: string[];
  try {
    names = await readdir(paths.works);
  } catch {
    return [];
  }
  const rows: WorkMeta[] = [];
  for (const name of names) {
    const file = metaPath(path.join(paths.works, name));
    try {
      const meta = JSON.parse(await readFile(file, "utf8")) as WorkMeta;
      rows.push(meta);
    } catch {
      /* skip broken */
    }
  }
  rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return rows;
}

export async function readWorkMeta(dir: string): Promise<WorkMeta> {
  const raw = await readFile(metaPath(dir), "utf8");
  const meta = JSON.parse(raw) as WorkMeta;
  meta.foundation = normalizeFoundation(meta.foundation);
  meta.chapters = Array.isArray(meta.chapters) ? meta.chapters : [];
  return meta;
}

export async function writeWorkMeta(dir: string, meta: WorkMeta): Promise<void> {
  meta.updatedAt = nowIso();
  await atomicWrite(metaPath(dir), JSON.stringify(meta, null, 2) + "\n");
}

export async function resolveWorkDir(paths: StoragePaths, keyOrTitle: string): Promise<string> {
  const direct = workDir(paths, keyOrTitle);
  if (await exists(metaPath(direct))) return direct;
  const all = await listWorks(paths);
  const hit = all.find((w) => w.key === keyOrTitle || w.title === keyOrTitle);
  if (!hit) throw new Error(`找不到作品：${keyOrTitle}`);
  return workDir(paths, hit.key);
}


// —— § chapters ——
export async function listChapters(dir: string): Promise<ChapterMeta[]> {
  const meta = await readWorkMeta(dir);
  return [...meta.chapters].sort((a, b) => a.position - b.position);
}

export async function readChapter(dir: string, chapterId: string): Promise<ChapterRecord> {
  const file = chapterFile(dir, chapterId);
  const raw = await readFile(file, "utf8");
  return parseChapterMarkdown(raw, chapterId);
}

export async function saveChapter(
  dir: string,
  input: {
    id?: string;
    title: string;
    body: string;
    position?: number;
    status?: ChapterStatus;
    outline?: Partial<Outline>;
  },
): Promise<ChapterRecord> {
  return withLock(dir, async () => {
    const meta = await readWorkMeta(dir);
    const id = input.id?.trim() || `c${String(meta.chapters.length + 1).padStart(3, "0")}`;
    const existingIdx = meta.chapters.findIndex((c) => c.id === id);
    let previous: ChapterRecord | null = null;
    if (existingIdx >= 0) {
      try {
        previous = await readChapter(dir, id);
      } catch {
        previous = null;
      }
    }
    const position =
      typeof input.position === "number"
        ? input.position
        : previous?.position ?? (existingIdx >= 0 ? meta.chapters[existingIdx]!.position : meta.chapters.length + 1);
    const outline = normalizeOutline({ ...(previous?.outline ?? EMPTY_OUTLINE()), ...(input.outline ?? {}) });
    const status: ChapterStatus =
      input.status && CHAPTER_STATUSES.includes(input.status)
        ? input.status
        : previous?.status ?? "drafted";
    const record: ChapterRecord = {
      id,
      title: input.title.trim() || previous?.title || id,
      position,
      status,
      wordCount: countWords(input.body),
      updatedAt: nowIso(),
      body: input.body,
      outline,
    };
    await mkdir(chaptersDir(dir), { recursive: true });
    await atomicWrite(chapterFile(dir, id), serializeChapterMarkdown(record));
    const summary: ChapterMeta = {
      id: record.id,
      title: record.title,
      position: record.position,
      status: record.status,
      wordCount: record.wordCount,
      updatedAt: record.updatedAt,
    };
    if (existingIdx >= 0) meta.chapters[existingIdx] = summary;
    else meta.chapters.push(summary);
    meta.chapters.sort((a, b) => a.position - b.position);
    await writeWorkMeta(dir, meta);
    return record;
  });
}

export async function setOutline(
  dir: string,
  chapterId: string,
  patch: Partial<Outline>,
): Promise<ChapterRecord> {
  let previous: ChapterRecord | null = null;
  try {
    previous = await readChapter(dir, chapterId);
  } catch {
    previous = null;
  }
  return saveChapter(dir, {
    id: chapterId,
    title: previous?.title ?? chapterId,
    body: previous?.body ?? "",
    position: previous?.position,
    status: previous?.status ?? "planned",
    outline: { ...(previous?.outline ?? EMPTY_OUTLINE()), ...patch },
  });
}

export async function setFoundation(dir: string, patch: Partial<Foundation>): Promise<WorkMeta> {
  return withLock(dir, async () => {
    const meta = await readWorkMeta(dir);
    meta.foundation = normalizeFoundation({ ...meta.foundation, ...patch });
    await writeWorkMeta(dir, meta);
    return meta;
  });
}


// —— § ledger ——
export async function readLedger(dir: string): Promise<LedgerFile> {
  try {
    const raw = await readFile(ledgerPath(dir), "utf8");
    const data = JSON.parse(raw) as LedgerFile;
    data.entries = Array.isArray(data.entries) ? data.entries : [];
    return data;
  } catch {
    const meta = await readWorkMeta(dir);
    return { schemaVersion: SCHEMA_VERSION, workKey: meta.key, entries: [] };
  }
}

export async function appendLedger(dir: string, entry: Omit<LedgerEntry, "id" | "at"> & { id?: string; at?: string }): Promise<LedgerEntry> {
  return withLock(`${dir}:ledger`, async () => {
    const ledger = await readLedger(dir);
    const full: LedgerEntry = {
      id: entry.id ?? randomUUID().slice(0, 8),
      at: entry.at ?? nowIso(),
      chapterId: entry.chapterId,
      kind: entry.kind,
      summary: entry.summary,
      dims: entry.dims,
      issues: entry.issues,
      styleHitCount: entry.styleHitCount,
    };
    ledger.entries.push(full);
    await atomicWrite(ledgerPath(dir), JSON.stringify(ledger, null, 2) + "\n");
    return full;
  });
}


// —— § candidates ——
export async function stageCandidate(
  dir: string,
  input: {
    chapterId: string;
    body: string;
    note?: string;
    source?: "agent" | "import" | "edit";
    editOf?: string;
    editMode?: string;
  },
): Promise<CandidateFile> {
  if (!String(input.body ?? "").trim()) {
    throw new ZhizhangError("candidate_empty", "候选正文为空，拒绝暂存");
  }
  const id = `cand-${Date.now().toString(36)}`;
  await mkdir(candidatesDir(dir), { recursive: true });
  const bodyFile = `${id}.md`;
  await atomicWrite(path.join(candidatesDir(dir), bodyFile), input.body);
  const meta = await readWorkMeta(dir);
  const stagedAt = nowIso();
  const cand: CandidateFile = {
    schemaVersion: SCHEMA_VERSION,
    id,
    workKey: meta.key,
    chapterId: input.chapterId,
    stagedAt,
    source: input.source ?? "agent",
    note: input.note ?? "",
    body: input.body,
    bodyFile,
  };
  if (input.editOf) {
    cand.editOf = input.editOf;
    cand.editedAt = stagedAt;
  }
  if (input.editMode) cand.editMode = input.editMode;
  const { body: _omit, ...disk } = cand;
  await atomicWrite(path.join(candidatesDir(dir), `${id}.json`), JSON.stringify(disk, null, 2) + "\n");
  return cand;
}

export async function readCandidate(dir: string, candidateId: string): Promise<CandidateFile> {
  const raw = await readFile(path.join(candidatesDir(dir), `${candidateId}.json`), "utf8");
  const disk = JSON.parse(raw) as Omit<CandidateFile, "body">;
  const body = await readFile(path.join(candidatesDir(dir), disk.bodyFile), "utf8");
  return { ...disk, body };
}

/**
 * Record that style_lint ran on a staged candidate and issue lintPassToken.
 * Token proves the sensor ran (hitCount may be > 0) — NOT a quality pass.
 * Clears any prior token. Accept still requires the token; hitCount is echoed / optional strict.
 */
export async function markCandidateLinted(
  dir: string,
  candidateId: string,
  hitCount: number,
): Promise<{ token: string; lintedAt: string; hitCount: number; chapterId: string }> {
  return withLock(`${dir}:cand:${candidateId}`, async () => {
    const cand = await readCandidate(dir, candidateId);
    if (cand.acceptedAt) {
      throw new ZhizhangError(
        "candidate_already_accepted",
        `候选 ${candidateId} 已采纳，无需再扫；请重新 stage 新候选后再 lint。`,
      );
    }
    const token = `lint-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const lintedAt = nowIso();
    const diskMeta: Record<string, unknown> = {
      schemaVersion: cand.schemaVersion,
      id: cand.id,
      workKey: cand.workKey,
      chapterId: cand.chapterId,
      stagedAt: cand.stagedAt,
      source: cand.source,
      note: cand.note,
      bodyFile: cand.bodyFile,
      lintPassToken: token,
      lintedAt,
      lintHitCount: hitCount,
    };
    if (cand.editOf) diskMeta.editOf = cand.editOf;
    if (cand.editMode) diskMeta.editMode = cand.editMode;
    if (cand.editedAt) diskMeta.editedAt = cand.editedAt;
    await atomicWrite(
      path.join(candidatesDir(dir), `${candidateId}.json`),
      JSON.stringify(diskMeta, null, 2) + "\n",
    );
    await appendLedger(dir, {
      chapterId: cand.chapterId,
      kind: "style_lint",
      summary: `语感雷达候选 ${candidateId}：${hitCount} 处命中 · token=${token}`,
      styleHitCount: hitCount,
    });
    return { token, lintedAt, hitCount, chapterId: cand.chapterId };
  });
}

/** True when candidate has a lint pass recorded at/after stagedAt. */
export function candidateHasLintPass(cand: CandidateFile): boolean {
  if (!cand.lintPassToken || !cand.lintedAt) return false;
  return cand.lintedAt >= cand.stagedAt;
}

/**
 * Accept a staged candidate into the chapter draft. Explicit tool only —
 * never called implicitly by generation. Replaces or appends body per mode.
 *
 * Refuse rules (engineering gate — not AI judgment):
 * - already-accepted candidate → refuse (stage a new one)
 * - no successful style_lint since stage (missing lintPassToken) → refuse
 * - lintPassToken provided but mismatches → refuse
 * - target chapter status is final → refuse unless force=true
 */
export async function acceptCandidate(
  dir: string,
  candidateId: string,
  mode: "replace" | "append" = "replace",
  opts: { force?: boolean; lintPassToken?: string } = {},
): Promise<ChapterRecord> {
  const cand = await readCandidate(dir, candidateId);
  if (cand.acceptedAt) {
    throw new ZhizhangError(
      "candidate_already_accepted",
      `候选 ${candidateId} 已于 ${cand.acceptedAt} 采纳（${cand.acceptedMode ?? "replace"}），禁止重复写回。请重新 zhizhang_candidate_stage 新候选。`,
    );
  }
  if (!cand.body.trim()) {
    throw new ZhizhangError("candidate_empty", `候选 ${candidateId} 正文为空，拒绝采纳`);
  }

  const provided = opts.lintPassToken?.trim();
  if (provided) {
    if (!cand.lintPassToken || cand.lintPassToken !== provided) {
      throw new ZhizhangError(
        "lint_token_mismatch",
        `lintPassToken 无效或不匹配。请对候选 ${candidateId} 重新调用 zhizhang_style_lint（传 candidate），使用返回的 lintPassToken。`,
      );
    }
    if (!candidateHasLintPass(cand)) {
      throw new ZhizhangError(
        "lint_required",
        `候选 ${candidateId} 的语感扫描已过期（须在 stage 之后）。请重新 zhizhang_style_lint。`,
      );
    }
  } else if (!candidateHasLintPass(cand)) {
    throw new ZhizhangError(
      "lint_required",
      `采纳前必须对候选 ${candidateId} 成功执行 zhizhang_style_lint（传 candidate=…）。软提示不够：代码硬拒绝。也可把 style_lint 返回的 lintPassToken 传给 accept。`,
    );
  }

  let body = cand.body;
  let title: string | undefined;
  // Accept always lands as drafted: even reviewed chapters must re-review after body change.
  let status: ChapterStatus = "drafted";
  let existingFinal = false;
  try {
    const existing = await readChapter(dir, cand.chapterId);
    title = existing.title;
    if (existing.status === "final") {
      existingFinal = true;
      if (!opts.force) {
        throw new ZhizhangError(
          "refuse_overwrite_final",
          `章节 ${cand.chapterId} 已是 final，拒绝用候选取代。确需改稿请传 force=true（采纳后状态降为 drafted，需重新审校定稿）。`,
        );
      }
    }
    if (mode === "append") body = `${existing.body.trimEnd()}\n\n${cand.body}`;
  } catch (err) {
    if (err instanceof ZhizhangError) throw err;
    title = cand.chapterId;
  }

  const saved = await saveChapter(dir, {
    id: cand.chapterId,
    title: title ?? cand.chapterId,
    body,
    status,
  });

  const acceptedAt = nowIso();
  const diskMeta: Record<string, unknown> = {
    schemaVersion: cand.schemaVersion,
    id: cand.id,
    workKey: cand.workKey,
    chapterId: cand.chapterId,
    stagedAt: cand.stagedAt,
    source: cand.source,
    note: cand.note,
    bodyFile: cand.bodyFile,
    lintPassToken: cand.lintPassToken,
    lintedAt: cand.lintedAt,
    lintHitCount: cand.lintHitCount,
    acceptedAt,
    acceptedMode: mode,
  };
  if (cand.editOf) diskMeta.editOf = cand.editOf;
  if (cand.editMode) diskMeta.editMode = cand.editMode;
  if (cand.editedAt) diskMeta.editedAt = cand.editedAt;
  await atomicWrite(
    path.join(candidatesDir(dir), `${candidateId}.json`),
    JSON.stringify(diskMeta, null, 2) + "\n",
  );

  await appendLedger(dir, {
    chapterId: cand.chapterId,
    kind: "note",
    summary: existingFinal
      ? `强制采纳候选 ${candidateId}（${mode}，原 final→drafted）→ 本地草稿，未定稿`
      : `采纳候选 ${candidateId}（${mode}）→ 本地草稿，未定稿`,
  });
  return saved;
}

export async function listCandidates(dir: string): Promise<Array<Omit<CandidateFile, "body"> & { wordCount: number; pending: boolean }>> {
  let names: string[];
  try {
    names = await readdir(candidatesDir(dir));
  } catch {
    return [];
  }
  const rows: Array<Omit<CandidateFile, "body"> & { wordCount: number; pending: boolean }> = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(await readFile(path.join(candidatesDir(dir), name), "utf8")) as Omit<CandidateFile, "body">;
      let wordCount = 0;
      try {
        const body = await readFile(path.join(candidatesDir(dir), raw.bodyFile), "utf8");
        wordCount = countWords(body);
      } catch {
        /* missing body file */
      }
      rows.push({
        ...raw,
        wordCount,
        pending: !raw.acceptedAt,
      });
    } catch {
      /* skip broken */
    }
  }
  rows.sort((a, b) => (a.stagedAt < b.stagedAt ? 1 : -1));
  return rows;
}


// —— § brief crumbs ——
export async function readBriefCrumbs(dir: string): Promise<BriefCrumbFile> {
  try {
    const raw = await readFile(briefCrumbsPath(dir), "utf8");
    const data = JSON.parse(raw) as BriefCrumbFile;
    data.entries = Array.isArray(data.entries) ? data.entries : [];
    return data;
  } catch {
    const meta = await readWorkMeta(dir);
    return { schemaVersion: SCHEMA_VERSION, workKey: meta.key, entries: [] };
  }
}

export async function recordBriefBreadcrumb(
  dir: string,
  input: { chapterId: string; assetIds: string[] },
): Promise<BriefBreadcrumb> {
  return withLock(`${dir}:briefs`, async () => {
    const file = await readBriefCrumbs(dir);
    const crumb: BriefBreadcrumb = {
      chapterId: input.chapterId,
      at: nowIso(),
      assetIds: [...input.assetIds],
    };
    file.entries.push(crumb);
    if (file.entries.length > 200) file.entries = file.entries.slice(-200);
    await atomicWrite(briefCrumbsPath(dir), JSON.stringify(file, null, 2) + "\n");
    await appendLedger(dir, {
      chapterId: input.chapterId,
      kind: "brief_seen",
      summary: `chapter_brief · assets=${input.assetIds.join(",") || "(none)"}`,
    });
    return crumb;
  });
}

/** Most recent brief for chapter within maxAgeMs (default BRIEF_RECENT_MS). */
export async function getRecentBrief(
  dir: string,
  chapterId: string,
  maxAgeMs: number = BRIEF_RECENT_MS,
): Promise<BriefBreadcrumb | null> {
  const file = await readBriefCrumbs(dir);
  const now = Date.now();
  for (let i = file.entries.length - 1; i >= 0; i--) {
    const e = file.entries[i]!;
    if (e.chapterId !== chapterId) continue;
    const at = Date.parse(e.at);
    if (Number.isFinite(at) && now - at <= maxAgeMs) return e;
    return null;
  }
  return null;
}


// —— § payoff audits ——
export async function readPayoffAudits(dir: string): Promise<PayoffAuditFile> {
  try {
    const raw = await readFile(payoffAuditsPath(dir), "utf8");
    const data = JSON.parse(raw) as PayoffAuditFile;
    data.entries = Array.isArray(data.entries) ? data.entries : [];
    return data;
  } catch {
    const meta = await readWorkMeta(dir);
    return { schemaVersion: SCHEMA_VERSION, workKey: meta.key, entries: [] };
  }
}

export async function storePayoffAudit(
  dir: string,
  entry: Omit<PayoffAuditStored, "at"> & { at?: string },
): Promise<PayoffAuditStored> {
  return withLock(`${dir}:payoff`, async () => {
    const file = await readPayoffAudits(dir);
    const full: PayoffAuditStored = {
      ...entry,
      at: entry.at ?? nowIso(),
    };
    file.entries.push(full);
    if (file.entries.length > 100) file.entries = file.entries.slice(-100);
    await atomicWrite(payoffAuditsPath(dir), JSON.stringify(file, null, 2) + "\n");
    await appendLedger(dir, {
      chapterId: entry.chapterId,
      kind: "payoff_audit",
      summary: full.summary,
    });
    return full;
  });
}

export async function getLastPayoffAudit(
  dir: string,
  chapterId?: string,
): Promise<PayoffAuditStored | null> {
  const file = await readPayoffAudits(dir);
  for (let i = file.entries.length - 1; i >= 0; i--) {
    const e = file.entries[i]!;
    if (!chapterId || e.chapterId === chapterId) return e;
  }
  return null;
}

/** Most recent payoff audit for chapter within maxAgeMs (default BRIEF_RECENT_MS). */
export async function getRecentPayoffAudit(
  dir: string,
  chapterId: string,
  maxAgeMs: number = BRIEF_RECENT_MS,
): Promise<PayoffAuditStored | null> {
  const file = await readPayoffAudits(dir);
  const now = Date.now();
  for (let i = file.entries.length - 1; i >= 0; i--) {
    const e = file.entries[i]!;
    if (e.chapterId !== chapterId) continue;
    const at = Date.parse(e.at);
    if (Number.isFinite(at) && now - at <= maxAgeMs) return e;
    return null;
  }
  return null;
}

export interface PanelSnapshot {
  schemaVersion: number;
  generatedAt: string;
  workKey: string;
  title: string;
  genre: string;
  dir: string;
  totals: { chapters: number; words: number; final: number; drafted: number; planned: number };
  foundation: { locks: string; happened: string; threads: string; style: string };
  chapters: Array<{
    id: string;
    title: string;
    position: number;
    status: ChapterStatus;
    wordCount: number;
    situationLens: string;
    livedScene: string;
    stateLens: string;
    briefRecent: boolean;
  }>;
  ledgerRecent: Array<{ id: string; at: string; kind: string; chapterId: string; summary: string; styleHitCount?: number }>;
  candidates: Array<{ id: string; chapterId: string; stagedAt: string; pending: boolean; wordCount: number; note: string }>;
  briefCrumbsRecent: BriefBreadcrumb[];
  lastPayoffByChapter: Record<string, PayoffAuditStored>;
  nextHints: string[];
  html: string;
}


// —— § panel snapshot ——
export async function buildPanelSnapshot(dir: string): Promise<PanelSnapshot> {
  const meta = await readWorkMeta(dir);
  const ledger = await readLedger(dir);
  const cands = await listCandidates(dir);
  const briefs = await readBriefCrumbs(dir);
  const payoffs = await readPayoffAudits(dir);
  const lastPayoffByChapter: Record<string, PayoffAuditStored> = {};
  for (const e of payoffs.entries) {
    lastPayoffByChapter[e.chapterId] = e;
  }
  const now = Date.now();
  const recentBriefChapterIds = new Set<string>();
  for (const e of briefs.entries) {
    const at = Date.parse(e.at);
    if (Number.isFinite(at) && now - at <= BRIEF_RECENT_MS) recentBriefChapterIds.add(e.chapterId);
  }
  let words = 0;
  let final = 0;
  let drafted = 0;
  let planned = 0;
  const chapters: PanelSnapshot["chapters"] = [];
  for (const ch of [...meta.chapters].sort((a, b) => a.position - b.position)) {
    words += ch.wordCount;
    if (ch.status === "final") final += 1;
    else if (ch.status === "planned") planned += 1;
    else drafted += 1;
    let situationLens = "";
    let livedScene = "";
    let stateLens = "";
    try {
      const full = await readChapter(dir, ch.id);
      situationLens = full.outline.situationLens;
      livedScene = full.outline.livedScene;
      stateLens = full.outline.stateLens;
    } catch {
      /* index-only */
    }
    chapters.push({
      id: ch.id,
      title: ch.title,
      position: ch.position,
      status: ch.status,
      wordCount: ch.wordCount,
      situationLens,
      livedScene,
      stateLens,
      briefRecent: recentBriefChapterIds.has(ch.id),
    });
  }
  const pending = cands.filter((c) => c.pending).length;
  const nextHints = [
    "创作路径：chapter_brief → candidate_stage → style_lint(candidate=…) → candidate_accept → payoff_audit",
    "accept 硬闸：须 lintPassToken（仅证明已扫过）+ 近期 chapter_brief（可用 skip_brief 跳过）",
    "lint 命中>0 软警告 lint_hits_present；扫过≠过关。strict_lint / require_payoff / strict_human 可选硬拒",
    "chapter_save 大正文须 confirm_bypass；定稿：review_ledger + chapter_save status=final",
  ];
  if (pending > 0) nextHints.unshift(`有 ${pending} 条待采纳候选，用 zhizhang_candidate_accept`);
  if (chapters.some((c) => !c.situationLens)) nextHints.unshift("部分章节缺 situationLens，建议 zhizhang_outline_set");
  if (chapters.some((c) => c.wordCount > 0 && !c.briefRecent)) {
    nextHints.unshift("有章节正文但无近期 chapter_brief 留痕（accept 将硬拒 unless skip_brief）");
  }
  const payoffWarn = Object.values(lastPayoffByChapter).filter((p) => !p.ok);
  if (payoffWarn.length > 0) {
    nextHints.unshift(`兑付审计有 ${payoffWarn.length} 章未过：${payoffWarn.map((p) => p.chapterId).join("、")}`);
  }

  const esc = (s: string) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const recentBriefs = briefs.entries.filter((e) => {
    const at = Date.parse(e.at);
    return Number.isFinite(at) && now - at <= BRIEF_RECENT_MS;
  });

  const html = [
    `<article class="zhizhang-panel" data-work="${esc(meta.key)}">`,
    `<h1>${esc(meta.title)}</h1>`,
    `<p class="meta">key=${esc(meta.key)} · ${chapters.length} 章 · 约 ${words} 字 · 定稿 ${final} · 待采纳候选 ${pending}</p>`,
    `<h2>章节</h2>`,
    `<ol>`,
    ...chapters.map(
      (c) =>
        `<li data-id="${esc(c.id)}" data-status="${esc(c.status)}">[${esc(c.status)}] ${esc(c.title)}（${c.wordCount} 字）` +
        (c.briefRecent ? ` · brief✓` : "") +
        (c.situationLens ? `<br/><small>处境：${esc(c.situationLens.slice(0, 80))}</small>` : "") +
        `</li>`,
    ),
    `</ol>`,
    `<h2>待采纳候选</h2>`,
    pending === 0
      ? `<p>无</p>`
      : `<ul>` +
        cands
          .filter((c) => c.pending)
          .map((c) => `<li>${esc(c.id)} → ${esc(c.chapterId)}（${c.wordCount} 字）</li>`)
          .join("") +
        `</ul>`,
    `<h2>审校留痕（最近）</h2>`,
    `<ul>`,
    ...ledger.entries
      .slice(-8)
      .reverse()
      .map((e) => `<li>[${esc(e.at)}] ${esc(e.kind)} · ${esc(e.chapterId)} · ${esc(e.summary)}</li>`),
    `</ul>`,
    `<h2>brief 留痕（近期）</h2>`,
    recentBriefs.length === 0
      ? `<p>无</p>`
      : `<ul>` +
        recentBriefs
          .slice(-8)
          .reverse()
          .map((e) => `<li>${esc(e.chapterId)} @ ${esc(e.at)} · ${esc(e.assetIds.join(","))}</li>`)
          .join("") +
        `</ul>`,
    `<h2>兑付审计（每章最近）</h2>`,
    Object.keys(lastPayoffByChapter).length === 0
      ? `<p>无</p>`
      : `<ul>` +
        Object.values(lastPayoffByChapter)
          .map(
            (e) =>
              `<li>${esc(e.chapterId)} · ${e.ok ? "ok" : "warn:" + e.warningCount} · ${esc(e.summary.slice(0, 80))}</li>`,
          )
          .join("") +
        `</ul>`,
    `</article>`,
  ].join("\n");

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: nowIso(),
    workKey: meta.key,
    title: meta.title,
    genre: meta.genre,
    dir,
    totals: { chapters: chapters.length, words, final, drafted, planned },
    foundation: {
      locks: meta.foundation.locks,
      happened: meta.foundation.happened,
      threads: meta.foundation.threads,
      style: meta.foundation.style,
    },
    chapters,
    ledgerRecent: ledger.entries.slice(-12).map((e) => ({
      id: e.id,
      at: e.at,
      kind: e.kind,
      chapterId: e.chapterId,
      summary: e.summary,
      styleHitCount: e.styleHitCount,
    })),
    candidates: cands.map((c) => ({
      id: c.id,
      chapterId: c.chapterId,
      stagedAt: c.stagedAt,
      pending: c.pending,
      wordCount: c.wordCount,
      note: c.note,
    })),
    briefCrumbsRecent: recentBriefs.slice(-12),
    lastPayoffByChapter,
    nextHints,
    html,
  };
}


// —— § assemble ——
export async function assembleManuscript(
  dir: string,
  paths: StoragePaths,
  opts: { onlyFinal?: boolean; outputRel?: string } = {},
): Promise<{ file: string; words: number; chapters: number }> {
  const meta = await readWorkMeta(dir);
  const chapters = [...meta.chapters].sort((a, b) => a.position - b.position);
  const parts: string[] = [`# ${meta.title}`, ""];
  if (meta.premise) parts.push(`> ${meta.premise}`, "");
  let words = 0;
  let included = 0;
  for (const ch of chapters) {
    if (opts.onlyFinal && ch.status !== "final" && ch.status !== "reviewed") continue;
    let record: ChapterRecord;
    try {
      record = await readChapter(dir, ch.id);
    } catch {
      continue;
    }
    if (!record.body.trim()) continue;
    parts.push(`## ${record.title}`, "", record.body.trim(), "");
    words += record.wordCount;
    included += 1;
  }
  if (included === 0) throw new Error("没有可汇编的章节正文");
  const rel = opts.outputRel?.trim() || `manuscripts/${meta.key}.md`;
  if (path.isAbsolute(rel)) throw new Error("output 只能是相对路径");
  const out = assertInside(paths.base, path.resolve(paths.base, rel), "汇编输出");
  await mkdir(path.dirname(out), { recursive: true });
  await atomicWrite(out, parts.join("\n") + "\n");
  return { file: out, words, chapters: included };
}

export async function removeWorkDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
