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
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { CHAPTER_STATUSES, EMPTY_FOUNDATION, EMPTY_OUTLINE, SCHEMA_VERSION } from "./types.js";
import type { Candidate, ExecContext, Foundation, Outline, PluginConfig, StoragePaths } from "./types.js";

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
        chapters: number;
        wordCount: number;
        updatedAt?: string;
    }[];
    worksCount?: number;
    chapters?: number;
    words?: number;
}
import { ZhizhangError } from "./errors.js";
import { Scheduler } from "./ports/scheduler.js";
import { renderPanelHtml } from "./panel-html.js";
import { readJsonCached } from "./file-cache.js";
const locks = new Map();
let tmpSeq = 0;
// —— § utilities (lock, count, slug) ——
export async function withLock(key: string, fn: (...args: any[]) => any) {
    const previous = locks.get(key) ?? Promise.resolve();
    let release: () => void = () => { };
    const gate = new Promise((resolve: any) => {
        release = resolve;
    });
    const current = previous.then(() => gate);
    locks.set(key, current);
    await previous;
    try {
        return await fn();
    }
    finally {
        release();
        if (locks.get(key) === current)
            locks.delete(key);
    }
}
export function countWords(text: string) {
    if (typeof text !== "string" || text.length === 0)
        return 0;
    const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
    const latin = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
    return cjk + latin;
}
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
/** One safe path segment for chapter / candidate ids (no separators, no traversal). */
const SAFE_RESOURCE_ID = /^[^/\\\u0000-\u001f]{1,64}$/;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
export function assertResourceId(id: string, label: string = "id") {
    const t = String(id ?? "").trim();
    if (!t ||
        !SAFE_RESOURCE_ID.test(t) ||
        t === "." ||
        t === ".." ||
        WINDOWS_RESERVED_NAME.test(t) ||
        /[. ]$/.test(t)) {
        throw new ZhizhangError("bad_id", `${label} 非法（禁止目录穿越 / 保留名）：${t.slice(0, 80)}`);
    }
    return t;
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
            catch {
                works = [];
            }
        }
        const rowsWorks = works.map((w: any) => {
            const chapters = Array.isArray(w.chapters) ? w.chapters : [];
            return {
                key: w.key,
                title: w.title,
                genre: w.genre ?? "",
                chapters: chapters.length,
                wordCount: chapters.reduce((x: any, c: any) => x + (c.wordCount || 0), 0),
                updatedAt: w.updatedAt ?? "",
            };
        });
        rows.push({
            id: entry.id || projectIdOf(base),
            base,
            worksRoot: worksDir,
            name: entry.name || projectNameOf(base),
            lastUsedAt: entry.lastUsedAt ?? "",
            exists: existsFlag,
            works: rowsWorks,
            worksCount: rowsWorks.length,
            chapters: rowsWorks.reduce((x: any, w: any) => x + w.chapters, 0),
            words: rowsWorks.reduce((x: any, w: any) => x + w.wordCount, 0),
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
    else if (config?.storageRoot) {
        base = path.resolve(config.storageRoot);
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
export async function atomicWrite(file: string, content: string) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.${tmpSeq++}.tmp`;
    const handle = await open(tmp, "w");
    try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    try {
        await rename(tmp, file);
    }
    catch (err) {
        // rename 目标被占用等失败时清掉 tmp，避免临时文件在磁盘上累积。
        await rm(tmp, { force: true }).catch(() => { });
        throw err;
    }
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
function metaPath(dir: string) {
    return path.join(dir, "meta.json");
}
function chaptersDir(dir: string) {
    return path.join(dir, "chapters");
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
export const BRIEF_RECENT_MS = 12 * 60 * 60 * 1000;
/** chapter_save: body over this word count needs confirm_bypass=true. */
export const SAVE_BYPASS_WORD_THRESHOLD = 200;
function nowIso() {
    return new Date().toISOString();
}
function normalizeOutline(raw: any): Outline {
    const base = EMPTY_OUTLINE();
    if (!raw || typeof raw !== "object")
        return base;
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
        stateLens: String(raw.stateLens ??
            raw.voiceTone ??
            ""),
    };
}
function normalizeFoundation(raw: any): Foundation {
    const base = EMPTY_FOUNDATION();
    if (!raw || typeof raw !== "object")
        return base;
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
function chapterFile(dir: string, id: string) {
    return path.join(chaptersDir(dir), `${assertResourceId(id, "章节 id")}.md`);
}
function serializeChapterMarkdown(record: any) {
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
function parseChapterMarkdown(raw: string, fallbackId: any) {
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
    let meta;
    try {
        meta = JSON.parse(match[1]);
    }
    catch {
        throw new Error(`章节 front matter 不是合法 JSON：${fallbackId}`);
    }
    // serializeChapterMarkdown always appends a trailing newline; strip it on read.
    const body = (match[2] ?? "").replace(/^\n/, "").replace(/\n$/, "");
    const status = CHAPTER_STATUSES.includes(meta.status)
        ? meta.status
        : "drafting";
    return {
        id: String(meta.id ?? fallbackId),
        title: String(meta.title ?? fallbackId),
        position: typeof meta.position === "number" ? meta.position : 0,
        status,
        wordCount: countWords(body),
        updatedAt: String(meta.updatedAt ?? nowIso()),
        body,
        outline: normalizeOutline(meta.outline),
    };
}
// —— § works ——
export async function createWork(paths: StoragePaths, input: any) {
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
    const meta = {
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
    await atomicWrite(ledgerPath(dir), JSON.stringify({ schemaVersion: SCHEMA_VERSION, workKey: finalKey, entries: [] }, null, 2) +
        "\n");
    return { meta, dir };
}
async function exists(file: string) {
    try {
        await stat(file);
        return true;
    }
    catch {
        return false;
    }
}
/** Only "file is absent" is a valid reason to create a fresh chapter record. */
function isMissingFileError(err: any) {
    return err?.code === "ENOENT";
}
export async function listWorks(paths: StoragePaths) {
    let names;
    try {
        names = await readdir(paths.works);
    }
    catch {
        return [];
    }
    const rows = [];
    for (const name of names) {
        const file = metaPath(path.join(paths.works, name));
        try {
            // mtime 缓存：/works 与 /snapshot 每轮轮询都会全量列作品。
            rows.push(await readJsonCached(file));
        }
        catch {
            /* skip broken */
        }
    }
    rows.sort((a: any, b: any) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return rows;
}
export async function readWorkMeta(dir: string) {
    const raw = await readFile(metaPath(dir), "utf8");
    const meta = JSON.parse(raw);
    meta.foundation = normalizeFoundation(meta.foundation);
    meta.chapters = Array.isArray(meta.chapters) ? meta.chapters : [];
    return meta;
}
export async function writeWorkMeta(dir: string, meta: any) {
    meta.updatedAt = nowIso();
    await atomicWrite(metaPath(dir), JSON.stringify(meta, null, 2) + "\n");
}
export async function resolveWorkDir(paths: StoragePaths, keyOrTitle: any) {
    const direct = workDir(paths, keyOrTitle);
    if (await exists(metaPath(direct)))
        return direct;
    const all = await listWorks(paths);
    const hit = all.find((w: any) => w.key === keyOrTitle || w.title === keyOrTitle);
    if (!hit)
        throw new Error(`找不到作品：${keyOrTitle}`);
    return workDir(paths, hit.key);
}
// —— § chapters ——
export async function listChapters(dir: string) {
    const meta = await readWorkMeta(dir);
    return [...meta.chapters].sort((a: any, b: any) => a.position - b.position);
}
export async function readChapter(dir: string, chapterId: string) {
    const file = chapterFile(dir, chapterId);
    const raw = await readFile(file, "utf8");
    return parseChapterMarkdown(raw, chapterId);
}
/**
 * Panel-only lens read with an mtime+size cache. The Web workbench polls every
 * ~6s; without this it re-reads every chapter file per poll.
 */
const CHAPTER_LENS_CACHE_MAX = 400;
const chapterLensCache = new Map();
async function readChapterLens(dir: string, chapterId: string) {
    const file = chapterFile(dir, chapterId);
    const st = await stat(file);
    const hit = chapterLensCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size)
        return hit.lens;
    const record = parseChapterMarkdown(await readFile(file, "utf8"), chapterId);
    const lens = {
        situationLens: record.outline.situationLens,
        livedScene: record.outline.livedScene,
        stateLens: record.outline.stateLens,
    };
    chapterLensCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, lens });
    if (chapterLensCache.size > CHAPTER_LENS_CACHE_MAX) {
        const oldest = chapterLensCache.keys().next().value;
        if (oldest !== undefined)
            chapterLensCache.delete(oldest);
    }
    return lens;
}
export async function saveChapter(dir: string, input: any) {
    return withLock(dir, async () => {
        const meta = await readWorkMeta(dir);
        const id = input.id?.trim() || `c${String(meta.chapters.length + 1).padStart(3, "0")}`;
        const existingIdx = meta.chapters.findIndex((c: any) => c.id === id);
        let previous = null;
        if (existingIdx >= 0) {
            try {
                previous = await readChapter(dir, id);
            }
            catch (err) {
                // 登记过但读不出来：只有「文件缺失」可以当新建恢复，
                // front matter 损坏必须报出来，不能让 outline/status 被静默重置。
                if (!isMissingFileError(err))
                    throw err;
                previous = null;
            }
        }
        const position = typeof input.position === "number"
            ? input.position
            : previous?.position ?? (existingIdx >= 0 ? meta.chapters[existingIdx].position : meta.chapters.length + 1);
        const outline = normalizeOutline({ ...(previous?.outline ?? EMPTY_OUTLINE()), ...(input.outline ?? {}) });
        const status = input.status && CHAPTER_STATUSES.includes(input.status)
            ? input.status
            : previous?.status ?? "drafted";
        const record = {
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
        const summary = {
            id: record.id,
            title: record.title,
            position: record.position,
            status: record.status,
            wordCount: record.wordCount,
            updatedAt: record.updatedAt,
        };
        if (existingIdx >= 0)
            meta.chapters[existingIdx] = summary;
        else
            meta.chapters.push(summary);
        meta.chapters.sort((a: any, b: any) => a.position - b.position);
        await writeWorkMeta(dir, meta);
        return record;
    });
}
export async function setOutline(dir: string, chapterId: string, patch: any) {
    let previous = null;
    try {
        previous = await readChapter(dir, chapterId);
    }
    catch (err) {
        // 章节文件损坏（front matter 非法等）不能当成「不存在」继续写：
        // 后续 saveChapter 会用空正文覆盖原文件，直接丢稿。
        if (!isMissingFileError(err))
            throw err;
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
export async function setFoundation(dir: string, patch: any) {
    return withLock(dir, async () => {
        const meta = await readWorkMeta(dir);
        meta.foundation = normalizeFoundation({ ...meta.foundation, ...patch });
        await writeWorkMeta(dir, meta);
        return meta;
    });
}
// —— § ledger ——
export async function readLedger(dir: string) {
    try {
        const raw = await readFile(ledgerPath(dir), "utf8");
        const data = JSON.parse(raw);
        data.entries = Array.isArray(data.entries) ? data.entries : [];
        return data;
    }
    catch {
        const meta = await readWorkMeta(dir);
        return { schemaVersion: SCHEMA_VERSION, workKey: meta.key, entries: [] };
    }
}
/** ledger.json 保留的最大条数：面板/回溯只用最近若干条，超出即裁掉最旧的，防止整文件随章节数无限膨胀。 */
export const LEDGER_MAX_ENTRIES = 1000;
export async function appendLedger(dir: string, entry: any) {
    return withLock(`${dir}:ledger`, async () => {
        const ledger = await readLedger(dir);
        const full = {
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
        if (ledger.entries.length > LEDGER_MAX_ENTRIES)
            ledger.entries = ledger.entries.slice(-LEDGER_MAX_ENTRIES);
        await atomicWrite(ledgerPath(dir), JSON.stringify(ledger, null, 2) + "\n");
        return full;
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
    if (cand.lintPassToken)
        disk.lintPassToken = cand.lintPassToken;
    if (cand.lintedAt)
        disk.lintedAt = cand.lintedAt;
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
    if (!String(input.body ?? "").trim()) {
        throw new ZhizhangError("candidate_empty", "候选正文为空，拒绝暂存");
    }
    const chapterId = assertResourceId(input.chapterId, "章节 id");
    // Date.now() 只能到毫秒；并发 stage 会在同一毫秒生成同一个 id 并互相覆盖。
    const id = `cand-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await mkdir(candidatesDir(dir), { recursive: true });
    const bodyFile = `${id}.md`;
    await atomicWrite(path.join(candidatesDir(dir), bodyFile), input.body);
    const meta = await readWorkMeta(dir);
    const stagedAt = nowIso();
    const cand: Candidate = {
        schemaVersion: SCHEMA_VERSION,
        id,
        workKey: meta.key,
        chapterId,
        stagedAt,
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
    await atomicWrite(path.join(candidatesDir(dir), `${id}.json`), JSON.stringify(disk, null, 2) + "\n");
    return cand;
}
export async function readCandidate(dir: string, candidateId: string) {
    const id = assertResourceId(candidateId, "候选 id");
    const raw = await readFile(path.join(candidatesDir(dir), `${id}.json`), "utf8");
    const disk = JSON.parse(raw);
    const bodyFile = typeof disk.bodyFile === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(disk.bodyFile)
        ? disk.bodyFile
        : `${id}.md`;
    const body = await readFile(path.join(candidatesDir(dir), bodyFile), "utf8");
    return { ...disk, body };
}
/**
 * Record that style_lint ran on a staged candidate and issue lintPassToken.
 * Token proves the sensor ran (hitCount may be > 0) — NOT a quality pass.
 * Clears any prior token. Accept still requires the token; hitCount is echoed / optional strict.
 */
export async function markCandidateLinted(dir: string, candidateId: string, hitCount: any) {
    const id = assertResourceId(candidateId, "候选 id");
    return withLock(`${dir}:cand:${id}`, async () => {
        const cand = await readCandidate(dir, id);
        if (cand.acceptedAt) {
            throw new ZhizhangError("candidate_already_accepted", `候选 ${id} 已采纳，无需再扫；请重新 stage 新候选后再 lint。`);
        }
        const token = `lint-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        const lintedAt = nowIso();
        const diskMeta = candidateToDiskMeta({
            ...cand,
            lintPassToken: token,
            lintedAt,
            lintHitCount: hitCount,
        });
        await atomicWrite(path.join(candidatesDir(dir), `${id}.json`), JSON.stringify(diskMeta, null, 2) + "\n");
        await appendLedger(dir, {
            chapterId: cand.chapterId,
            kind: "style_lint",
            summary: `语感雷达候选 ${id}：${hitCount} 处命中 · token=${token}`,
            styleHitCount: hitCount,
        });
        return { token, lintedAt, hitCount, chapterId: cand.chapterId };
    });
}
/** True when candidate has a lint pass recorded at/after stagedAt. */
export function candidateHasLintPass(cand: any) {
    if (!cand.lintPassToken || !cand.lintedAt)
        return false;
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
export async function acceptCandidate(dir: string, candidateId: string, mode: any = "replace", opts: any = {}) {
    const id = assertResourceId(candidateId, "候选 id");
    // 整个「读候选 → 查已采纳 → 写章 → 回写候选」串在同一把候选锁里：
    // 并发 accept 只能一个成功（另一个看到 acceptedAt 硬拒），也不再与
    // markCandidateLinted（同锁）交错写同一份候选 JSON。
    return withLock(`${dir}:cand:${id}`, async () => {
        const cand = await readCandidate(dir, id);
        if (cand.acceptedAt) {
            throw new ZhizhangError("candidate_already_accepted", `候选 ${id} 已于 ${cand.acceptedAt} 采纳（${cand.acceptedMode ?? "replace"}），禁止重复写回。请重新 zhizhang_candidate_stage 新候选。`);
        }
        if (!cand.body.trim()) {
            throw new ZhizhangError("candidate_empty", `候选 ${id} 正文为空，拒绝采纳`);
        }
        const provided = opts.lintPassToken?.trim();
        if (provided) {
            if (!cand.lintPassToken || cand.lintPassToken !== provided) {
                throw new ZhizhangError("lint_token_mismatch", `lintPassToken 无效或不匹配。请对候选 ${id} 重新调用 zhizhang_style_lint（传 candidate），使用返回的 lintPassToken。`);
            }
            if (!candidateHasLintPass(cand)) {
                throw new ZhizhangError("lint_required", `候选 ${id} 的语感扫描已过期（须在 stage 之后）。请重新 zhizhang_style_lint。`);
            }
        }
        else if (!candidateHasLintPass(cand)) {
            throw new ZhizhangError("lint_required", `采纳前必须对候选 ${id} 成功执行 zhizhang_style_lint（传 candidate=…）。软提示不够：代码硬拒绝。也可把 style_lint 返回的 lintPassToken 传给 accept。`);
        }
        let body = cand.body;
        let title;
        // Accept always lands as drafted: even reviewed chapters must re-review after body change.
        let status = "drafted";
        let existingFinal = false;
        try {
            const existing = await readChapter(dir, cand.chapterId);
            title = existing.title;
            if (existing.status === "final") {
                existingFinal = true;
                // 只认严格 true：Boolean("false") 也会是真，不能成为覆盖定稿的后门。
                if (opts.force !== true) {
                    throw new ZhizhangError("refuse_overwrite_final", `章节 ${cand.chapterId} 已是 final，拒绝用候选取代。确需改稿请传 force=true（采纳后状态降为 drafted，需重新审校定稿）。`);
                }
            }
            if (mode === "append")
                body = `${existing.body.trimEnd()}\n\n${cand.body}`;
        }
        catch (err) {
            // 只允许「章文件尚不存在」走新建路径；front matter 损坏必须停下，
            // 否则这次 accept 会把读不出的原稿直接覆盖掉。
            if (!isMissingFileError(err))
                throw err;
            title = cand.chapterId;
        }
        const saved = await saveChapter(dir, {
            id: cand.chapterId,
            title: title ?? cand.chapterId,
            body,
            status,
        });
        const acceptedAt = nowIso();
        const diskMeta = candidateToDiskMeta({
            ...cand,
            acceptedAt,
            acceptedMode: mode,
        });
        await atomicWrite(path.join(candidatesDir(dir), `${id}.json`), JSON.stringify(diskMeta, null, 2) + "\n");
        await appendLedger(dir, {
            chapterId: cand.chapterId,
            kind: "note",
            summary: existingFinal
                ? `强制采纳候选 ${id}（${mode}，原 final→drafted）→ 本地草稿，未定稿`
                : `采纳候选 ${id}（${mode}）→ 本地草稿，未定稿`,
        });
        return saved;
    });
}
export async function listCandidates(dir: string) {
    let names;
    try {
        names = await readdir(candidatesDir(dir));
    }
    catch {
        return [];
    }
    const rows = [];
    for (const name of names) {
        if (!name.endsWith(".json"))
            continue;
        try {
            // mtime 缓存：面板每轮轮询都全量列候选，未变的候选不必重读。
            const raw = await readJsonCached(path.join(candidatesDir(dir), name));
            // wordCount is persisted at stage time; only legacy rows re-read the body.
            let wordCount = typeof raw.wordCount === "number" ? raw.wordCount : 0;
            if (typeof raw.wordCount !== "number") {
                try {
                    const bodyFile = typeof raw.bodyFile === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(raw.bodyFile)
                        ? raw.bodyFile
                        : null;
                    if (bodyFile) {
                        const body = await readFile(path.join(candidatesDir(dir), bodyFile), "utf8");
                        wordCount = countWords(body);
                    }
                }
                catch {
                    /* missing body file */
                }
            }
            rows.push({
                ...raw,
                wordCount,
                pending: !raw.acceptedAt,
            });
        }
        catch {
            /* skip broken */
        }
    }
    rows.sort((a: any, b: any) => (a.stagedAt < b.stagedAt ? 1 : -1));
    return rows;
}
// —— § brief crumbs ——
export async function readBriefCrumbs(dir: string) {
    try {
        const raw = await readFile(briefCrumbsPath(dir), "utf8");
        const data = JSON.parse(raw);
        data.entries = Array.isArray(data.entries) ? data.entries : [];
        return data;
    }
    catch {
        const meta = await readWorkMeta(dir);
        return { schemaVersion: SCHEMA_VERSION, workKey: meta.key, entries: [] };
    }
}
export async function recordBriefBreadcrumb(dir: string, input: any) {
    return withLock(`${dir}:briefs`, async () => {
        const file = await readBriefCrumbs(dir);
        const crumb = {
            chapterId: input.chapterId,
            at: nowIso(),
            assetIds: [...input.assetIds],
        };
        file.entries.push(crumb);
        if (file.entries.length > 200)
            file.entries = file.entries.slice(-200);
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
        if (now - at <= maxAgeMs)
            return e;
        return null;
    }
    return null;
}
// —— § payoff audits ——
export async function readPayoffAudits(dir: string) {
    try {
        const raw = await readFile(payoffAuditsPath(dir), "utf8");
        const data = JSON.parse(raw);
        data.entries = Array.isArray(data.entries) ? data.entries : [];
        return data;
    }
    catch {
        const meta = await readWorkMeta(dir);
        return { schemaVersion: SCHEMA_VERSION, workKey: meta.key, entries: [] };
    }
}
export async function storePayoffAudit(dir: string, entry: any) {
    return withLock(`${dir}:payoff`, async () => {
        const file = await readPayoffAudits(dir);
        const full = {
            ...entry,
            at: entry.at ?? nowIso(),
        };
        file.entries.push(full);
        if (file.entries.length > 100)
            file.entries = file.entries.slice(-100);
        await atomicWrite(payoffAuditsPath(dir), JSON.stringify(file, null, 2) + "\n");
        await appendLedger(dir, {
            chapterId: entry.chapterId,
            kind: "payoff_audit",
            summary: full.summary,
        });
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
        if (now - at <= maxAgeMs)
            return e;
        return null;
    }
    return null;
}
function pathsFromWorkDir(dir: string) {
    const works = path.dirname(dir);
    const base = path.dirname(works);
    return {
        base,
        works,
        manuscripts: path.join(base, "manuscripts"),
        library: path.join(base, "library"),
        inspiration: path.join(base, "inspiration"),
        sourceRoot: "",
    };
}
// —— § panel snapshot ——
/** Display-only clip: snapshot/lens fields carry working text, not source of truth. */
function capText(s: any, n: number) {
    const t = String(s ?? "");
    if (t.length <= n)
        return t;
    return `${Array.from(t).slice(0, n).join("")}…`;
}
/**
 * Lens-only chapter rows for /inspiration — skips ledger/candidates/briefs/payoffs
 * and the library+inspiration views a full buildPanelSnapshot would compute.
 */
export async function listChapterLensRows(dir: string) {
    const meta = await readWorkMeta(dir);
    const rows = [];
    for (const ch of [...meta.chapters].sort((a: any, b: any) => a.position - b.position)) {
        let situationLens = "";
        let livedScene = "";
        let stateLens = "";
        try {
            const lens = await readChapterLens(dir, ch.id);
            situationLens = lens.situationLens;
            livedScene = lens.livedScene;
            stateLens = lens.stateLens;
        }
        catch {
            /* index-only */
        }
        rows.push({
            id: ch.id,
            title: ch.title,
            position: ch.position,
            status: ch.status,
            wordCount: ch.wordCount,
            situationLens,
            livedScene,
            stateLens,
        });
    }
    return rows;
}
export async function buildPanelSnapshot(dir: string, pathsHint: any, opts: any = {}) {
    const paths = pathsHint ?? pathsFromWorkDir(dir);
    const { buildLibraryView, buildInspirationView, buildProductView, } = await import("./panel-enrich.js");
    const hintsOnly = opts.hintsOnly === true;
    const meta = await readWorkMeta(dir);
    // hintsOnly 只服务 chapter_brief.full 的 nextHints：不读 ledger，也不构建
    // library / inspiration / HTML——那些是面板用的重活。
    const ledger = hintsOnly ? { entries: [] } : await readLedger(dir);
    const cands = await listCandidates(dir);
    const briefs = await readBriefCrumbs(dir);
    const payoffs = await readPayoffAudits(dir);
    const lastPayoffByChapter: Record<string, any> = {};
    for (const e of payoffs.entries) {
        lastPayoffByChapter[e.chapterId] = e;
    }
    const now = Date.now();
    const recentBriefChapterIds = new Set();
    for (const e of briefs.entries) {
        const at = Date.parse(e.at);
        if (Number.isFinite(at) && now - at <= BRIEF_RECENT_MS)
            recentBriefChapterIds.add(e.chapterId);
    }
    let words = 0;
    let final = 0;
    let drafted = 0;
    let planned = 0;
    const chapters = [];
    for (const ch of [...meta.chapters].sort((a: any, b: any) => a.position - b.position)) {
        words += ch.wordCount;
        if (ch.status === "final")
            final += 1;
        else if (ch.status === "planned")
            planned += 1;
        else
            drafted += 1;
        let situationLens = "";
        let livedScene = "";
        let stateLens = "";
        try {
            const lens = await readChapterLens(dir, ch.id);
            situationLens = capText(lens.situationLens, 400);
            livedScene = capText(lens.livedScene, 400);
            stateLens = capText(lens.stateLens, 400);
        }
        catch {
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
    const pendingCands = cands.filter((c: any) => c.pending);
    const pending = pendingCands.length;
    const { isMultiDraftEnabled } = await import("./ports/multi-draft.js");
    const multiDraftEnabledEarly = isMultiDraftEnabled();
    const nextHints = [
        ...Scheduler.panelRouteHints(),
        "accept 硬闸：须 lintPassToken（仅证明已扫过）+ 近期 chapter_brief（可用 skip_brief 跳过）",
        "lint 命中>0 软警告 lint_hits_present；扫过≠过关。strict_lint / require_payoff / strict_human 可选硬拒",
        "chapter_save 大正文须 confirm_bypass；定稿：review_ledger + chapter_save status=final",
    ];
    if (pending > 0)
        nextHints.unshift(`有 ${pending} 条待采纳候选，可在面板点「采纳」或用 zhizhang_candidate_accept`);
    if (pendingCands.some((c: any) => c.editOf)) {
        nextHints.unshift("有编辑稿待定：面板可正式采纳（路径 A 须确认）；A/B/C 抉择用 zhizhang_candidate_edit_decide");
    }
    if (multiDraftEnabledEarly && pending >= 2) {
        nextHints.unshift("多草稿已开启：同章≥2 待采纳可用面板「统一整理」或 unify_brief → unify_stage");
    }
    else if (!multiDraftEnabledEarly && pending >= 2) {
        nextHints.unshift("同章多份待采纳：开启 multiDraft 后可统一整理（默认关，不进主链）");
    }
    if (chapters.some((c: any) => !c.situationLens))
        nextHints.unshift("部分章节缺 situationLens，建议 zhizhang_outline_set");
    if (chapters.some((c: any) => c.wordCount > 0 && !c.briefRecent)) {
        nextHints.unshift("有章节正文但无近期 chapter_brief 留痕（accept 将硬拒 unless skip_brief）");
    }
    const payoffWarn = Object.values(lastPayoffByChapter).filter((p: any) => !p.ok);
    if (payoffWarn.length > 0) {
        nextHints.unshift(`兑付审计有 ${payoffWarn.length} 章未过：${payoffWarn.map((p: any) => p.chapterId).join("、")}`);
    }
    if (hintsOnly)
        return { nextHints };
    // Export only the last 12 chapters' payoffs; hints above already used the full map.
    const lastPayoffCapped: Record<string, any> = {};
    for (const ch of meta.chapters) {
        if (lastPayoffByChapter[ch.id])
            lastPayoffCapped[ch.id] = lastPayoffByChapter[ch.id];
    }
    const payoffKeys = Object.keys(lastPayoffCapped);
    for (const k of payoffKeys.slice(0, Math.max(0, payoffKeys.length - 12)))
        delete lastPayoffCapped[k];
    const recentBriefs = briefs.entries.filter((e: any) => {
        const at = Date.parse(e.at);
        return Number.isFinite(at) && now - at <= BRIEF_RECENT_MS;
    });
    const product = buildProductView();
    let library;
    let inspiration;
    try {
        library = await buildLibraryView(paths);
    }
    catch {
        library = {
            sourcesCount: 0,
            sourceRoot: paths.sourceRoot,
            pendingCount: 0,
            pending: [],
            sources: [],
            craftCount: 0,
            mindCount: 0,
            acceptedCount: 0,
            draftedCount: 0,
            combo: null,
            summary: "拆书库暂不可读",
        };
    }
    try {
        inspiration = await buildInspirationView(paths, {
            workKey: meta.key,
            foundation: meta.foundation,
            chapters,
        });
    }
    catch {
        inspiration = {
            sessionsCount: 0,
            sessions: [],
            pendingEmits: 0,
            acceptedEmits: 0,
            appliedToWork: false,
            appliedCandIds: [],
            foundationFilled: false,
            foundationFilledFields: [],
            outlineProgress: {
                total: chapters.length,
                withSituation: 0,
                withLived: 0,
                withState: 0,
                complete: 0,
            },
            summary: "灵感支柱暂不可读",
        };
    }
    const candidateRows = [...pendingCands, ...cands.filter((c: any) => !c.pending).slice(-20)].map((c: any) => ({
        id: c.id,
        chapterId: c.chapterId,
        stagedAt: c.stagedAt,
        pending: c.pending,
        wordCount: c.wordCount,
        note: c.note,
        editOf: c.editOf,
        editMode: c.editMode,
        draftLabel: c.draftLabel,
        variantGroup: c.variantGroup,
        unifyOf: c.unifyOf,
        hasLintPass: Boolean(c.lintPassToken && c.lintedAt),
        lintHitCount: c.lintHitCount ?? 0,
        source: c.source,
    }));
    const multiDraftEnabled = multiDraftEnabledEarly;
    const foundationView = {
        locks: capText(meta.foundation.locks, 600),
        happened: capText(meta.foundation.happened, 600),
        threads: capText(meta.foundation.threads, 600),
        style: capText(meta.foundation.style, 600),
    };
    const htmlInput = {
        workKey: meta.key,
        title: meta.title,
        genre: meta.genre,
        totals: { chapters: chapters.length, words, final, drafted, planned },
        foundation: foundationView,
        chapters,
        candidates: candidateRows,
        ledgerRecent: ledger.entries.slice(-12).map((e: any) => ({
            id: e.id,
            at: e.at,
            kind: e.kind,
            chapterId: e.chapterId,
            summary: e.summary,
        })),
        briefCrumbsRecent: recentBriefs.slice(-12),
        lastPayoffByChapter: lastPayoffCapped,
        nextHints,
        product,
        library,
        inspiration,
    };
    // HTML is only for embedding / snapshot tool output; the Web panel polls JSON and
    // never reads this field, so HTTP passes includeHtml:false to keep polling cheap.
    const html = opts.includeHtml === false ? "" : renderPanelHtml(htmlInput);
    return {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: nowIso(),
        workKey: meta.key,
        title: meta.title,
        genre: meta.genre,
        dir,
        storageBase: paths.base,
        totals: { chapters: chapters.length, words, final, drafted, planned },
        foundation: foundationView,
        chapters,
        ledgerRecent: ledger.entries.slice(-12).map((e: any) => ({
            id: e.id,
            at: e.at,
            kind: e.kind,
            chapterId: e.chapterId,
            summary: e.summary,
            styleHitCount: e.styleHitCount,
        })),
        candidates: candidateRows,
        multiDraftEnabled,
        briefCrumbsRecent: recentBriefs.slice(-12),
        lastPayoffByChapter: lastPayoffCapped,
        nextHints,
        product,
        library,
        inspiration,
        html,
    };
}
// —— § assemble ——
export async function assembleManuscript(dir: string, paths: StoragePaths, opts: any = {}) {
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
        catch {
            continue;
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
    const out = assertInside(paths.base, path.resolve(paths.base, rel), "汇编输出");
    await mkdir(path.dirname(out), { recursive: true });
    await atomicWrite(out, parts.join("\n") + "\n");
    return { file: out, words, chapters: included };
}
export async function removeWorkDir(dir: string) {
    await rm(dir, { recursive: true, force: true });
}
