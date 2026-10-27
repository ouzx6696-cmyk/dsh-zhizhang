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
 *   § candidates · § brief crumbs · § payoff audits · § assemble
 *
 * Patterns: atomic write, path sandbox, cooperative resource locks, CJK-aware word count.
 * Strategy decisions stay in ports/; this module only persists and queries.
 */
import { mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { EMPTY_FOUNDATION, SCHEMA_VERSION } from "./types.js";
import type { Candidate, ExecContext, PluginConfig, StoragePaths } from "./types.js";
import { assertContextBasis } from "./storage/chapters.js";
import { lintStyle } from "./style-linter.js";
import { fingerprint } from "./domain/lifecycle.js";
import { ZhizhangError } from "./errors.js";
import { resolveHappenedText } from "./domain/foundation-outcome.js";
import { readJsonCached } from "./file-cache.js";
import { atomicWrite, assertSafeAncestors, assertResourceId, countWords, isMissingFileError, nowIso } from "./storage/primitives.js";
import { chaptersDir, readChapter, prepareChapterSaveUnlocked } from "./storage/chapters.js";
import { assertNoPendingAccept, createAcceptJournal, finishAcceptJournal, snapshotFile } from "./storage/accept-journal.js";
import { createWorkRecordJournal, finishChapterJournal } from "./storage/chapter-journal.js";
import { readLedger, LEDGER_MAX_ENTRIES } from "./storage/ledger.js";
import { withResourceLock } from "./storage/process-lock.js";
import { metaPath, normalizeFoundation, readWorkMeta, validateStoryPace, writeWorkMeta } from "./storage/work-meta.js";
import { BRIEF_RECENT_MS } from "./domain/constants.js";

/** 跨项目索引（$DSH_HOME/zhizhang-projects.json）里的一行。 */
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
export { readLedger, appendLedger, LEDGER_MAX_ENTRIES } from "./storage/ledger.js";
export { atomicWrite, assertResourceId, countWords, withLock } from "./storage/primitives.js";
export { listChapters, readChapter, saveChapter, setOutline, updateChapter } from "./storage/chapters.js";
export { readWorkMeta, writeWorkMeta } from "./storage/work-meta.js";
// —— § utilities (lock, count, slug) ——
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export function slugify(title: string) {
    const cleaned = Array.from(String(title ?? "")
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, ""))
        .slice(0, 60)
        .join("");
    if (cleaned.length === 0)
        return `work-${Date.now().toString(36)}`;
    return RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
}
export function sessionCwd(exec: ExecContext | null) {
    const cwd = exec?.agent?.session?.header
        ?.cwd;
    return typeof cwd === "string" && cwd.length > 0 ? cwd : process.cwd();
}
/**
 * Last storage root touched by an agent tool. The Web panel has no session, so it
 * follows this instead of the host process cwd. Persisted under the DSH home so a
 * restarted host still points at the workspace the Agent was writing to.
 */
let lastToolBase = "";
let lastWorksRoot = "";
let lastMarkerReadAt = 0;
function dshHome() {
    return (process.env.DSH_HOME ?? "").trim() || path.join(homedir(), ".dsh");
}
function toolBaseMarker() {
    return path.join(dshHome(), "zhizhang-last-root.json");
}
async function persistToolBase(base: string, works: string) {
    try {
        const file = toolBaseMarker();
        await mkdir(path.dirname(file), { recursive: true });
        const body = works ? { base, works, at: nowIso() } : { base, at: nowIso() };
        await atomicWrite(file, JSON.stringify(body, null, 2) + "\n");
    }
    catch {
        /* memory value still works for this process */
    }
}
export function rememberToolBase(base: string, works: string) {
    if (!base || base === lastToolBase)
        return;
    lastToolBase = base;
    lastWorksRoot = works || "";
    void persistToolBase(base, works);
}
export function getLastToolBase() {
    return lastToolBase;
}
/** Read the persisted marker (cached in memory after the first hit). */
export async function loadLastToolBase() {
    if (lastToolBase)
        return lastToolBase;
    // In a multi-process host the marker may appear later; re-check at most every 5s.
    if (Date.now() - lastMarkerReadAt < 5000)
        return "";
    lastMarkerReadAt = Date.now();
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
    }
    catch {
        /* no marker yet */
    }
    return "";
}
function projectsFile() {
    return path.join(dshHome(), "zhizhang-projects.json");
}
/** Stable id for a workspace storage root (case/sep-insensitive). */
export function projectIdOf(base: string) {
    return path.resolve(base).replaceAll("\\", "/").toLowerCase();
}
function projectNameOf(base: string) {
    const root = path.dirname(path.resolve(base));
    const parts = root.split(/[\\/]/).filter(Boolean);
    const tail = parts.slice(-2).join("/");
    return tail || root;
}
let lastProjectBase = "";
let lastProjectWorks = "";
let projectsChain = Promise.resolve();
async function readProjectsIndex() {
    try {
        const raw = JSON.parse(await readFile(projectsFile(), "utf8"));
        const list = Array.isArray(raw?.projects) ? raw.projects : [];
        return list.filter((p: ProjectEntry) => p && typeof p.base === "string" && path.isAbsolute(p.base));
    }
    catch {
        return [];
    }
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
    next.sort((a: any, b: any) => String(b.lastUsedAt ?? "").localeCompare(String(a.lastUsedAt ?? "")));
    await atomicWrite(projectsFile(), JSON.stringify({ version: 1, projects: next }, null, 2) + "\n");
}
/**
 * Record this workspace in the cross-project index (best-effort, serialized).
 * Called from ensureStorage for tool calls only, so the panel can list projects.
 */
