// @ts-nocheck
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { assertResourceId, buildPanelSnapshot, countWords, ensureStorage, getLastToolBase, listCandidates, listProjects, listWorks, loadLastToolBase, projectIdOf, readCandidate, readChapter, resolveWorkDir, } from "./store.js";
import { buildInspirationView, buildLibraryView, buildProductView } from "./panel-enrich.js";
import { runPanelAccept } from "./panel-accept.js";
import { readWorkMeta } from "./store.js";
import { ZhizhangError } from "./errors.js";
import { MultiDraftPort } from "./ports/multi-draft.js";
/** Soft body cap for panel reads (~400 KiB). */
export const PANEL_BODY_BYTE_CAP = 400 * 1024;
/** Safe chapter / candidate id: no path segments, no traversal (delegates to the store). */
export function assertSafeResourceId(id, label) {
    return assertResourceId(id, label);
}
export function capPanelBody(body) {
    const raw = typeof body === "string" ? body : "";
    const buf = Buffer.from(raw, "utf8");
    if (buf.length <= PANEL_BODY_BYTE_CAP) {
        return { body: raw, truncated: false, bodyBytes: buf.length };
    }
    let cut = PANEL_BODY_BYTE_CAP;
    while (cut > 0 && (buf[cut] & 0xc0) === 0x80)
        cut -= 1;
    return {
        body: buf.subarray(0, cut).toString("utf8") + "\n\n…（正文已截断，约 400KB 上限）",
        truncated: true,
        bodyBytes: buf.length,
    };
}
export const ZZ_API_PREFIX = "/api/dsh-zhizhang";
function writeJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
    });
    res.end(payload);
}
function isLoopback(req) {
    const ra = req.socket?.remoteAddress ?? "";
    return ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
}
function isAllowed(req, allowLan) {
    if (isLoopback(req))
        return true;
    if (!allowLan)
        return false;
    const host = req.headers?.host;
    if (typeof host !== "string")
        return false;
    const origin = req.headers?.origin;
    if (origin === undefined)
        return true;
    try {
        return new URL(origin).host === new URL(`http://${host}`).host;
    }
    catch {
        return false;
    }
}
function parseUrl(req) {
    return new URL(req.url ?? "/", "http://127.0.0.1");
}
async function pathExists(p) {
    try {
        await access(p);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Resolve storage root for HTTP (no agent session).
 * Priority: config.storageRoot → env DSH_ZHIZHANG_ROOT → cwd/.zhizhang if present → ensureStorage default.
 */
export async function resolveHttpPaths(config) {
    if (config.storageRoot) {
        const paths = await ensureStorage(null, config);
        return { ...paths, resolvedVia: "config.storageRoot" };
    }
    const envRoot = (process.env.DSH_ZHIZHANG_ROOT ?? "").trim();
    if (envRoot) {
        const paths = await ensureStorage(null, {
            storageRoot: path.resolve(envRoot),
            libraryRoot: config.libraryRoot,
            worksRoot: config.worksRoot,
        });
        return { ...paths, resolvedVia: "env.DSH_ZHIZHANG_ROOT" };
    }
    // Follow the workspace the Agent last wrote to (tools and HTTP share this process).
    // Without this the panel resolves process.cwd() — the DSH profile dir — and shows
    // an empty library while the Agent writes to the session workspace.
    const lastBase = getLastToolBase() || (await loadLastToolBase());
    if (lastBase && (await pathExists(lastBase))) {
        const paths = await ensureStorage(null, {
            storageRoot: lastBase,
            libraryRoot: config.libraryRoot,
            worksRoot: config.worksRoot,
        });
        return { ...paths, resolvedVia: "last-agent-tool" };
    }
    const cwdDot = path.resolve(process.cwd(), config.rootDir ?? ".zhizhang");
    if (await pathExists(cwdDot)) {
        const paths = await ensureStorage(null, { storageRoot: cwdDot });
        return { ...paths, resolvedVia: "cwd/.zhizhang" };
    }
    // Walk up a few parents for a .zhizhang (session cwd often workspace root)
    let cur = process.cwd();
    for (let i = 0; i < 4; i++) {
        const candidate = path.join(cur, config.rootDir ?? ".zhizhang");
        if (await pathExists(candidate)) {
            const paths = await ensureStorage(null, { storageRoot: candidate });
            return { ...paths, resolvedVia: `walk:${candidate}` };
        }
        const parent = path.dirname(cur);
        if (parent === cur)
            break;
        cur = parent;
    }
    const paths = await ensureStorage(null, config);
    return { ...paths, resolvedVia: "ensureStorage(cwd)" };
}
function readBody(req, limit = 64_000) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (c) => {
            size += c.length;
            if (size > limit) {
                reject(new Error("body too large"));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}
/** Read-only unify brief pack — no disk writes. */
export async function prepareUnifyBrief(paths, opts) {
    if (!MultiDraftPort.isEnabled()) {
        return {
            ok: false,
            enabled: false,
            code: MultiDraftPort.disabledCode,
            error: `多草稿统一整理未开启。${MultiDraftPort.enableHint()}`,
        };
    }
    const work = String(opts.work ?? "").trim();
    if (!work) {
        return { ok: false, enabled: true, code: "bad_args", error: "work 必填" };
    }
    let dir;
    try {
        dir = await resolveWorkDir(paths, work);
    }
    catch (err) {
        return {
            ok: false,
            enabled: true,
            code: "work_not_found",
            error: err instanceof Error ? err.message : String(err),
        };
    }
    let ids = (opts.candidateIds ?? []).map((x) => String(x).trim()).filter(Boolean);
    const chapterArg = String(opts.chapter ?? "").trim();
    if (ids.length === 0) {
        if (!chapterArg) {
            return { ok: false, enabled: true, code: "bad_args", error: "请传 chapter 或 candidateIds" };
        }
        const pending = (await listCandidates(dir)).filter((c) => c.pending && c.chapterId === chapterArg);
        ids = pending.map((c) => c.id);
    }
    if (ids.length < 2) {
        return {
            ok: false,
            enabled: true,
            code: "unify_need_two",
            error: `统一整理至少 2 条待采纳，当前 ${ids.length}`,
        };
    }
    try {
        const parents = [];
        for (const id of ids) {
            const cand = await readCandidate(dir, id);
            if (cand.acceptedAt) {
                return {
                    ok: false,
                    enabled: true,
                    code: "unify_parent_accepted",
                    error: `候选 ${id} 已采纳`,
                };
            }
            parents.push(cand);
        }
        const chapterId = parents[0].chapterId;
        for (const p of parents) {
            if (p.chapterId !== chapterId) {
                return {
                    ok: false,
                    enabled: true,
                    code: "unify_chapter_mismatch",
                    error: "父候选必须同章",
                };
            }
        }
        if (chapterArg && chapterArg !== chapterId) {
            return {
                ok: false,
                enabled: true,
                code: "unify_chapter_mismatch",
                error: `chapter=${chapterArg} 与候选章 ${chapterId} 不一致`,
            };
        }
        const views = parents.map((p) => MultiDraftPort.parentView(p));
        const brief = MultiDraftPort.formatUnifyBrief({
            chapterId,
            workKey: work,
            parents: views,
        });
        return {
            ok: true,
            enabled: true,
            chapterId,
            candidateIds: ids,
            brief,
            parents: views.map((v) => ({
                id: v.id,
                draftLabel: v.draftLabel,
                wordCount: v.wordCount,
            })),
        };
    }
    catch (err) {
        const code = err instanceof ZhizhangError ? err.code : "unify_prepare_failed";
        return {
            ok: false,
            enabled: true,
            code,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
/**
 * Resolve the panel's project selector (`?base=` / `?project=`, or a POST body field)
 * against the known-workspace index. Only indexed, existing workspaces are readable —
 * the panel must never turn into an arbitrary file browser.
 */
async function panelPaths(url, config, baseOverride = "") {
    const requested = (baseOverride ||
        url.searchParams.get("base") ||
        url.searchParams.get("project") ||
        "").trim();
    if (!requested) {
        return { paths: await resolveHttpPaths(config) };
    }
    const want = projectIdOf(requested);
    const find = (list) => list.find((p) => p.id === want || projectIdOf(p.base) === want);
    let match = find(await listProjects());
    if (!match)
        match = find(await listProjects({ refresh: true }));
    if (!match || !match.exists)
        return { error: "bad_base" };
    const paths = await ensureStorage(null, {
        storageRoot: match.base,
        libraryRoot: config.libraryRoot,
        worksRoot: config.worksRoot,
    });
    return { paths: { ...paths, resolvedVia: "panel:selected-project" } };
}
export function createPanelApiHandler(config = {}) {
    const allowLan = config.allowLanPanel === true;
    return async function panelApiHandler(req, res) {
        try {
            if (!isAllowed(req, allowLan)) {
                return writeJson(res, 403, { ok: false, error: "forbidden: loopback-only" });
            }
            const method = (req.method ?? "GET").toUpperCase();
            const url = parseUrl(req);
            const pathOnly = url.pathname.replace(/\/+$/, "") || "/";
            // —— POST accept (only write path on this API) ——
            if (pathOnly === `${ZZ_API_PREFIX}/candidate/accept`) {
                if (method !== "POST") {
                    return writeJson(res, 405, { ok: false, error: `method not allowed: ${method}` });
                }
                let bodyRaw = "";
                try {
                    bodyRaw = await readBody(req);
                }
                catch (err) {
                    return writeJson(res, 413, {
                        ok: false,
                        code: "body_too_large",
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                let parsed = {};
                try {
                    parsed = bodyRaw ? JSON.parse(bodyRaw) : {};
                }
                catch {
                    return writeJson(res, 400, { ok: false, code: "bad_json", error: "请求体须为 JSON" });
                }
                const picked = await panelPaths(url, config, String(parsed.base ?? parsed.project ?? ""));
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths;
                const acceptReq = {
                    work: String(parsed.work ?? parsed.workKey ?? ""),
                    candidate: String(parsed.candidate ?? parsed.candidateId ?? ""),
                    confirm: Boolean(parsed.confirm),
                    mode: parsed.mode === "append" ? "append" : "replace",
                    force: Boolean(parsed.force),
                    lintPassToken: typeof parsed.lintPassToken === "string"
                        ? parsed.lintPassToken
                        : typeof parsed.lint_pass_token === "string"
                            ? parsed.lint_pass_token
                            : undefined,
                    skipBrief: Boolean(parsed.skipBrief ?? parsed.skip_brief),
                    strictLint: Boolean(parsed.strictLint ?? parsed.strict_lint),
                    requirePayoff: Boolean(parsed.requirePayoff ?? parsed.require_payoff),
                    strictHuman: Boolean(parsed.strictHuman ?? parsed.strict_human),
                    strictNovel: Boolean(parsed.strictNovel ?? parsed.strict_novel),
                    acceptAfterEdit: Boolean(parsed.acceptAfterEdit ?? parsed.accept_after_edit),
                    confirmAcceptAfterEdit: Boolean(parsed.confirmAcceptAfterEdit ?? parsed.confirm_accept_after_edit),
                };
                const result = await runPanelAccept(paths, acceptReq);
                if (!result.ok) {
                    const status = result.code === "confirm_required" ||
                        result.code === "edit_accept_confirm_required" ||
                        result.code === "bad_id"
                        ? 400
                        : result.code === "work_not_found" || result.code === "candidate_not_found"
                            ? 404
                            : 422;
                    return writeJson(res, status, result);
                }
                return writeJson(res, 200, result);
            }
            // —— unify/prepare (read-only brief; no disk write) ——
            if (pathOnly === `${ZZ_API_PREFIX}/unify/prepare`) {
                if (method !== "GET" && method !== "HEAD" && method !== "POST") {
                    return writeJson(res, 405, { ok: false, error: `method not allowed: ${method}` });
                }
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths;
                let work = "";
                let chapter = "";
                let candidateIds = [];
                if (method === "POST") {
                    let bodyRaw = "";
                    try {
                        bodyRaw = await readBody(req);
                    }
                    catch (err) {
                        return writeJson(res, 413, {
                            ok: false,
                            code: "body_too_large",
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                    let parsed = {};
                    try {
                        parsed = bodyRaw ? JSON.parse(bodyRaw) : {};
                    }
                    catch {
                        return writeJson(res, 400, { ok: false, code: "bad_json", error: "请求体须为 JSON" });
                    }
                    work = String(parsed.work ?? parsed.workKey ?? "");
                    chapter = String(parsed.chapter ?? parsed.chapterId ?? "");
                    if (Array.isArray(parsed.candidate_ids ?? parsed.candidateIds)) {
                        candidateIds = (parsed.candidate_ids ?? parsed.candidateIds);
                    }
                }
                else {
                    work = (url.searchParams.get("work") ?? "").trim();
                    chapter = (url.searchParams.get("chapter") ?? "").trim();
                    const rawIds = url.searchParams.get("candidate_ids") ?? url.searchParams.get("ids") ?? "";
                    if (rawIds.trim()) {
                        candidateIds = rawIds.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
                    }
                }
                const result = await prepareUnifyBrief(paths, { work, chapter, candidateIds });
                if (!result.ok) {
                    const status = result.code === MultiDraftPort.disabledCode
                        ? 400
                        : result.code === "work_not_found"
                            ? 404
                            : 422;
                    return writeJson(res, status, result);
                }
                return writeJson(res, 200, result);
            }
            if (method !== "GET" && method !== "HEAD") {
                return writeJson(res, 405, { ok: false, error: `method not allowed: ${method}` });
            }
            if (pathOnly === `${ZZ_API_PREFIX}/health` || pathOnly === ZZ_API_PREFIX) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths;
                return writeJson(res, 200, {
                    ok: true,
                    plugin: "dsh-zhizhang",
                    version: buildProductView().version,
                    toolCount: buildProductView().toolCount,
                    readOnlyGets: true,
                    acceptViaPost: true,
                    base: paths.base,
                    resolvedVia: paths.resolvedVia,
                    routes: [
                        `${ZZ_API_PREFIX}/health`,
                        `${ZZ_API_PREFIX}/projects`,
                        `${ZZ_API_PREFIX}/works`,
                        `${ZZ_API_PREFIX}/snapshot`,
                        `${ZZ_API_PREFIX}/library`,
                        `${ZZ_API_PREFIX}/inspiration`,
                        `${ZZ_API_PREFIX}/chapter`,
                        `${ZZ_API_PREFIX}/candidate`,
                        `${ZZ_API_PREFIX}/report`,
                        `POST ${ZZ_API_PREFIX}/candidate/accept`,
                        `${ZZ_API_PREFIX}/unify/prepare`,
                    ],
                    multiDraftEnabled: MultiDraftPort.isEnabled(),
                });
            }
            if (pathOnly === `${ZZ_API_PREFIX}/projects`) {
                const paths = await resolveHttpPaths(config);
                const current = projectIdOf(paths.base);
                const known = await listProjects({ refresh: url.searchParams.get("refresh") === "1" });
                if (!known.some((p) => p.id === current)) {
                    known.unshift({
                        id: current,
                        base: paths.base,
                        name: "",
                        lastUsedAt: "",
                        exists: true,
                        works: [],
                        worksCount: 0,
                        chapters: 0,
                        words: 0,
                    });
                }
                return writeJson(res, 200, {
                    ok: true,
                    base: paths.base,
                    resolvedVia: paths.resolvedVia,
                    current,
                    projects: known,
                });
            }
            if (pathOnly === `${ZZ_API_PREFIX}/works`) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths;
                const works = await listWorks(paths);
                return writeJson(res, 200, {
                    ok: true,
                    base: paths.base,
                    resolvedVia: paths.resolvedVia,
                    works: works.map((w) => ({
                        key: w.key,
                        title: w.title,
                        genre: w.genre,
                        chapters: w.chapters.length,
                        words: w.chapters.reduce((s, c) => s + (c.wordCount || 0), 0),
                        updatedAt: w.updatedAt,
                    })),
                });
            }
            if (pathOnly === `${ZZ_API_PREFIX}/library`) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths;
                const library = await buildLibraryView(paths);
                return writeJson(res, 200, {
                    ok: true,
                    base: paths.base,
                    library,
                    product: buildProductView(),
                });
            }
            if (pathOnly === `${ZZ_API_PREFIX}/report`) {
                const source = String(url.searchParams.get("source") ?? "").trim();
                if (!/^src-[A-Za-z0-9_-]{1,64}$/.test(source)) {
                    return writeJson(res, 400, { ok: false, code: "bad_id", error: "source 非法" });
                }
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const reportPath = path.join(picked.paths.library, "analyses", source, "report.md");
                try {
                    const report = await readFile(reportPath, "utf8");
                    return writeJson(res, 200, { ok: true, source, report });
                }
                catch {
                    return writeJson(res, 404, { ok: false, code: "report_not_found", error: "报告未生成（先跑 zhizhang_library_report）" });
                }
            }
            if (pathOnly === `${ZZ_API_PREFIX}/inspiration`) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths;
                let workKey = (url.searchParams.get("work") ?? "").trim();
                const works = await listWorks(paths);
                if (!workKey && works.length === 1)
                    workKey = works[0].key;
                let foundation = {
                    locks: "",
                    happened: "",
                    characters: "",
                    readerKnowledge: "",
                    planned: "",
                    threads: "",
                    style: "",
                };
                let chapters = [];
                if (workKey) {
                    try {
                        const dir = await resolveWorkDir(paths, workKey);
                        const meta = await readWorkMeta(dir);
                        foundation = meta.foundation;
                        const snap = await buildPanelSnapshot(dir, paths, { includeHtml: false });
                        chapters = snap.chapters.map((c) => ({
                            situationLens: c.situationLens,
                            livedScene: c.livedScene,
                            stateLens: c.stateLens,
                        }));
                    }
                    catch {
                        /* empty */
                    }
                }
                const inspiration = await buildInspirationView(paths, {
                    workKey: workKey || "",
                    foundation,
                    chapters,
                });
                return writeJson(res, 200, {
                    ok: true,
                    base: paths.base,
                    workKey: workKey || null,
                    inspiration,
                    product: buildProductView(),
                });
            }
            if (pathOnly === `${ZZ_API_PREFIX}/snapshot`) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths;
                const works = await listWorks(paths);
                let workKey = (url.searchParams.get("work") ?? "").trim();
                if (!workKey) {
                    if (works.length === 0) {
                        return writeJson(res, 200, {
                            ok: true,
                            empty: true,
                            message: "还没有作品。先用 zhizhang_project_create 创建。",
                            works: [],
                            projectId: projectIdOf(paths.base),
                            base: paths.base,
                            resolvedVia: paths.resolvedVia,
                            product: buildProductView(),
                            library: await buildLibraryView(paths).catch(() => null),
                        });
                    }
                    if (works.length > 1) {
                        return writeJson(res, 200, {
                            ok: true,
                            needWork: true,
                            message: "请选择作品",
                            works: works.map((w) => ({ key: w.key, title: w.title })),
                            projectId: projectIdOf(paths.base),
                            base: paths.base,
                            resolvedVia: paths.resolvedVia,
                            product: buildProductView(),
                        });
                    }
                    workKey = works[0].key;
                }
                let dir;
                try {
                    dir = await resolveWorkDir(paths, workKey);
                }
                catch (err) {
                    return writeJson(res, 404, {
                        ok: false,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                // HTML is opt-in (?html=1): the Web panel only consumes JSON and polls
                // every ~6s, so rendering the 15KB panel HTML per poll is wasted work.
                const includeHtml = url.searchParams.get("html") === "1";
                const snap = await buildPanelSnapshot(dir, paths, { includeHtml });
                const { html, ...rest } = snap;
                return writeJson(res, 200, {
                    ok: true,
                    empty: false,
                    snapshot: rest,
                    ...(includeHtml ? { html } : {}),
                    multiDraftEnabled: rest.multiDraftEnabled,
                    works: works.map((w) => ({ key: w.key, title: w.title })),
                    projectId: projectIdOf(paths.base),
                    base: paths.base,
                    resolvedVia: paths.resolvedVia,
                });
            }
            if (pathOnly === `${ZZ_API_PREFIX}/chapter`) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths;
                const workKey = (url.searchParams.get("work") ?? "").trim();
                let chapterId = (url.searchParams.get("id") ?? url.searchParams.get("chapter") ?? "").trim();
                if (!workKey) {
                    return writeJson(res, 400, { ok: false, code: "work_required", error: "缺少 work" });
                }
                if (!chapterId) {
                    return writeJson(res, 400, { ok: false, code: "id_required", error: "缺少章节 id" });
                }
                try {
                    chapterId = assertSafeResourceId(chapterId, "章节 id");
                }
                catch (err) {
                    const code = err instanceof ZhizhangError ? err.code : "bad_id";
                    return writeJson(res, 400, {
                        ok: false,
                        code,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                let dir;
                try {
                    dir = await resolveWorkDir(paths, workKey);
                }
                catch (err) {
                    return writeJson(res, 404, {
                        ok: false,
                        code: "work_not_found",
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                try {
                    const rec = await readChapter(dir, chapterId);
                    const capped = capPanelBody(rec.body ?? "");
                    return writeJson(res, 200, {
                        ok: true,
                        workKey,
                        meta: {
                            id: rec.id,
                            title: rec.title,
                            position: rec.position,
                            status: rec.status,
                            wordCount: rec.wordCount,
                            updatedAt: rec.updatedAt,
                        },
                        outline: rec.outline,
                        body: capped.body,
                        truncated: capped.truncated,
                        bodyBytes: capped.bodyBytes,
                    });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const missing = err?.code === "ENOENT" ||
                        /ENOENT|no such file|不存在/i.test(msg);
                    return writeJson(res, missing ? 404 : 500, {
                        ok: false,
                        code: missing ? "chapter_not_found" : "chapter_read_failed",
                        error: missing ? `章节不存在：${chapterId}` : msg.slice(0, 200),
                    });
                }
            }
            if (pathOnly === `${ZZ_API_PREFIX}/candidate`) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths;
                const workKey = (url.searchParams.get("work") ?? "").trim();
                let candidateId = (url.searchParams.get("id") ?? url.searchParams.get("candidate") ?? "").trim();
                if (!workKey) {
                    return writeJson(res, 400, { ok: false, code: "work_required", error: "缺少 work" });
                }
                if (!candidateId) {
                    return writeJson(res, 400, { ok: false, code: "id_required", error: "缺少候选 id" });
                }
                try {
                    candidateId = assertSafeResourceId(candidateId, "候选 id");
                }
                catch (err) {
                    const code = err instanceof ZhizhangError ? err.code : "bad_id";
                    return writeJson(res, 400, {
                        ok: false,
                        code,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                let dir;
                try {
                    dir = await resolveWorkDir(paths, workKey);
                }
                catch (err) {
                    return writeJson(res, 404, {
                        ok: false,
                        code: "work_not_found",
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                try {
                    const cand = await readCandidate(dir, candidateId);
                    const capped = capPanelBody(cand.body ?? "");
                    const wordCount = countWords(cand.body ?? "");
                    return writeJson(res, 200, {
                        ok: true,
                        workKey,
                        meta: {
                            id: cand.id,
                            chapterId: cand.chapterId,
                            stagedAt: cand.stagedAt,
                            source: cand.source,
                            note: cand.note ?? "",
                            acceptedAt: cand.acceptedAt ?? null,
                            hasLintPass: Boolean(cand.lintPassToken),
                            lintHitCount: cand.lintHitCount ?? null,
                            editOf: cand.editOf ?? null,
                            editMode: cand.editMode ?? null,
                            draftLabel: cand.draftLabel ?? null,
                            variantGroup: cand.variantGroup ?? null,
                            unifyOf: cand.unifyOf ?? null,
                            wordCount,
                        },
                        body: capped.body,
                        wordCount,
                        truncated: capped.truncated,
                        bodyBytes: capped.bodyBytes,
                        pending: !cand.acceptedAt,
                    });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const missing = err?.code === "ENOENT" ||
                        /ENOENT|no such file|不存在/i.test(msg);
                    return writeJson(res, missing ? 404 : 500, {
                        ok: false,
                        code: missing ? "candidate_not_found" : "candidate_read_failed",
                        error: missing ? `候选不存在：${candidateId}` : msg.slice(0, 200),
                    });
                }
            }
            return writeJson(res, 404, { ok: false, error: "not found" });
        }
        catch (err) {
            return writeJson(res, 500, {
                ok: false,
                error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
            });
        }
    };
}
/** Register routes on DSH webServer (optional; headless skips). */
export function registerPanelHttpRoutes(ctx, config) {
    const routeList = [
        ZZ_API_PREFIX,
        `${ZZ_API_PREFIX}/health`,
        `${ZZ_API_PREFIX}/projects`,
        `${ZZ_API_PREFIX}/works`,
        `${ZZ_API_PREFIX}/snapshot`,
        `${ZZ_API_PREFIX}/library`,
        `${ZZ_API_PREFIX}/report`,
        `${ZZ_API_PREFIX}/inspiration`,
        `${ZZ_API_PREFIX}/chapter`,
        `${ZZ_API_PREFIX}/candidate`,
        `${ZZ_API_PREFIX}/candidate/accept`,
        `${ZZ_API_PREFIX}/unify/prepare`,
    ];
    try {
        if (typeof ctx.inject === "function") {
            ctx.inject(["webServer"], (wctx) => {
                const handler = createPanelApiHandler(config);
                const run = () => {
                    const disposers = routeList.map((p) => wctx.webServer.register({ kind: "exact", path: p, handler }));
                    return () => {
                        for (const d of disposers) {
                            if (typeof d === "function")
                                d();
                        }
                    };
                };
                if (typeof wctx.effect === "function") {
                    wctx.effect(run, "dsh-zhizhang: panel api");
                }
                else if (typeof ctx.effect === "function") {
                    ctx.effect(run, "dsh-zhizhang: panel api");
                }
                else {
                    run();
                }
            });
            return true;
        }
        const web = ctx.get?.("webServer");
        if (web && typeof web.register === "function") {
            const handler = createPanelApiHandler(config);
            for (const p of routeList) {
                web.register({ kind: "exact", path: p, handler });
            }
            return true;
        }
    }
    catch {
        /* non-cordis / no webServer — tools still work */
    }
    return false;
}
