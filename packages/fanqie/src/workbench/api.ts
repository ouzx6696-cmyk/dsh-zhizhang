import { diagnose, stageRevisionCandidate, bodyHash } from "../engine/services/diagnostics.js";
import { buildPanelSnapshot, listChapterLensRows } from "../engine/panel-query.js";
import { access, readFile } from "node:fs/promises";
import type { StoragePaths, PluginConfig } from "../engine/types.js";
import path from "node:path";
import {
    assertResourceId,
    candidateHasLintPass,
    countWords,
    ensureStorage,
    getLastToolBase,
    listCandidates,
    listProjects,
    listWorks,
    loadLastToolBase,
    projectIdOf,
    readCandidate,
    readChapter,
    resolveWorkDir,
} from "../engine/work-store.js";
import { buildInspirationView, buildLibraryView, buildProductView } from "../engine/panel-enrich.js";
import { runPanelAccept } from "./accept.js";
import { updateChapter } from "../engine/storage/chapters.js";
import { withPortConfig } from "../engine/ports/config.js";
import { envMultiDraftFlag } from "../engine/ports/multi-draft.js";
import { readWorkMeta } from "../engine/work-store.js";
import { NovelError } from "../engine/errors.js";
import { MultiDraftPort } from "../engine/ports/multi-draft.js";
import { deliver, deliveryProblem, sessionFor } from "../../../core/src/sessions.js";
import { API, readJsonBody, writeJson, type RouteContext, type WorkbenchMode } from "../../../workbench/src/server.js";
import { chapterReviewInfo, finalizeProblem } from "../review.js";
import { buildDeliveryPrompt, DELIVERY_ACTIONS } from "./delivery.js";
/** Soft body cap for panel reads (~400 KiB). */
const PANEL_BODY_BYTE_CAP = 400 * 1024;
function capPanelBody(body: string) {
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
const WB_API_PREFIX = API;
export const FANQIE_ROUTES = [
    WB_API_PREFIX,
    `${WB_API_PREFIX}/health`,
    `${WB_API_PREFIX}/diagnostics/capabilities`,
    `${WB_API_PREFIX}/diagnostics/scan`,
    `${WB_API_PREFIX}/diagnostics/stage`,
    `${WB_API_PREFIX}/projects`,
    `${WB_API_PREFIX}/works`,
    `${WB_API_PREFIX}/snapshot`,
    `${WB_API_PREFIX}/library`,
    `${WB_API_PREFIX}/report`,
    `${WB_API_PREFIX}/inspiration`,
    `${WB_API_PREFIX}/chapter`,
    `${WB_API_PREFIX}/candidate`,
    `${WB_API_PREFIX}/candidate/accept`,
    `${WB_API_PREFIX}/chapter/review`,
    `${WB_API_PREFIX}/chapter/finalize`,
    `${WB_API_PREFIX}/revision/acknowledge`,
    `${WB_API_PREFIX}/unify/prepare`,
    `${WB_API_PREFIX}/agent/deliver`,
];

async function pathExists(p: any) {
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
 * Priority: config.storageRoot → env WRITER_NOVEL_ROOT → cwd/.writer if present → ensureStorage default.
 */
export async function resolveHttpPaths(config: PluginConfig) {
    if (config.storageRoot) {
        const paths = await ensureStorage(null, config);
        return { ...paths, resolvedVia: "config.storageRoot" };
    }
    const envRoot = (process.env.WRITER_NOVEL_ROOT ?? "").trim();
    if (envRoot) {
        const paths = await ensureStorage(null, {
            storageRoot: path.resolve(envRoot),
            libraryRoot: config.libraryRoot,
            worksRoot: config.worksRoot,
            sourceRoot: config.sourceRoot,
        });
        return { ...paths, resolvedVia: "env.WRITER_NOVEL_ROOT" };
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
            sourceRoot: config.sourceRoot,
        });
        return { ...paths, resolvedVia: "last-agent-tool" };
    }
    const cwdDot = path.resolve(process.cwd(), config.rootDir ?? ".writer");
    if (await pathExists(cwdDot)) {
        const paths = await ensureStorage(null, { storageRoot: cwdDot });
        return { ...paths, resolvedVia: "cwd/.writer" };
    }
    // Walk up a few parents for a .writer (session cwd often workspace root)
    let cur = process.cwd();
    for (let i = 0; i < 4; i++) {
        const candidate = path.join(cur, config.rootDir ?? ".writer");
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
/** Read-only unify brief pack — no disk writes. */
async function prepareUnifyBrief(paths: StoragePaths, opts: any) {
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
    let ids = (opts.candidateIds ?? []).map((x: any) => String(x).trim()).filter(Boolean);
    const chapterArg = String(opts.chapter ?? "").trim();
    if (ids.length === 0) {
        if (!chapterArg) {
            return { ok: false, enabled: true, code: "bad_args", error: "请传 chapter 或 candidateIds" };
        }
        const pending = (await listCandidates(dir)).filter((c: any) => c.pending && c.chapterId === chapterArg);
        ids = pending.map((c: any) => c.id);
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
        const views = parents.map((p: any) => MultiDraftPort.parentView(p));
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
            parents: views.map((v: any) => ({
                id: v.id,
                draftLabel: v.draftLabel,
                wordCount: v.wordCount,
            })),
        };
    }
    catch (err) {
        const code = err instanceof NovelError ? err.code : "unify_prepare_failed";
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
interface PanelPathsResult {
    paths?: StoragePaths;
    error?: string;
}

async function panelPaths(url: any, config: PluginConfig, baseOverride: any = ""): Promise<PanelPathsResult> {
    const requested = (baseOverride ||
        url.searchParams.get("base") ||
        url.searchParams.get("project") ||
        "").trim();
    if (!requested) {
        return { paths: await resolveHttpPaths(config) };
    }
    const want = projectIdOf(requested);
    const find = (list: any) => list.find((p: any) => p.id === want || projectIdOf(p.base) === want);
    let match = find(await listProjects());
    if (!match)
        match = find(await listProjects({ refresh: true }));
    if (!match || !match.exists)
        return { error: "bad_base" };
    const paths = await ensureStorage(null, {
        storageRoot: match.base,
        libraryRoot: config.libraryRoot,
        sourceRoot: config.sourceRoot,
        // 优先用该项目自己记录的作品目录；没记时再回退到全局配置，
        // 否则面板切到子项目会继续读写顶层项目的作品。
        worksRoot: match.worksRoot || config.worksRoot,
    });
    return { paths: { ...paths, resolvedVia: "panel:selected-project" } };
}
const UNHANDLED = Symbol("unhandled");
/** 番茄长篇模式的写作台接口 */
export function fanqieApi(config: PluginConfig = {}): WorkbenchMode {
    const route = async function fanqieRoute({ req, res, url, method, path: pathOnly }: RouteContext): Promise<unknown> {
        try {
            if (pathOnly === WB_API_PREFIX + "/diagnostics/capabilities") {
                if (method !== "GET") return writeJson(res, 405, { ok: false, code: "method", error: "GET required" });
                // 投递可用：宿主有会话控制服务，且该项目有过主会话
                const picked = await panelPaths(url, config);
                const problem = picked.error ? { code: "bad_base", message: "项目未登记" } : await deliveryProblem((picked.paths as StoragePaths).base);
                const target = picked.error ? undefined : await sessionFor((picked.paths as StoragePaths).base);
                return writeJson(res, 200, {
                    ok: true, quick: true, deep: false, reason: "模型深度调用尚未开放",
                    deliver: !problem,
                    deliverReason: problem?.message,
                    deliverActions: DELIVERY_ACTIONS,
                    target: target ? { at: target.at } : undefined,
                });
            }
            if (["/diagnostics/scan", "/diagnostics/stage"].some(p => pathOnly === WB_API_PREFIX + p)) {
                if (method !== "POST") return writeJson(res, 405, { ok: false, code: "method", error: "POST required" });
                const parsed = await readJsonBody(req, pathOnly.endsWith("/stage") ? 1024 * 1024 : 64000);
                if (parsed.err) return writeJson(res, parsed.err.status, parsed.err.payload);
                const input = parsed.parsed;
                const picked = await panelPaths(url, config, String(input.base ?? ""));
                if (picked.error) return writeJson(res, 400, { ok: false, code: "bad_base", error: "项目未登记" });
                try {
                    const dir = await resolveWorkDir(picked.paths as StoragePaths, input.work);
                    const result = pathOnly.endsWith("/stage") ? await stageRevisionCandidate(dir, input) : await diagnose(dir, input);
                    return writeJson(res, 200, { ok: true, ...result });
                } catch (err) {
                    const code = err instanceof NovelError ? err.code : "diagnostic_failed";
                    const status = code === "body_too_large" ? 413 : code.startsWith("bad_") || code === "too_many_paragraphs" ? 400 : err instanceof NovelError ? 409 : 500;
                    return writeJson(res, status, { ok: false, code, error: err instanceof Error ? err.message : String(err) });
                }
            }
            if (pathOnly === WB_API_PREFIX + "/agent/deliver") {
                if (method !== "POST") return writeJson(res, 405, { ok: false, code: "method", error: "POST required" });
                const body = await readJsonBody(req, 16_000);
                if (body.err) return writeJson(res, body.err.status, body.err.payload);
                const input = body.parsed;
                if (input.confirm !== true || typeof input.work !== "string" || typeof input.action !== "string")
                    return writeJson(res, 400, { ok: false, code: "confirmation_required", error: "须明确确认、作品与动作。" });
                const picked = await panelPaths(url, config, String(input.base ?? input.project ?? ""));
                if (picked.error) return writeJson(res, 400, { ok: false, code: "bad_base", error: "项目未登记" });
                const paths = picked.paths as StoragePaths;
                const problem = await deliveryProblem(paths.base);
                if (problem) return writeJson(res, problem.code === "no_session" ? 409 : 503, { ok: false, code: problem.code, error: problem.message });
                try {
                    const dir = await resolveWorkDir(paths, input.work);
                    const prompt = await buildDeliveryPrompt(dir, { action: input.action, chapter: typeof input.chapter === "string" ? input.chapter : undefined, note: typeof input.note === "string" ? input.note : undefined });
                    const sent = await deliver(paths.base, prompt.text, typeof input.requestId === "string" ? input.requestId : undefined);
                    return writeJson(res, 200, { ok: true, action: prompt.action, chapterId: prompt.chapterId, requestId: sent.requestId, text: prompt.text });
                } catch (err) {
                    const code = err instanceof NovelError ? err.code : (err as any)?.code ?? "deliver_failed";
                    return writeJson(res, err instanceof NovelError ? 400 : 502, { ok: false, code: String(code), error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) });
                }
            }
            if (["/chapter/review", "/chapter/finalize", "/revision/acknowledge"].some(route => pathOnly === WB_API_PREFIX + route)) {
                if (method !== "POST") return writeJson(res, 405, { ok: false, error: "POST required" });
                const body = await readJsonBody(req);
                if (body.err) return writeJson(res, body.err.status, body.err.payload);
                const input = body.parsed;
                if (input.confirm !== true || typeof input.work !== "string" || typeof input.chapter !== "string" || typeof input.expectedRevision !== "string")
                    return writeJson(res, 400, { ok: false, code: "confirmation_required", error: "须明确确认、作品、章节与实际已读版本。" });
                const picked = await panelPaths(url, config, String(input.base ?? input.project ?? ""));
                if (picked.error) return writeJson(res, 400, { ok: false, code: "bad_base", error: "项目未登记" });
                try {
                    const dir = await resolveWorkDir(picked.paths as StoragePaths, input.work);
                    if (pathOnly.endsWith("/finalize")) {
                        const current = await readChapter(dir, assertResourceId(input.chapter, "章节 id"));
                        const denied = await finalizeProblem(dir, current.id, current.body ?? "", config.requireEditorPass === true);
                        if (denied) return writeJson(res, 409, { ok: false, code: "writer_finalize_blocked", error: denied });
                    }
                    const chapter = await updateChapter(dir, { id: input.chapter, expectedRevision: input.expectedRevision,
                        status: pathOnly.endsWith("/review") ? "reviewed" : pathOnly.endsWith("/finalize") ? "final" : undefined,
                        reviewSummary: typeof input.summary === "string" ? input.summary : "作者在阅读面板声明已完整审读当前版本",
                        reviewResult: input.result === "blocked" ? "blocked" : "pass",
                        reviewedBy: "panel author", acknowledgeRevision: pathOnly.endsWith("/acknowledge"),
                    });
                    return writeJson(res, 200, { ok: true, chapterId: chapter.id, status: chapter.status });
                } catch (err) { return writeJson(res, 409, { ok: false, code: err instanceof NovelError ? err.code : "chapter_action_failed", error: err instanceof Error ? err.message : String(err) }); }
            }
            // —— POST candidate adoption ——
            if (pathOnly === `${WB_API_PREFIX}/candidate/accept`) {
                if (method !== "POST") {
                    return writeJson(res, 405, { ok: false, error: `method not allowed: ${method}` });
                }
                const body = await readJsonBody(req);
                if (body.err)
                    return writeJson(res, body.err.status, body.err.payload);
                const parsed = body.parsed;
                const modeRaw = parsed.mode ?? "replace";
                if (modeRaw !== "append" && modeRaw !== "replace") {
                    return writeJson(res, 400, { ok: false, code: "bad_mode", error: "mode 只支持 append / replace" });
                }
                const picked = await panelPaths(url, config, String(parsed.base ?? parsed.project ?? ""));
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths as StoragePaths;
                // Booleans are strict: only `true` enables, only `false` disables —
                // anything else is absent so AcceptPolicy falls back to PortConfig.
                const boolOrAbsent = (v: any) => (v === true ? true : v === false ? false : undefined);
                const acceptReq = {
                    work: String(parsed.work ?? parsed.workKey ?? ""),
                    candidate: String(parsed.candidate ?? parsed.candidateId ?? ""),
                    confirm: parsed.confirm === true,
                    expectedRevision: typeof parsed.expectedRevision === "string" ? parsed.expectedRevision : undefined,
                    mode: modeRaw,
                    force: parsed.force === true,
                    lintPassToken: typeof parsed.lintPassToken === "string"
                        ? parsed.lintPassToken
                        : typeof parsed.lint_pass_token === "string"
                            ? parsed.lint_pass_token
                            : undefined,
                    skipBrief: parsed.skipBrief === true || parsed.skip_brief === true,
                    strictLint: boolOrAbsent(parsed.strictLint) ?? boolOrAbsent(parsed.strict_lint),
                    requirePayoff: boolOrAbsent(parsed.requirePayoff) ?? boolOrAbsent(parsed.require_payoff),
                    strictHuman: boolOrAbsent(parsed.strictHuman) ?? boolOrAbsent(parsed.strict_human),
                    strictNovel: boolOrAbsent(parsed.strictNovel) ?? boolOrAbsent(parsed.strict_novel),
                    acceptAfterEdit: parsed.acceptAfterEdit === true || parsed.accept_after_edit === true,
                    confirmAcceptAfterEdit: parsed.confirmAcceptAfterEdit === true || parsed.confirm_accept_after_edit === true,
                };
                const result = await runPanelAccept(paths, acceptReq);
                if (!result.ok) {
                    const status = result.code === "recovery_required" || result.code === "recovery_conflict"
                        ? 409
                        : result.code === "confirm_required" ||
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
            if (pathOnly === `${WB_API_PREFIX}/unify/prepare`) {
                if (method !== "GET" && method !== "HEAD" && method !== "POST") {
                    return writeJson(res, 405, { ok: false, error: `method not allowed: ${method}` });
                }
                const paths0 = method === "POST" ? null : (await panelPaths(url, config));
                if (method !== "POST" && paths0?.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                let paths = paths0?.paths as StoragePaths;
                let work = "";
                let chapter = "";
                let candidateIds = [];
                if (method === "POST") {
                    const body = await readJsonBody(req);
                    if (body.err)
                        return writeJson(res, body.err.status, body.err.payload);
                    const parsed = body.parsed;
                    // A6: POST body base/project wins, same as accept.
                    const picked = await panelPaths(url, config, String(parsed.base ?? parsed.project ?? ""));
                    if (picked.error) {
                        return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                    }
                    paths = picked.paths as StoragePaths;
                    work = String(parsed.work ?? parsed.workKey ?? "");
                    chapter = String(parsed.chapter ?? parsed.chapterId ?? "");
                    if (Array.isArray(parsed.candidate_ids ?? parsed.candidateIds)) {
                        candidateIds = parsed.candidate_ids ?? parsed.candidateIds;
                    }
                }
                else {
                    work = (url.searchParams.get("work") ?? "").trim();
                    chapter = (url.searchParams.get("chapter") ?? "").trim();
                    const rawIds = url.searchParams.get("candidate_ids") ?? url.searchParams.get("ids") ?? "";
                    if (rawIds.trim()) {
                        candidateIds = rawIds.split(/[,\s]+/).map((s: any) => s.trim()).filter(Boolean);
                    }
                }
                const seenIds = new Set();
                candidateIds = candidateIds
                    .map((id: any) => String(id ?? "").trim())
                    .filter((id: string) => {
                    if (!id || seenIds.has(id))
                        return false;
                    seenIds.add(id);
                    return true;
                })
                    .slice(0, 8);
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
            if (pathOnly === `${WB_API_PREFIX}/health` || pathOnly === WB_API_PREFIX) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths as StoragePaths;
                const product = buildProductView();
                return writeJson(res, 200, {
                    ok: true,
                    plugin: "dsh-writer",
                    version: product.version,
                    toolCount: product.toolCount,
                    readOnlyGets: true,
                    acceptViaPost: true,
                    base: paths.base,
                    resolvedVia: paths.resolvedVia,
                    routes: FANQIE_ROUTES.map(route => /\/(?:scan|stage|accept|review|finalize|acknowledge|prepare|deliver)$/.test(route) ? `POST ${route}` : route),
                    multiDraftEnabled: MultiDraftPort.isEnabled(),
                });
            }
            if (pathOnly === `${WB_API_PREFIX}/projects`) {
                const paths = await resolveHttpPaths(config);
                const current = projectIdOf(paths.base);
                const known = await listProjects({ refresh: url.searchParams.get("refresh") === "1" });
                if (!known.some((p: any) => p.id === current)) {
                    known.unshift({
                        id: current,
                        base: paths.base,
                        worksRoot: paths.works,
                        name: "",
                        lastUsedAt: "",
                        exists: true,
                        works: [],
                        worksCount: 0,
                        chapters: 0,
                        words: 0,
                        recoveryPending: false,
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
            if (pathOnly === `${WB_API_PREFIX}/works`) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths as StoragePaths;
                const works = await listWorks(paths);
                return writeJson(res, 200, {
                    ok: true,
                    base: paths.base,
                    resolvedVia: paths.resolvedVia,
                    works: works.map((w: any) => ({
                        key: w.key,
                        title: w.title,
                        genre: w.genre,
                        chapters: w.recoveryPending ? null : w.chapters.length,
                        words: w.recoveryPending ? null : w.chapters.reduce((s: string, c: any) => s + (c.wordCount || 0), 0),
                        recoveryPending: w.recoveryPending === true,
                        updatedAt: w.updatedAt,
                    })),
                });
            }
            if (pathOnly === `${WB_API_PREFIX}/library`) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths as StoragePaths;
                const library = await buildLibraryView(paths);
                return writeJson(res, 200, {
                    ok: true,
                    base: paths.base,
                    library,
                    product: buildProductView(),
                });
            }
            if (pathOnly === `${WB_API_PREFIX}/report`) {
                const source = String(url.searchParams.get("source") ?? "").trim();
                if (!/^src-[A-Za-z0-9_-]{1,64}$/.test(source)) {
                    return writeJson(res, 400, { ok: false, code: "bad_id", error: "source 非法" });
                }
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const reportPath = path.join((picked.paths as StoragePaths).library, "analyses", source, "report.md");
                try {
                    const report = await readFile(reportPath, "utf8");
                    return writeJson(res, 200, { ok: true, source, report });
                }
                catch {
                    return writeJson(res, 404, { ok: false, code: "report_not_found", error: "报告未生成（先跑 fanqie_library_report）" });
                }
            }
            if (pathOnly === `${WB_API_PREFIX}/inspiration`) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths as StoragePaths;
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
                let chapters: any[] = [];
                if (workKey) {
                    try {
                        const dir = await resolveWorkDir(paths, workKey);
                        const meta = await readWorkMeta(dir);
                        foundation = meta.foundation;
                        // Lens-only rows; a full buildPanelSnapshot would also build the
                        // library+inspiration views that this route then rebuilds itself.
                        const rows = await listChapterLensRows(dir);
                        chapters = rows.map((c: any) => ({
                            situationLens: c.situationLens,
                            livedScene: c.livedScene,
                            stateLens: c.stateLens,
                        }));
                    }
                    catch (err) {
                        // An unreadable work or pending recovery is not an empty foundation.
                        throw err;
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
            if (pathOnly === `${WB_API_PREFIX}/snapshot`) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths as StoragePaths;
                const scope = url.searchParams.get("scope") === "work" ? "work" : "all";
                const works = await listWorks(paths);
                let workKey = (url.searchParams.get("work") ?? "").trim();
                if (!workKey) {
                    if (works.length === 0) {
                        const library = scope === "all" ? await buildLibraryView(paths).catch((err: any) => ({ unavailable: true, recoveryPending: err?.code === "library_recovery_required", summary: err instanceof Error ? err.message : "拆书库暂不可读" })) : undefined;
                        return writeJson(res, 200, {
                            ok: true,
                            empty: true,
                            message: library && "unavailable" in library ? library.summary : "还没有作品。先用 fanqie_project_create 创建。",
                            works: [],
                            projectId: projectIdOf(paths.base),
                            base: paths.base,
                            resolvedVia: paths.resolvedVia,
                            product: buildProductView(),
                            ...(library ? {library} : {}),
                        });
                    }
                    if (works.length > 1) {
                        return writeJson(res, 200, {
                            ok: true,
                            needWork: true,
                            message: "请选择作品",
                            works: works.map((w: any) => ({ key: w.key, title: w.title, recoveryPending: w.recoveryPending === true })),
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
                const rest = await buildPanelSnapshot(dir, paths, { scope });
                return writeJson(res, 200, {
                    ok: true,
                    empty: false,
                    snapshot: rest,
                    multiDraftEnabled: rest.multiDraftEnabled,
                    works: works.map((w: any) => ({ key: w.key, title: w.title, recoveryPending: w.recoveryPending === true })),
                    projectId: projectIdOf(paths.base),
                    base: paths.base,
                    resolvedVia: paths.resolvedVia,
                });
            }
            if (pathOnly === `${WB_API_PREFIX}/chapter`) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths as StoragePaths;
                const workKey = (url.searchParams.get("work") ?? "").trim();
                let chapterId = (url.searchParams.get("id") ?? url.searchParams.get("chapter") ?? "").trim();
                if (!workKey) {
                    return writeJson(res, 400, { ok: false, code: "work_required", error: "缺少 work" });
                }
                if (!chapterId) {
                    return writeJson(res, 400, { ok: false, code: "id_required", error: "缺少章节 id" });
                }
                try {
                    chapterId = assertResourceId(chapterId, "章节 id");
                }
                catch (err) {
                    const code = err instanceof NovelError ? err.code : "bad_id";
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
                    let writer: Record<string, unknown> | undefined;
                    try {
                        writer = await chapterReviewInfo(dir, rec.id, rec.body ?? "", config.requireEditorPass === true);
                    }
                    catch {
                        writer = undefined;
                    }
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
                            revision: rec.revision,
                            bodyHash: bodyHash(rec.body),
                            review: rec.review,
                            dependencies: rec.dependencies,
                        },
                        outline: rec.outline,
                        body: capped.body,
                        truncated: capped.truncated,
                        bodyBytes: capped.bodyBytes,
                        ...(writer ? { writer } : {}),
                    });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const missing = (err as any)?.code === "ENOENT" ||
                        /ENOENT|no such file|不存在/i.test(msg);
                    const recovering = err instanceof NovelError && err.code === "recovery_required";
                    return writeJson(res, recovering ? 409 : missing ? 404 : 500, {
                        ok: false,
                        code: recovering ? "recovery_required" : missing ? "chapter_not_found" : "chapter_read_failed",
                        error: missing ? `章节不存在：${chapterId}` : msg.slice(0, 200),
                    });
                }
            }
            if (pathOnly === `${WB_API_PREFIX}/candidate`) {
                const picked = await panelPaths(url, config);
                if (picked.error) {
                    return writeJson(res, 400, { ok: false, code: "bad_base", error: "未登记的项目（base 不在项目索引里）" });
                }
                const paths = picked.paths as StoragePaths;
                const workKey = (url.searchParams.get("work") ?? "").trim();
                let candidateId = (url.searchParams.get("id") ?? url.searchParams.get("candidate") ?? "").trim();
                if (!workKey) {
                    return writeJson(res, 400, { ok: false, code: "work_required", error: "缺少 work" });
                }
                if (!candidateId) {
                    return writeJson(res, 400, { ok: false, code: "id_required", error: "缺少候选 id" });
                }
                try {
                    candidateId = assertResourceId(candidateId, "候选 id");
                }
                catch (err) {
                    const code = err instanceof NovelError ? err.code : "bad_id";
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
                            bodyHash: bodyHash(cand.body),
                            targetRevision: cand.targetRevision,
                            chapterId: cand.chapterId,
                            stagedAt: cand.stagedAt,
                            source: cand.source,
                            note: cand.note ?? "",
                            acceptedAt: cand.acceptedAt ?? null,
                            hasLintPass: candidateHasLintPass(cand),
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
                    const missing = (err as any)?.code === "ENOENT" ||
                        /ENOENT|no such file|不存在/i.test(msg);
                    const recovering = err instanceof NovelError && err.code === "recovery_required";
                    return writeJson(res, recovering ? 409 : missing ? 404 : 500, {
                        ok: false,
                        code: recovering ? "recovery_required" : missing ? "candidate_not_found" : "candidate_read_failed",
                        error: missing ? `候选不存在：${candidateId}` : msg.slice(0, 200),
                    });
                }
            }
            return UNHANDLED;
        }
        catch (err) {
            const recovering = err instanceof NovelError && (err.code === "recovery_required" || err.code === "library_recovery_required");
            return writeJson(res, recovering ? 409 : 500, {
                ok: false,
                ...(recovering ? { code: (err as NovelError).code } : {}),
                error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
            });
        }
    };
    const policy = () => ({ multiDraftEnabled: config.multiDraftEnabled === true || config.multiDraft?.enabled === true || envMultiDraftFlag() });
    return {
        routes: FANQIE_ROUTES,
        async handle(ctx) {
            if (!FANQIE_ROUTES.includes(ctx.path)) return false;
            return (await withPortConfig(policy(), () => route(ctx))) !== UNHANDLED;
        },
    };
}