export function rememberProject(base: string, works: string) {
    if (!base || (base === lastProjectBase && (works ? works === lastProjectWorks : true)))
        return;
    lastProjectBase = base;
    if (works)
        lastProjectWorks = works;
    projectsChain = projectsChain.then(() => upsertProjectFile(base, works)).catch(() => { });
}
const LOCAL_BOOK_EXTS = new Set([".txt", ".md", ".markdown"]);
/** List candidate book files in a local shelf folder (read-only, no import). */
export async function listLocalBooks(sourceRoot: any, opts: any = {}) {
    const root = String(sourceRoot ?? "").trim();
    if (!root)
        return [];
    let names;
    try {
        names = await readdir(root);
    }
    catch {
        return [];
    }
    const limit = typeof opts.limit === "number" ? opts.limit : 200;
    const rows = [];
    for (const name of names.sort()) {
        if (!LOCAL_BOOK_EXTS.has(path.extname(name).toLowerCase()))
            continue;
        const full = path.join(root, name);
        try {
            const st = await stat(full);
            if (!st.isFile())
                continue;
            rows.push({
                name,
                title: path.basename(name, path.extname(name)),
                path: full,
                bytes: st.size,
            });
        }
        catch {
            /* unreadable entry — skip */
        }
        if (rows.length >= limit)
            break;
    }
    return rows;
}
let projectsSummaryAt = 0;
let projectsSummaryCache: ProjectSummary[] | null = null;
/**
 * Known workspaces with a cheap per-project summary (works/chapters/words).
 * Summaries are derived from each project's own .zhizhang — never authoritative copies.
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
        const worksDir = typeof entry.works === "string" && path.isAbsolute(entry.works)
            ? entry.works
            : path.join(base, "works");
        let existsFlag = false;
        try {
            existsFlag = (await stat(worksDir)).isDirectory();
        }
        catch {
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
            }
            catch (err) {
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
                wordCount: w.recoveryPending ? null : chapters.reduce((x: any, c: any) => x + (c.wordCount || 0), 0),
                updatedAt: w.updatedAt ?? "",
                recoveryPending: w.recoveryPending === true,
            };
        });
        const recoveryPending = rowsWorks.some((w: any) => w.recoveryPending);
        const countsUnavailable = recoveryPending || Boolean(worksError);
        rows.push({
            id: entry.id || projectIdOf(base),
            base,
            worksRoot: worksDir,
            name: entry.name || projectNameOf(base),
            lastUsedAt: entry.lastUsedAt ?? "",
            exists: existsFlag,
            works: rowsWorks,
            worksCount: worksError ? null : rowsWorks.length,
            chapters: countsUnavailable ? null : rowsWorks.reduce((x: number, w: any) => x + w.chapters, 0),
            words: countsUnavailable ? null : rowsWorks.reduce((x: number, w: any) => x + w.wordCount, 0),
            recoveryPending,
            ...(worksError ? { error: worksError } : {}),
        });
    }
    rows.sort((a: any, b: any) => String(b.lastUsedAt ?? "").localeCompare(String(a.lastUsedAt ?? "")));
    projectsSummaryCache = rows;
    projectsSummaryAt = Date.now();
    return rows;
}
export function storagePaths(exec: ExecContext | null, config: PluginConfig, workingDir: any) {
    const cwd = sessionCwd(exec);
    let base;
    if (workingDir !== undefined && workingDir !== "") {
        base = path.isAbsolute(workingDir) ? workingDir : path.resolve(cwd, workingDir);
    }
    else if (config?.storageRoot || process.env.DSH_ZHIZHANG_ROOT) {
        base = path.resolve(config?.storageRoot || process.env.DSH_ZHIZHANG_ROOT!);
    }
    else {
        base = path.resolve(cwd, config?.rootDir ?? ".zhizhang");
    }
    // Optional novels folder: one visible directory per book, instead of <base>/works.
    const worksRaw = (config?.worksRoot ?? process.env.DSH_ZHIZHANG_WORKS ?? "").trim();
    const works = worksRaw
        ? path.isAbsolute(worksRaw)
            ? worksRaw
            : path.resolve(cwd, worksRaw)
        : path.join(base, "works");
    // Optional shared library: cards/sources live in one root shared by every project.
    // Works / manuscripts / inspiration stay per-project.
    const libRaw = (config?.libraryRoot ?? process.env.DSH_ZHIZHANG_LIBRARY ?? "").trim();
    const library = libRaw
        ? path.isAbsolute(libRaw)
            ? libRaw
            : path.resolve(cwd, libRaw)
        : path.join(base, "library");
    // Optional local book shelf: a folder the Agent may import from by file name.
    const srcRaw = (config?.sourceRoot ?? process.env.DSH_ZHIZHANG_SOURCE_ROOT ?? "").trim();
    const sourceRoot = srcRaw
        ? path.isAbsolute(srcRaw)
            ? srcRaw
            : path.resolve(cwd, srcRaw)
        : "";
    return {
        base,
        works,
        manuscripts: path.join(base, "manuscripts"),
        library,
        inspiration: path.join(base, "inspiration"),
        sourceRoot,
    };
}
export async function ensureStorage(exec: ExecContext | null, config: PluginConfig, workingDir?: any): Promise<StoragePaths> {
    const paths = storagePaths(exec, config, workingDir);
    await Promise.all([paths.works, paths.manuscripts, paths.library, paths.inspiration].map(root => assertSafeAncestors(path.join(root, ".root-check"))));
    await mkdir(paths.works, { recursive: true });
    await mkdir(paths.manuscripts, { recursive: true });
    await mkdir(paths.library, { recursive: true });
    await mkdir(paths.inspiration, { recursive: true });
    // Tools pass exec; HTTP passes null. Remembering only tool roots lets the
    // Web panel follow the workspace the Agent is actually writing to.
    if (exec) {
        rememberToolBase(paths.base, paths.works);
        rememberProject(paths.base, paths.works);
    }
    return paths;
}
function assertInside(base: string, target: string, label: string) {
    // Normalize both sides: config paths often use forward slashes (D:/x/y),
    // while path.join produces backslashes on Windows.
    const baseResolved = path.resolve(base);
    const resolved = path.resolve(target);
    if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
        throw new Error(`${label} 越界：${target}`);
    }
    return resolved;
}
export function workDir(paths: StoragePaths, key: string) {
    const safe = slugify(key);
    if (safe.includes("..") || path.isAbsolute(safe)) {
        throw new ZhizhangError("bad_id", "作品 key 非法");
    }
    return assertInside(paths.works, path.join(paths.works, safe), "作品目录");
}
function ledgerPath(dir: string) {
    return path.join(dir, "ledger.json");
}
function candidatesDir(dir: string) {
    return path.join(dir, "candidates");
}
function briefCrumbsPath(dir: string) {
    return path.join(dir, "brief-crumbs.json");
}
function payoffAuditsPath(dir: string) {
    return path.join(dir, "payoff-audits.json");
}
/** Recency window for brief / payoff soft·hard checks on accept (12h). */
export { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD } from "./domain/constants.js";
/** chapter_save: body over this word count needs confirm_bypass=true. */

