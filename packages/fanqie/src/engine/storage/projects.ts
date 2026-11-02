import { Diagnostics } from "../../../../core/src/diagnostics.js";
import { serialize, readText } from "../../../../core/src/fsx.js";
import { rootIdentity } from "../../../../core/src/identity.js";

import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { stateRoot } from "../../../../core/src/paths.js";

import type { StoragePaths } from "../types.js";

import { NovelError } from "../errors.js";

import { readJsonCached } from "../file-cache.js";
import { atomicWrite, isMissingFileError, nowIso } from "./primitives.js";

import { assertNoPendingAccept } from "./accept-journal.js";

import { withResourceLock } from "./process-lock.js";
import { metaPath } from "./work-meta.js";

/** 跨项目索引（应用状态目录/writer-novel-projects.json）里的一行。 */
interface ProjectEntry {
  id: string;
  base: string;
  works?: string;
  worksRoot?: string;
  name?: string;
  lastUsedAt?: string;
}

/** 面板用的项目摘要。 */
interface ProjectSummary {
  id: string;
  base: string;
  /** 该项目实际使用的作品根；面板切项目时不能拿全局 config.worksRoot 猜。 */
  worksRoot?: string;
  name?: string;
  lastUsedAt?: string;
  exists?: boolean;
  works?: {
    key: string;
    title: string;
    genre?: string;
    chapters: number | null;
    wordCount: number | null;
    updatedAt?: string;
    recoveryPending?: boolean;
  }[];
  worksCount?: number | null;
  error?: string;
  chapters?: number | null;
  words?: number | null;
  recoveryPending?: boolean;
}
let lastToolBase = "";
let lastWorksRoot = "";
let lastMarkerReadAt = 0;
function applicationStateRoot() {
  return stateRoot();
}
function toolBaseMarker() {
  return path.join(applicationStateRoot(), "writer-novel-last-root.json");
}
export async function rememberToolBase(base: string, works: string) {
  if (base === lastToolBase && works === lastWorksRoot) return;
  await atomicWrite(
    toolBaseMarker(),
    JSON.stringify({ base, works, at: nowIso() }, null, 2) + "\n",
  );
  lastToolBase = base;
  lastWorksRoot = works;
}
export function getLastToolBase() {
  return lastToolBase;
}
/** Read the persisted marker (cached in memory after the first hit). */
export async function loadLastToolBase() {
  if (lastToolBase) return lastToolBase;
  // In a multi-process host the marker may appear later; re-check at most every 5s.
  if (Date.now() - lastMarkerReadAt < 5000) return "";
  try {
    const raw = JSON.parse(await readFile(toolBaseMarker(), "utf8"));
    const base = typeof raw?.base === "string" ? raw.base : "";
    if (base && path.isAbsolute(base)) {
      const worksRaw = typeof raw?.works === "string" ? raw.works : "";
      const worksDir = worksRaw && path.isAbsolute(worksRaw) ? worksRaw : path.join(base, "works");
      const st = await stat(worksDir);
      if (st.isDirectory()) {
        lastToolBase = base;
        lastWorksRoot = worksDir;
        return base;
      }
    }
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  lastMarkerReadAt = Date.now();
  return "";
}
function projectsFile() {
  return path.join(applicationStateRoot(), "writer-novel-projects.json");
}
/** Stable id for a workspace storage root (case/sep-insensitive). */
export function projectIdOf(base: string) {
  return rootIdentity(base);
}
function projectNameOf(base: string) {
  const root = path.dirname(path.resolve(base));
  const parts = root.split(/[\\/]/).filter(Boolean);
  const tail = parts.slice(-2).join("/");
  return tail || root;
}
let lastProjectBase = "";
let lastProjectWorks = "";
function validProject(value: unknown): value is ProjectEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.base === "string" &&
    path.isAbsolute(row.base) &&
    (row.works === undefined || (typeof row.works === "string" && path.isAbsolute(row.works))) &&
    (row.worksRoot === undefined ||
      (typeof row.worksRoot === "string" && path.isAbsolute(row.worksRoot))) &&
    (row.name === undefined || typeof row.name === "string") &&
    (row.lastUsedAt === undefined || typeof row.lastUsedAt === "string")
  );
}
async function readProjectsIndex(): Promise<ProjectEntry[]> {
  const text = await readText(projectsFile());
  if (text === undefined) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new NovelError("index_corrupt", "项目索引 JSON 损坏，已拒绝写入；请保留原文件并核对。");
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    !("projects" in raw) ||
    !Array.isArray(raw.projects) ||
    !raw.projects.every(validProject)
  )
    throw new NovelError("index_corrupt", "项目索引格式损坏，已拒绝写入；请保留原文件并核对。");
  return raw.projects;
}
async function upsertProjectFile(base: string, works: string) {
  const list = await readProjectsIndex();
  const id = projectIdOf(base);
  const existing = list.find((p: ProjectEntry) => projectIdOf(p.base) === id);
  const entry = {
    id,
    base: path.resolve(base),
    works: works ? path.resolve(works) : existing?.works,
    name: existing?.name || projectNameOf(base),
    lastUsedAt: nowIso(),
  };
  const next: ProjectEntry[] = existing
    ? list.map((p: ProjectEntry) => (p === existing ? { ...p, ...entry } : p))
    : [...list, entry];
  next.sort((a: any, b: any) =>
    String(b.lastUsedAt ?? "").localeCompare(String(a.lastUsedAt ?? "")),
  );
  await atomicWrite(projectsFile(), JSON.stringify({ version: 1, projects: next }, null, 2) + "\n");
}
/** Register only after a successful read-modify-write under the shared index lock. */
export async function rememberProject(base: string, works: string) {
  if (base === lastProjectBase && works === lastProjectWorks) return;
  try {
    await serialize(projectsFile(), async () => {
      await mkdir(applicationStateRoot(), { recursive: true });
      await withResourceLock(applicationStateRoot(), () => upsertProjectFile(base, works));
    });
    lastProjectBase = base;
    lastProjectWorks = works;
    projectsSummaryCache = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await new Diagnostics(stateRoot()).write("project_index_error", { message });
    } catch (diagnosticError) {
      throw new AggregateError(
        [error, diagnosticError],
        `项目登记失败：${message}；诊断记录也未能写入。`,
      );
    }
    throw error;
  }
}
const LOCAL_BOOK_EXTS = new Set([".txt", ".md", ".markdown"]);
/** List candidate book files in a local shelf folder (read-only, no import). */
export async function listLocalBooks(sourceRoot: any, opts: any = {}) {
  const root = String(sourceRoot ?? "").trim();
  if (!root) return [];
  let names;
  try {
    names = await readdir(root);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
  const limit = typeof opts.limit === "number" ? opts.limit : 200;
  const rows = [];
  for (const name of names.sort()) {
    if (!LOCAL_BOOK_EXTS.has(path.extname(name).toLowerCase())) continue;
    const full = path.join(root, name);
    try {
      const st = await stat(full);
      if (!st.isFile()) continue;
      rows.push({
        name,
        title: path.basename(name, path.extname(name)),
        path: full,
        bytes: st.size,
      });
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    if (rows.length >= limit) break;
  }
  return rows;
}
let projectsSummaryAt = 0;
let projectsSummaryCache: ProjectSummary[] | null = null;
/**
 * Known workspaces with a cheap per-project summary (works/chapters/words).
 * Summaries are derived from each project's own .writer — never authoritative copies.
 */
export async function listProjects(opts: any = {}) {
  const ttl = typeof opts.ttl === "number" ? opts.ttl : 5000;
  if (!opts.refresh && projectsSummaryCache && Date.now() - projectsSummaryAt < ttl) {
    return projectsSummaryCache;
  }
  const list = await readProjectsIndex();
  const knownIds = new Set(list.map((p: ProjectEntry) => projectIdOf(p.base)));
  const markerBase = await loadLastToolBase();
  if (markerBase && !knownIds.has(projectIdOf(markerBase))) {
    list.push({
      id: projectIdOf(markerBase),
      base: markerBase,
      worksRoot: lastWorksRoot || undefined,
      works: lastWorksRoot || undefined,
      name: projectNameOf(markerBase),
      lastUsedAt: "",
    });
  }
  const rows = [];
  for (const entry of list) {
    const base = path.resolve(entry.base);
    const worksDir =
      typeof entry.works === "string" && path.isAbsolute(entry.works)
        ? entry.works
        : path.join(base, "works");
    let existsFlag = false;
    try {
      existsFlag = (await stat(worksDir)).isDirectory();
    } catch {
      existsFlag = false;
    }
    let works = [];
    let worksError: string | undefined;
    if (existsFlag) {
      try {
        works = await listWorks({
          base,
          works: worksDir,
          manuscripts: path.join(base, "manuscripts"),
          library: path.join(base, "library"),
          inspiration: path.join(base, "inspiration"),
          sourceRoot: "",
        });
      } catch (err) {
        works = [];
        worksError = err instanceof Error ? err.message : String(err);
      }
    }
    const rowsWorks = works.map((w: any) => {
      const chapters = Array.isArray(w.chapters) ? w.chapters : [];
      return {
        key: w.key,
        title: w.title,
        genre: w.genre ?? "",
        chapters: w.recoveryPending ? null : chapters.length,
        wordCount: w.recoveryPending
          ? null
          : chapters.reduce((x: any, c: any) => x + (c.wordCount || 0), 0),
        updatedAt: w.updatedAt ?? "",
        recoveryPending: w.recoveryPending === true,
      };
    });
    const recoveryPending = rowsWorks.some((w: any) => w.recoveryPending);
    const countsUnavailable = recoveryPending || Boolean(worksError);
    rows.push({
      id: projectIdOf(base),
      base,
      worksRoot: worksDir,
      name: entry.name || projectNameOf(base),
      lastUsedAt: entry.lastUsedAt ?? "",
      exists: existsFlag,
      works: rowsWorks,
      worksCount: worksError ? null : rowsWorks.length,
      chapters: countsUnavailable
        ? null
        : rowsWorks.reduce((x: number, w: any) => x + w.chapters, 0),
      words: countsUnavailable ? null : rowsWorks.reduce((x: number, w: any) => x + w.wordCount, 0),
      recoveryPending,
      ...(worksError ? { error: worksError } : {}),
    });
  }
  rows.sort((a: any, b: any) =>
    String(b.lastUsedAt ?? "").localeCompare(String(a.lastUsedAt ?? "")),
  );
  projectsSummaryCache = rows;
  projectsSummaryAt = Date.now();
  return rows;
}

export async function listWorks(paths: StoragePaths) {
  let names;
  try {
    names = await readdir(paths.works);
  } catch (err) {
    if (isMissingFileError(err)) return [];
    throw err;
  }
  const rows = [];
  for (const name of names) {
    const file = metaPath(path.join(paths.works, name));
    try {
      // Pending acceptance means counts may be between two valid versions.
      const row = await readJsonCached(file);
      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        (row.chapters !== undefined && !Array.isArray(row.chapters))
      )
        throw new NovelError("bad_work_meta", `作品元数据格式损坏：${file}`);
      let recoveryPending = false;
      let recoveryHint = "";
      try {
        await assertNoPendingAccept(path.join(paths.works, name));
      } catch (err) {
        if (!(err instanceof NovelError) || err.code !== "recovery_required") throw err;
        recoveryPending = true;
        recoveryHint = err.message;
      }
      rows.push({ ...row, chapters: row.chapters ?? [], recoveryPending, recoveryHint });
    } catch (err) {
      if (!isMissingFileError(err)) throw err;
    }
  }
  rows.sort((a: any, b: any) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return rows;
}