// —— § works ——
export async function createWork(paths: StoragePaths, input: any) {
    const key = slugify(input.key?.trim() || input.title);
    await assertSafeAncestors(path.join(paths.works, ".root-check"));
    await mkdir(paths.works, { recursive: true });
    let dir = "";
    let finalKey = "";
    // Reserve the directory atomically: even a directory without meta.json may contain user files.
    for (let attempt = 0; attempt < 20; attempt++) {
        const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
        const candidate = attempt === 0 ? key : `${Array.from(key).slice(0, 51).join("")}-${suffix}`;
        const proposed = workDir(paths, candidate);
        try {
            await mkdir(proposed);
            dir = proposed;
            finalKey = path.basename(proposed);
            break;
        }
        catch (err: any) {
            if (err?.code !== "EEXIST") throw err;
        }
    }
    if (!dir) throw new ZhizhangError("work_create_failed", "无法为作品分配独立目录，请检查作品根目录。");
    const stamp = nowIso();
    const meta = {
        schemaVersion: SCHEMA_VERSION, key: finalKey, title: input.title.trim(),
        genre: (input.genre ?? "").trim(), premise: (input.premise ?? "").trim(),
        foundation: EMPTY_FOUNDATION(), createdAt: stamp, updatedAt: stamp, chapters: [],
    };
    try {
        await mkdir(chaptersDir(dir), { recursive: true });
        await mkdir(candidatesDir(dir), { recursive: true });
        await atomicWrite(metaPath(dir), JSON.stringify(meta, null, 2) + "\n");
        await atomicWrite(ledgerPath(dir), JSON.stringify({ schemaVersion: SCHEMA_VERSION, workKey: finalKey, entries: [] }, null, 2) + "\n");
    }
    catch (err: any) {
        throw new ZhizhangError("partial_work_create", `作品目录 ${dir} 已创建，但初始化未完成（${err?.message ?? String(err)}）。原目录已保留，请核对后处理。`);
    }
    return { meta, dir };
}
async function exists(file: string) {
    try {
        await stat(file);
        return true;
    }
    catch (err) {
        if (isMissingFileError(err)) return false;
        throw err;
    }
}
export async function listWorks(paths: StoragePaths) {
    let names;
    try {
        names = await readdir(paths.works);
    }
    catch (err) {
        if (isMissingFileError(err)) return [];
        throw err;
    }
    const rows = [];
    for (const name of names) {
        const file = metaPath(path.join(paths.works, name));
        try {
            // Pending acceptance means counts may be between two valid versions.
            const row = await readJsonCached(file);
            if (!row || typeof row !== "object" || Array.isArray(row) || (row.chapters !== undefined && !Array.isArray(row.chapters)))
                throw new ZhizhangError("bad_work_meta", `作品元数据格式损坏：${file}`);
            let recoveryPending = false;
            let recoveryHint = "";
            try { await assertNoPendingAccept(path.join(paths.works, name)); }
            catch (err) {
                if (!(err instanceof ZhizhangError) || err.code !== "recovery_required") throw err;
                recoveryPending = true;
                recoveryHint = err.message;
            }
            rows.push({ ...row, chapters: row.chapters ?? [], recoveryPending, recoveryHint });
        }
        catch (err) {
            if (!isMissingFileError(err)) throw err;
        }
    }
    rows.sort((a: any, b: any) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return rows;
}
export async function resolveWorkDir(paths: StoragePaths, keyOrTitle: any) {
    const direct = workDir(paths, keyOrTitle);
    if (await exists(metaPath(direct)))
        return direct;
    const all = await listWorks(paths);
    const hit = all.find((w: any) => w.key === keyOrTitle || w.title === keyOrTitle);
    if (!hit)
        throw new ZhizhangError("work_not_found", `找不到作品：${keyOrTitle}`);
    return workDir(paths, hit.key);
}
export async function setFoundation(dir: string, patch: any, options: { pace?: string } = {}) {
    const pace = validateStoryPace(options.pace);
    return withResourceLock(dir, async () => {
        const meta = await readWorkMeta(dir);
        if (pace !== undefined) meta.pace = pace;
        meta.foundation = normalizeFoundation({ ...meta.foundation, ...patch });
        await writeWorkMeta(dir, meta);
        return meta;
    });
}
/** Update a chapter outcome under the work lock, preserving all other author-written text. */
export async function appendHappenedLine(dir: string, chapterId: string, line: string, replace = false) {
    return withResourceLock(dir, async () => {
        const meta = await readWorkMeta(dir);
        const existing = String(meta.foundation.happened ?? "");
        const mark = `[${chapterId}]`;
        if (existing.includes(mark)) {
            if (!replace) return { meta, appended: false, line, reason: "already_recorded" };
            const lines = existing.split("\n");
            const positions = lines.flatMap((value, index) => value.trimStart().startsWith(mark) ? [index] : []);
            if (positions.length !== 1)
                return { meta, appended: false, line, reason: "ambiguous_record" };
            lines[positions[0]] = line;
            meta.foundation = normalizeFoundation({ ...meta.foundation, happened: lines.join("\n") });
            await writeWorkMeta(dir, meta);
            return { meta, appended: false, replaced: true, line };
        }
        const happened = existing.trim() ? `${existing.trim()}\n${line}` : line;
        meta.foundation = normalizeFoundation({ ...meta.foundation, happened });
        await writeWorkMeta(dir, meta);
        return { meta, appended: true, line };
    });
}
// —— § candidates ——
/** Persist candidate JSON without dropping optional multi-draft / edit fields. */
export function candidateToDiskMeta(cand: any) {
    const disk = {
        schemaVersion: cand.schemaVersion,
        id: cand.id,
        workKey: cand.workKey,
        chapterId: cand.chapterId,
        stagedAt: cand.stagedAt,
        source: cand.source,
        note: cand.note,
        bodyFile: cand.bodyFile,
    } as Candidate;
    if (cand.targetRevision) disk.targetRevision = cand.targetRevision;
    if (cand.basis) disk.basis = cand.basis;
    if (cand.lintPassToken)
        disk.lintPassToken = cand.lintPassToken;
    if (cand.lintedAt)
        disk.lintedAt = cand.lintedAt;
    if (cand.lintBodyHash)
        disk.lintBodyHash = cand.lintBodyHash;
    if (cand.lintHitCount !== undefined)
        disk.lintHitCount = cand.lintHitCount;
    if (cand.acceptedAt)
        disk.acceptedAt = cand.acceptedAt;
    if (cand.acceptedMode)
        disk.acceptedMode = cand.acceptedMode;
    if (cand.editOf)
        disk.editOf = cand.editOf;
    if (cand.editMode)
        disk.editMode = cand.editMode;
    if (cand.editedAt)
        disk.editedAt = cand.editedAt;
    if (cand.draftLabel)
        disk.draftLabel = cand.draftLabel;
    if (cand.variantGroup)
        disk.variantGroup = cand.variantGroup;
    if (cand.unifyOf && cand.unifyOf.length)
        disk.unifyOf = cand.unifyOf;
    const words = typeof cand.wordCount === "number"
        ? cand.wordCount
        : typeof cand.body === "string"
            ? countWords(cand.body)
            : undefined;
    if (typeof words === "number")
        disk.wordCount = words;
    return disk;
}
export async function stageCandidate(dir: string, input: any) {
    return withResourceLock(dir, async () => {
    if (!String(input.body ?? "").trim()) {
        throw new ZhizhangError("candidate_empty", "候选正文为空，拒绝暂存");
    }
    const chapterId = assertResourceId(input.chapterId, "章节 id");
    // 候选必须指向已存在的章（章纲由 outline_set / inspire apply 建立）——否则 accept 的
    // brief/兑付闸都无从对照，错误还会迟到且语义不明（先撞 brief_required）。
    const meta = await readWorkMeta(dir);
    if (!meta.chapters.some((c: any) => c.id === chapterId)) {
        throw new ZhizhangError("chapter_not_found", `目标章 ${chapterId} 不存在：先 outline_set（或 inspire_accept apply）建章纲，再交候选`);
    }
    // Date.now() 只能到毫秒；并发 stage 会在同一毫秒生成同一个 id 并互相覆盖。
    const id = `cand-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await mkdir(candidatesDir(dir), { recursive: true });
    const bodyFile = `${id}.md`;
    if (await snapshotFile(path.join(candidatesDir(dir), bodyFile)) !== null || await snapshotFile(path.join(candidatesDir(dir), `${id}.json`)) !== null)
        throw new ZhizhangError("id_collision", "候选 id 已存在，未覆盖原文件，请重新暂存。");
    const stagedAt = nowIso();
    const preparedContext = await getRecentBrief(dir, chapterId, Infinity);
    const cand: Candidate = {
        schemaVersion: SCHEMA_VERSION,
        id,
        workKey: meta.key,
        chapterId,
        stagedAt,
        targetRevision: (await readChapter(dir, chapterId)).revision,
        basis: preparedContext?.basis,
        source: input.source ?? "agent",
        note: input.note ?? "",
        body: input.body,
        bodyFile,
        wordCount: countWords(input.body),
    };
    if (input.editOf) {
        cand.editOf = input.editOf;
        cand.editedAt = stagedAt;
    }
    if (input.editMode)
        cand.editMode = input.editMode;
    if (input.draftLabel?.trim())
        cand.draftLabel = input.draftLabel.trim();
    if (input.variantGroup?.trim())
        cand.variantGroup = input.variantGroup.trim();
    if (input.unifyOf?.length)
        cand.unifyOf = [...input.unifyOf];
    const disk = candidateToDiskMeta(cand);
    const journal = await createWorkRecordJournal(dir, { kind: "stage", chapterId, candidateId: id, writes: [
        { file: `candidates/${bodyFile}`, before: null, content: input.body },
        { file: `candidates/${id}.json`, before: null, content: JSON.stringify(disk, null, 2) + "\n" },
    ] });
    try { await finishChapterJournal(dir, journal); }
    catch (err: any) {
        if (err instanceof ZhizhangError) throw err;
        throw new ZhizhangError("recovery_required", `候选 ${id} 暂存未完成（${err?.message ?? String(err)}），请先检查作品恢复记录。`);
    }
    return cand;
    });
}
/** Decode the same metadata contract for reads and list projections. */
function candidateBodyFile(disk: any, id: string): string {
    if (!disk || typeof disk !== "object" || Array.isArray(disk) || disk.id !== id || typeof disk.chapterId !== "string" || (disk.bodyFile !== undefined && (typeof disk.bodyFile !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(disk.bodyFile))))
        throw new ZhizhangError("bad_candidate", `候选 ${id} 元数据损坏，请保留文件并核对。`);
    assertResourceId(disk.chapterId, "章节 id");
    return disk.bodyFile ?? `${id}.md`;
}
export async function readCandidate(dir: string, candidateId: string) {
    await assertNoPendingAccept(dir);
    const id = assertResourceId(candidateId, "候选 id");
    const raw = await readFile(path.join(candidatesDir(dir), `${id}.json`), "utf8");
    const disk = JSON.parse(raw);
    const bodyFile = candidateBodyFile(disk, id);
    const body = await readFile(path.join(candidatesDir(dir), bodyFile), "utf8");
    return { ...disk, body };
}
/**
 * Record that style_lint ran on a staged candidate and issue lintPassToken.
 * Token proves the sensor ran (hitCount may be > 0) — NOT a quality pass.
 * Replaces any prior scan. Adoption can also scan inline; existing credentials must remain valid.
 */
export async function markCandidateLinted(dir: string, candidateId: string, hitCount: any, expectedBody?: string) {
    const id = assertResourceId(candidateId, "候选 id");
    return withResourceLock(dir, async () => {
        const candidatePath = path.join(candidatesDir(dir), `${id}.json`);
        const [candidateBefore, ledgerBefore] = await Promise.all([snapshotFile(candidatePath), snapshotFile(ledgerPath(dir))]);
        const cand = await readCandidate(dir, id);
        if (cand.acceptedAt) {
            throw new ZhizhangError("candidate_already_accepted", `候选 ${id} 已采纳，无需再扫；请重新 stage 新候选后再 lint。`);
        }
        if (expectedBody !== undefined && cand.body !== expectedBody)
            throw new ZhizhangError("candidate_changed", "候选正文在扫描期间发生变化，请重新扫描。");
        const ledger = await readLedger(dir);
        const token = `lint-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        const lintedAt = nowIso();
        const diskMeta = candidateToDiskMeta({
            ...cand,
            lintPassToken: token,
            lintBodyHash: createHash("sha256").update(cand.body, "utf8").digest("hex"),
            lintedAt,
            lintHitCount: hitCount,
        });
        ledger.entries.push({ id: randomUUID().slice(0, 8), at: nowIso(), chapterId: cand.chapterId, kind: "style_lint", summary: `语感雷达候选 ${id}：${hitCount} 处命中 · token=${token}`, styleHitCount: hitCount });
        if (ledger.entries.length > LEDGER_MAX_ENTRIES) ledger.entries = ledger.entries.slice(-LEDGER_MAX_ENTRIES);
        if (await snapshotFile(candidatePath) !== candidateBefore || await snapshotFile(ledgerPath(dir)) !== ledgerBefore)
            throw new ZhizhangError("recovery_conflict", "候选或审校账本在准备期间变化，请重新扫描。");
        const journal = await createWorkRecordJournal(dir, { kind: "lint", chapterId: cand.chapterId, candidateId: id, writes: [
            { file: `candidates/${id}.json`, before: candidateBefore, content: JSON.stringify(diskMeta, null, 2) + "\n" },
            { file: "ledger.json", before: ledgerBefore, content: JSON.stringify(ledger, null, 2) + "\n" },
        ] });
        try { await finishChapterJournal(dir, journal); }
        catch (err: any) {
            if (err instanceof ZhizhangError) throw err;
            throw new ZhizhangError("recovery_required", `扫描留痕未完成（${err?.message ?? String(err)}），请先检查作品恢复记录。`);
        }
        return { token, lintedAt, hitCount, chapterId: cand.chapterId };
    });
}
/** True when candidate has a lint pass recorded at/after stagedAt. */
export function candidateHasLintPass(cand: any) {
    if (!cand.lintPassToken || !cand.lintedAt || !cand.lintBodyHash || typeof cand.body !== "string") return false;
    const actual = createHash("sha256").update(cand.body, "utf8").digest("hex");
    return cand.lintBodyHash === actual && cand.lintedAt >= cand.stagedAt;
}
/** Bind policy evaluation to the exact candidate later committed. */
export function candidateGateFingerprint(cand: any) {
    return createHash("sha256").update(JSON.stringify(candidateToDiskMeta(cand))).update("\0").update(String(cand.body ?? "")).digest("hex");
}
/**
 * Accept a staged candidate into the chapter draft. Explicit tool only —
 * never called implicitly by generation. Replaces or appends body per mode.
 *
 * Refuse rules (engineering gate — not AI judgment):
 * - already-accepted candidate → refuse (stage a new one)
 * - no recorded scan → scan inline; stale recorded scan → refuse
 * - lintPassToken provided but mismatches → refuse
 * - target chapter status is final → refuse unless force=true
 */
export async function acceptCandidate(dir: string, candidateId: string, mode: any = "replace", opts: any = {}) {
    const id = assertResourceId(candidateId, "候选 id");
    const acceptMode: "append" | "replace" = mode === "append" ? "append" : "replace";
    return withResourceLock(dir, async () => {
        await assertNoPendingAccept(dir);
        const candidatePath = path.join(candidatesDir(dir), `${id}.json`);
        const candidateBefore = await snapshotFile(candidatePath);
        const cand = await readCandidate(dir, id);
        const chapterId = assertResourceId(cand.chapterId, "章节 id");
        if (opts.expectedCandidate && opts.expectedCandidate !== candidateGateFingerprint(cand))
            throw new ZhizhangError("candidate_changed", "候选在验收检查期间发生变化，请重新检查并扫描。");
        if (cand.acceptedAt)
            throw new ZhizhangError("candidate_already_accepted", `候选 ${id} 已于 ${cand.acceptedAt} 采纳，禁止重复写回。请重新暂存候选。`);
        if (!cand.body.trim()) throw new ZhizhangError("candidate_empty", `候选 ${id} 正文为空，拒绝采纳`);
        const provided = opts.lintPassToken?.trim();
        if (provided && (!cand.lintPassToken || cand.lintPassToken !== provided))
            throw new ZhizhangError("lint_token_mismatch", `lintPassToken 无效或不匹配，请对候选 ${id} 重新调用 style_lint。`);
        if (!candidateHasLintPass(cand)) {
            if (cand.lintPassToken) throw new ZhizhangError("lint_required", `候选 ${id} 在扫描后变化，请重新扫描。`);
            cand.lintHitCount = lintStyle(cand.body).length;
            cand.lintBodyHash = createHash("sha256").update(cand.body).digest("hex");
            cand.lintedAt = nowIso();
            cand.lintPassToken = `inline-${randomUUID()}`;
        }
        if (cand.basis) await assertContextBasis(dir, cand.basis, chapterId);
        if (!cand.targetRevision && opts.expectedRevision === undefined)
            throw new ZhizhangError("legacy_baseline_required", "旧候选无目标版本，请传 expected_revision 明确核对当前目标，或重新暂存。");
        const bodyFile = typeof cand.bodyFile === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(cand.bodyFile) ? cand.bodyFile : `${id}.md`;
        const bodyHash = await snapshotFile(path.join(candidatesDir(dir), bodyFile));
        if (!bodyHash || bodyHash !== createHash("sha256").update(cand.body, "utf8").digest("hex"))
            throw new ZhizhangError("candidate_changed", "候选正文在采纳期间发生变化，请重新检查并扫描。");
        {
            await assertNoPendingAccept(dir);
            const chapterPath = path.join(dir, "chapters", `${assertResourceId(chapterId, "章节 id")}.md`);
            const [chapterBefore, metaBefore, ledgerBefore] = await Promise.all([
                snapshotFile(chapterPath), snapshotFile(metaPath(dir)), snapshotFile(ledgerPath(dir)),
            ]);
            const ledger = await readLedger(dir);
            let body = cand.body;
            let title = chapterId;
            let existingFinal = false;
            try {
                const existing = await readChapter(dir, chapterId);
                title = existing.title;
                if (opts.expectedOutline && opts.expectedOutline !== fingerprint(existing.outline))
                    throw new ZhizhangError("context_changed", "章纲在采纳检查期间变化，请重核诊断与依据。");
                if (existing.status === "final") {
                    existingFinal = true;
                    if (opts.force !== true)
                        throw new ZhizhangError("refuse_overwrite_final", `章节 ${chapterId} 已是 final，拒绝用候选取代。确需改稿请传 force=true，采纳后需重新定稿。`);
                }
                if (acceptMode === "append") body = `${existing.body.trimEnd()}\n\n${cand.body}`;
            }
            catch (err) { if (!isMissingFileError(err)) throw err; }
            const prepared = await prepareChapterSaveUnlocked(dir, { id: chapterId, title, body, status: "drafted", force: opts.force === true, expectedRevision: acceptMode === "replace" ? (cand.targetRevision ?? opts.expectedRevision) : undefined, dependencies: cand.basis?.previous ? [cand.basis.previous] : [] });
            // The prepared intent already includes the versioned continuation index.
            const meta = JSON.parse(prepared.metaContent);
            const ending = prepared.record.outline.ending || "";
            const resolved = resolveHappenedText({ ending, body: prepared.record.body });
            const append = { appended: false, line: "", reason: "working_only" };
            const stateUpdate = { ending, resolved, append, threads: meta.foundation.threads };
            const acceptedAt = nowIso();
            const diskMeta = candidateToDiskMeta({ ...cand, acceptedAt, acceptedMode: acceptMode });
            ledger.entries.push({
                id: randomUUID().slice(0, 8), at: nowIso(), chapterId: chapterId, kind: "note",
                history: prepared.history,
                summary: existingFinal
                    ? `强制采纳候选 ${id}（${acceptMode}，原 final→drafted）→ 本地草稿，未定稿`
                    : `采纳候选 ${id}（${acceptMode}）→ 本地草稿，未定稿`,
            });
            if (ledger.entries.length > LEDGER_MAX_ENTRIES) ledger.entries = ledger.entries.slice(-LEDGER_MAX_ENTRIES);
            const journalId = await createAcceptJournal(dir, {
                chapterId: chapterId, candidateId: id, mode: acceptMode, bodyFile, bodyHash,
                writes: [
                    { file: `chapters/${chapterId}.md`, before: chapterBefore, content: prepared.chapterContent },
                    { file: "meta.json", before: metaBefore, content: prepared.metaContent },
                    { file: `candidates/${id}.json`, before: candidateBefore, content: JSON.stringify(diskMeta, null, 2) + "\n" },
                    { file: "ledger.json", before: ledgerBefore, content: JSON.stringify(ledger, null, 2) + "\n" },
                ],
            });
            try { await finishAcceptJournal(dir, journalId); }
            catch (err: any) {
                if (err instanceof ZhizhangError) throw err;
                throw new ZhizhangError("recovery_required", `采纳未完整提交（${err?.message ?? String(err)}）。请用 zhizhang_status(work=作品, recovery=inspect) 检查，再决定是否恢复；不要重新采纳。`);
            }
            return { ...prepared.record, stateUpdate };
        }
    });
}

export async function listCandidates(dir: string) {
    let names;
    try {
        names = await readdir(candidatesDir(dir));
    }
    catch (err) {
        if (isMissingFileError(err)) return [];
        throw err;
    }
    const rows = [];
    for (const name of names) {
        if (!name.endsWith(".json"))
            continue;
        try {
            // mtime 缓存：面板每轮轮询都全量列候选，未变的候选不必重读。
            const raw = await readJsonCached(path.join(candidatesDir(dir), name));
            const bodyFile = candidateBodyFile(raw, name.slice(0, -5));
            if (!(await stat(path.join(candidatesDir(dir), bodyFile))).isFile())
                throw new ZhizhangError("bad_candidate", `候选 ${raw.id} 正文不是普通文件。`);
            // wordCount is persisted at stage time; only legacy rows re-read the body.
            let wordCount = typeof raw.wordCount === "number" ? raw.wordCount : 0;
            if (typeof raw.wordCount !== "number") {
                const body = await readFile(path.join(candidatesDir(dir), bodyFile), "utf8");
                wordCount = countWords(body);
            }
            rows.push({
                ...raw,
                wordCount,
                pending: !raw.acceptedAt,
            });
        }
        catch (err) {
            rows.push({ id: name.slice(0, -5), chapterId: "", stagedAt: "", pending: false, unavailable: true, error: err instanceof Error ? err.message : String(err) });
        }
    }
    rows.sort((a: any, b: any) => (a.stagedAt < b.stagedAt ? 1 : -1));
    return rows;
}
/** Caller holds the work lock; retain the original intent across both files. */
async function commitWorkRecord(dir: string, kind: "brief" | "payoff", chapterId: string, recordBefore: string | null, recordContent: string, ledgerBefore: string | null, ledgerContent: string) {
    const recordFile = kind === "brief" ? "brief-crumbs.json" : "payoff-audits.json";
    if (await snapshotFile(path.join(dir, recordFile)) !== recordBefore || await snapshotFile(ledgerPath(dir)) !== ledgerBefore)
        throw new ZhizhangError("recovery_conflict", "留痕文件在准备期间变化，请重新检查。");
    const journal = await createWorkRecordJournal(dir, { kind, chapterId, writes: [
        { file: recordFile, before: recordBefore, content: recordContent },
        { file: "ledger.json", before: ledgerBefore, content: ledgerContent },
    ] });
    try { await finishChapterJournal(dir, journal); }
    catch (err: any) {
        if (err instanceof ZhizhangError) throw err;
        throw new ZhizhangError("recovery_required", `留痕更新未完成（${err?.message ?? String(err)}）。请先检查作品恢复记录。`);
    }
}
// —— § brief crumbs ——
export async function readBriefCrumbs(dir: string) {
    await assertNoPendingAccept(dir);
    try {
        const raw = await readFile(briefCrumbsPath(dir), "utf8");
        const data = JSON.parse(raw);
        if (!data || typeof data !== "object" || !Array.isArray(data.entries))
            throw new ZhizhangError("bad_brief_records", `简报留痕格式损坏：${briefCrumbsPath(dir)}`);
        return data;
    }
    catch (err) {
        if (!isMissingFileError(err)) throw err;
        const meta = await readWorkMeta(dir);
        return { schemaVersion: SCHEMA_VERSION, workKey: meta.key, entries: [] };
    }
}
export async function recordBriefBreadcrumb(dir: string, input: any) {
    return withResourceLock(dir, async () => {
        const [recordBefore, ledgerBefore] = await Promise.all([snapshotFile(briefCrumbsPath(dir)), snapshotFile(ledgerPath(dir))]);
        const file = await readBriefCrumbs(dir);
        const ledger = await readLedger(dir);
        if (input.basis) await assertContextBasis(dir, input.basis, input.chapterId);
        const crumb = {
            chapterId: input.chapterId,
            at: nowIso(),
            assetIds: [...input.assetIds],
            basis: input.basis,
        };
        file.entries.push(crumb);
        if (file.entries.length > 200)
            file.entries = file.entries.slice(-200);
        ledger.entries.push({ id: randomUUID().slice(0, 8), at: nowIso(), chapterId: input.chapterId, kind: "brief_seen", summary: `chapter_brief · assets=${input.assetIds.join(",") || "(none)"}` });
        if (ledger.entries.length > LEDGER_MAX_ENTRIES) ledger.entries = ledger.entries.slice(-LEDGER_MAX_ENTRIES);
        await commitWorkRecord(dir, "brief", String(input.chapterId ?? ""), recordBefore, JSON.stringify(file, null, 2) + "\n", ledgerBefore, JSON.stringify(ledger, null, 2) + "\n");
        return crumb;
    });
}
/** Most recent brief for chapter within maxAgeMs (default BRIEF_RECENT_MS). */
export async function getRecentBrief(dir: string, chapterId: string, maxAgeMs: any = BRIEF_RECENT_MS) {
    const file = await readBriefCrumbs(dir);
    const now = Date.now();
    for (let i = file.entries.length - 1; i >= 0; i--) {
        const e = file.entries[i];
        if (e.chapterId !== chapterId)
            continue;
        const at = Date.parse(e.at);
        // 时间戳损坏的条目跳过继续往旧找，而不是让整个查询失效。
        if (!Number.isFinite(at))
            continue;
        if (e.basis || now - at <= maxAgeMs)
            return e;
        return null;
    }
    return null;
}
// —— § payoff audits ——
export async function readPayoffAudits(dir: string) {
    await assertNoPendingAccept(dir);
    try {
        const raw = await readFile(payoffAuditsPath(dir), "utf8");
        const data = JSON.parse(raw);
        if (!data || typeof data !== "object" || !Array.isArray(data.entries))
            throw new ZhizhangError("bad_payoff_records", `兑付留痕格式损坏：${payoffAuditsPath(dir)}`);
        return data;
    }
    catch (err) {
        if (!isMissingFileError(err)) throw err;
        const meta = await readWorkMeta(dir);
        return { schemaVersion: SCHEMA_VERSION, workKey: meta.key, entries: [] };
    }
}
export async function storePayoffAudit(dir: string, entry: any) {
    return withResourceLock(dir, async () => {
        const [recordBefore, ledgerBefore] = await Promise.all([snapshotFile(payoffAuditsPath(dir)), snapshotFile(ledgerPath(dir))]);
        const file = await readPayoffAudits(dir);
        const ledger = await readLedger(dir);
        const full = {
            ...entry,
            at: entry.at ?? nowIso(),
        };
        file.entries.push(full);
        if (file.entries.length > 100)
            file.entries = file.entries.slice(-100);
        ledger.entries.push({ id: randomUUID().slice(0, 8), at: nowIso(), chapterId: entry.chapterId, kind: "payoff_audit", summary: full.summary });
        if (ledger.entries.length > LEDGER_MAX_ENTRIES) ledger.entries = ledger.entries.slice(-LEDGER_MAX_ENTRIES);
        await commitWorkRecord(dir, "payoff", String(entry.chapterId ?? ""), recordBefore, JSON.stringify(file, null, 2) + "\n", ledgerBefore, JSON.stringify(ledger, null, 2) + "\n");
        return full;
    });
}
export async function getLastPayoffAudit(dir: string, chapterId: string) {
    const file = await readPayoffAudits(dir);
    for (let i = file.entries.length - 1; i >= 0; i--) {
        const e = file.entries[i];
        if (!chapterId || e.chapterId === chapterId)
            return e;
    }
    return null;
}
/** Most recent payoff audit for chapter within maxAgeMs (default BRIEF_RECENT_MS). */
export async function getRecentPayoffAudit(dir: string, chapterId: string, maxAgeMs: any = BRIEF_RECENT_MS) {
    const file = await readPayoffAudits(dir);
    const now = Date.now();
    for (let i = file.entries.length - 1; i >= 0; i--) {
        const e = file.entries[i];
        if (e.chapterId !== chapterId)
            continue;
        const at = Date.parse(e.at);
        // 同 getRecentBrief：坏时间戳跳过，不让查询整条失效。
        if (!Number.isFinite(at))
            continue;
        if (e.basis || now - at <= maxAgeMs)
            return e;
        return null;
    }
    return null;
}
export async function assembleManuscript(dir: string, paths: StoragePaths, opts: any = {}) {
    return withResourceLock(dir, async () => {
    const meta = await readWorkMeta(dir);
    const chapters = [...meta.chapters].sort((a: any, b: any) => a.position - b.position);
    const parts = [`# ${meta.title}`, ""];
    if (meta.premise)
        parts.push(`> ${meta.premise}`, "");
    let words = 0;
    let included = 0;
    for (const ch of chapters) {
        if (opts.onlyFinal && ch.status !== "final" && ch.status !== "reviewed")
            continue;
        let record;
        try {
            record = await readChapter(dir, ch.id);
        }
        catch (err) {
            throw new ZhizhangError("assemble_chapter_unreadable", `章节 ${ch.id} 无法读取，未生成或覆盖成稿。请核对原文件：${err instanceof Error ? err.message : String(err)}`);
        }
        if (!record.body.trim())
            continue;
        parts.push(`## ${record.title}`, "", record.body.trim(), "");
        words += record.wordCount;
        included += 1;
    }
    if (included === 0)
        throw new Error("没有可汇编的章节正文");
    const rel = opts.outputRel?.trim() || `manuscripts/${meta.key}.md`;
    if (path.isAbsolute(rel))
        throw new Error("output 只能是相对路径");
    const out = assertInside(paths.manuscripts, path.resolve(paths.base, rel), "汇编输出（须位于 manuscripts 目录）");
    await mkdir(paths.manuscripts, { recursive: true });
    await mkdir(path.dirname(out), { recursive: true });
    assertInside(await realpath(paths.manuscripts), await realpath(path.dirname(out)), "汇编输出目录");
    await atomicWrite(out, parts.join("\n") + "\n");
    return { file: out, words, chapters: included };
    });
}
export async function removeWorkDir(dir: string) {
    await rm(dir, { recursive: true, force: true });
}
