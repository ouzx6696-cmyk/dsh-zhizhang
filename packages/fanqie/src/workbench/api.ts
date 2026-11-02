import path from "node:path";
import { readText } from "../../../core/src/fsx.js";
import {
  API,
  ROUTES,
  sendError,
  type RouteContext,
  type WorkbenchMode,
} from "../../../workbench/src/routes.js";
import type { StoragePaths, PluginConfig } from "../engine/types.js";
import { NovelError } from "../engine/errors.js";
import { asString, asStringArray, boolArg } from "../engine/parse.js";
import { assertResourceId, assertSourceId } from "../engine/storage/primitives.js";
import {
  candidateHasLintPass,
  countWords,
  listProjects,
  listWorks,
  projectIdOf,
  readCandidate,
  readChapter,
  readWorkMeta,
  resolveWorkDir,
  stageCandidate,
} from "../engine/work-store.js";
import { diagnose, stageRevisionCandidate, bodyHash } from "../engine/services/diagnostics.js";
import { buildPanelSnapshot, listChapterLensRows } from "../engine/panel-query.js";
import {
  buildInspirationView,
  buildLibraryView,
  buildProductView,
} from "../engine/panel-enrich.js";
import { updateChapter } from "../engine/storage/chapters.js";
import { withPortConfig } from "../engine/ports/config.js";
import { MultiDraftPort } from "../engine/ports/multi-draft.js";
import { chapterReviewInfo, finalizeProblem } from "../review.js";
import { DELIVERY_ACTIONS } from "./delivery.js";
import { runPanelAccept } from "./accept.js";
import { panelPaths, resolveHttpPaths } from "./paths.js";
import { prepareUnifyBrief } from "./unify.js";

type RouteHandler = (ctx: RouteContext) => Promise<unknown>;
type ProjectRequest = { ctx: RouteContext; input: Record<string, unknown>; paths: StoragePaths };
type WorkRequest = ProjectRequest & { workKey: string; dir: string };
const PANEL_BODY_BYTE_CAP = 400 * 1024;
function capPanelBody(body: string) {
  const buf = Buffer.from(body, "utf8");
  if (buf.length <= PANEL_BODY_BYTE_CAP) return { body, truncated: false, bodyBytes: buf.length };
  let cut = PANEL_BODY_BYTE_CAP;
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut--;
  return {
    body: buf.subarray(0, cut).toString("utf8") + "\n\n…（正文已截断，约 400KB 上限）",
    truncated: true,
    bodyBytes: buf.length,
  };
}
function requireValue(input: Record<string, unknown>, key: string, code: string, message: string) {
  const value = asString(input, key);
  if (!value) throw new NovelError(code, message);
  return value;
}
function routesFor(config: PluginConfig): Record<string, RouteHandler> {
  const withPaths =
    (handler: (request: ProjectRequest) => Promise<unknown>, limit?: number): RouteHandler =>
    async (ctx) => {
      const input =
        ctx.method === "POST" ? await ctx.body(limit) : Object.fromEntries(ctx.url.searchParams);
      if (!input) return;
      const paths = await panelPaths(
        ctx.url,
        config,
        asString(input, "base") ?? asString(input, "project") ?? "",
      );
      return handler({ ctx, input, paths });
    };
  const withWork = (
    handler: (request: WorkRequest) => Promise<unknown>,
    limit?: number,
  ): RouteHandler =>
    withPaths(async (request) => {
      const workKey = requireValue(request.input, "work", "work_required", "缺少 work");
      const dir = await resolveWorkDir(request.paths, workKey);
      return handler({ ...request, workKey, dir });
    }, limit);
  const chapterAction = (action: "review" | "finalize" | "acknowledge") =>
    withWork(async ({ ctx, input, dir }) => {
      if (
        input.confirm !== true ||
        typeof input.chapter !== "string" ||
        typeof input.expectedRevision !== "string"
      )
        throw new NovelError("confirmation_required", "须明确确认、作品、章节与实际已读版本。");
      const id = assertResourceId(input.chapter, "章节 id");
      if (action === "finalize") {
        const current = await readChapter(dir, id),
          denied = await finalizeProblem(dir, id, current.body, config.requireEditorPass === true);
        if (denied) throw new NovelError("writer_finalize_blocked", denied);
      }
      const chapter = await updateChapter(dir, {
        id,
        expectedRevision: input.expectedRevision,
        status: action === "review" ? "reviewed" : action === "finalize" ? "final" : undefined,
        reviewSummary: asString(input, "summary") ?? "作者在阅读面板声明已完整审读当前版本",
        reviewResult: input.result === "blocked" ? "blocked" : "pass",
        reviewedBy: "panel author",
        acknowledgeRevision: action === "acknowledge",
      });
      return ctx.json(200, { ok: true, chapterId: chapter.id, status: chapter.status });
    });
  const readBody = (kind: "chapter" | "candidate") =>
    withWork(async ({ ctx, input, dir, workKey }) => {
      const id = assertResourceId(
        requireValue(input, "id", "id_required", `缺少${kind === "chapter" ? "章节" : "候选"} id`),
      );
      if (kind === "chapter") {
        const rec = await readChapter(dir, id),
          writer = await chapterReviewInfo(dir, id, rec.body, config.requireEditorPass === true);
        return ctx.json(200, {
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
          ...capPanelBody(rec.body),
          writer,
        });
      }
      const cand = await readCandidate(dir, id),
        wordCount = countWords(cand.body);
      return ctx.json(200, {
        ok: true,
        workKey,
        meta: {
          id: cand.id,
          bodyHash: bodyHash(cand.body),
          targetRevision: cand.targetRevision,
          chapterId: cand.chapterId,
          stagedAt: cand.stagedAt,
          source: cand.source,
          note: cand.note,
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
        ...capPanelBody(cand.body),
        wordCount,
        pending: !cand.acceptedAt,
      });
    });
  const health = withPaths(async ({ ctx, paths }) => {
    const product = buildProductView();
    return ctx.json(200, {
      ok: true,
      plugin: "writer-agent",
      version: product.version,
      toolCount: product.toolCount,
      readOnlyGets: true,
      acceptViaPost: true,
      base: paths.base,
      resolvedVia: paths.resolvedVia,
      routes: FANQIE_ROUTES,
      multiDraftEnabled: MultiDraftPort.isEnabled(),
    });
  });
  const unify = withPaths(async ({ ctx, input, paths }) => {
    const raw = input.candidateIds;
    const candidateIds =
      ctx.method === "POST"
        ? (asStringArray(input, "candidateIds") ?? [])
        : typeof raw === "string"
          ? raw.split(/[,\s]+/).filter(Boolean)
          : [];
    const result = await prepareUnifyBrief(paths, {
      work: asString(input, "work") ?? "",
      chapter: asString(input, "chapter") ?? "",
      candidateIds: [...new Set(candidateIds)].slice(0, 8),
    });
    return ctx.json(
      result.ok
        ? 200
        : result.code === MultiDraftPort.disabledCode
          ? 400
          : result.code === "work_not_found"
            ? 404
            : 422,
      result,
    );
  });
  const table: Record<string, RouteHandler> = {
    [`GET ${API}`]: health,
    [`GET ${API}/health`]: health,
    [`GET ${API + ROUTES.capabilities}`]: async (ctx) =>
      ctx.json(200, {
        ok: true,
        quick: true,
        deep: false,
        deliver: false,
        deliverReason: "请先保存模型连接",
        deliverActions: DELIVERY_ACTIONS,
      }),
    [`POST ${API + ROUTES.diagnose}`]: withWork(
      async ({ ctx, input, dir }) => ctx.json(200, { ok: true, ...(await diagnose(dir, input)) }),
      64000,
    ),
    [`POST ${API + ROUTES.stageRevision}`]: withWork(
      async ({ ctx, input, dir }) =>
        ctx.json(200, { ok: true, ...(await stageRevisionCandidate(dir, input)) }),
      1024 * 1024,
    ),
    [`POST ${API + ROUTES.reviewChapter}`]: chapterAction("review"),
    [`POST ${API + ROUTES.finalizeChapter}`]: chapterAction("finalize"),
    [`POST ${API + ROUTES.acknowledge}`]: chapterAction("acknowledge"),
    [`POST ${API + ROUTES.accept}`]: withPaths(async ({ ctx, input, paths }) => {
      const mode = asString(input, "mode") ?? "replace";
      if (mode !== "append" && mode !== "replace")
        throw new NovelError("bad_mode", "mode 只支持 append / replace");
      const result = await runPanelAccept(paths, {
        work: asString(input, "work") ?? "",
        candidate: asString(input, "candidate") ?? "",
        confirm: input.confirm === true,
        mode,
        expectedRevision: asString(input, "expectedRevision"),
        lintPassToken: asString(input, "lintPassToken"),
        force: boolArg(input, "force"),
        skipBrief: boolArg(input, "skipBrief"),
        strictLint: boolArg(input, "strictLint"),
        requirePayoff: boolArg(input, "requirePayoff"),
        strictHuman: boolArg(input, "strictHuman"),
        strictNovel: boolArg(input, "strictNovel"),
        acceptAfterEdit: boolArg(input, "acceptAfterEdit"),
        confirmAcceptAfterEdit: boolArg(input, "confirmAcceptAfterEdit"),
      });
      const status = result.ok
        ? 200
        : result.code === "recovery_required" || result.code === "recovery_conflict"
          ? 409
          : ["confirm_required", "edit_accept_confirm_required", "bad_id", "bad_args"].includes(
                result.code,
              )
            ? 400
            : result.code === "work_not_found" || result.code === "candidate_not_found"
              ? 404
              : 422;
      return ctx.json(status, result);
    }),
    [`GET ${API + ROUTES.unifyPrepare}`]: unify,
    [`POST ${API + ROUTES.unifyPrepare}`]: unify,
    [`POST ${API + ROUTES.saveChapter}`]: withWork(
      async ({ ctx, input, dir }) => {
        const chapter = asString(input, "chapter", { required: true }),
          body = asString(input, "body", { required: true, trim: false }),
          expectedRevision = asString(input, "expectedRevision", { required: true });
        if (input.mode === "candidate") {
          const cand = await stageCandidate(dir, {
            chapterId: chapter,
            body,
            expectedRevision,
            editOf: asString(input, "editOf"),
            source: "author",
            note: "作者在阅读面板保存",
            draftLabel: asString(input, "draftLabel") || "作者修订",
          });
          return ctx.json(200, {
            ok: true,
            candidateId: cand.id,
            chapterId: cand.chapterId,
            wordCount: cand.wordCount,
          });
        }
        const saved = await updateChapter(dir, {
          id: chapter,
          body,
          expectedRevision,
          force: boolArg(input, "force"),
          ledgerEntry: "作者在阅读面板保存正文",
        });
        return ctx.json(200, {
          ok: true,
          chapterId: saved.id,
          revision: saved.revision,
          status: saved.status,
          wordCount: saved.wordCount,
        });
      },
      4 * 1024 * 1024,
    ),
    [`GET ${API + ROUTES.projects}`]: async (ctx) => {
      const paths = await resolveHttpPaths(config),
        current = projectIdOf(paths.base),
        known = await listProjects({ refresh: ctx.url.searchParams.get("refresh") === "1" });
      if (!known.some((p) => p.id === current))
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
      return ctx.json(200, {
        ok: true,
        base: paths.base,
        resolvedVia: paths.resolvedVia,
        current,
        projects: known,
      });
    },
    [`GET ${API}/works`]: withPaths(async ({ ctx, paths }) => {
      const works = await listWorks(paths);
      return ctx.json(200, {
        ok: true,
        base: paths.base,
        resolvedVia: paths.resolvedVia,
        works: works.map((w) => ({
          key: w.key,
          title: w.title,
          genre: w.genre,
          chapters: w.recoveryPending ? null : w.chapters.length,
          words: w.recoveryPending
            ? null
            : w.chapters.reduce((sum: number, c: { wordCount: number }) => sum + c.wordCount, 0),
          recoveryPending: w.recoveryPending === true,
          updatedAt: w.updatedAt,
        })),
      });
    }),
    [`GET ${API}/library`]: withPaths(async ({ ctx, paths }) =>
      ctx.json(200, {
        ok: true,
        base: paths.base,
        library: await buildLibraryView(paths),
        product: buildProductView(),
      }),
    ),
    [`GET ${API}/report`]: withPaths(async ({ ctx, input, paths }) => {
      const source = assertSourceId(asString(input, "source"));
      const report = await readText(path.join(paths.library, "analyses", source, "report.md"));
      if (report === undefined)
        throw new NovelError("report_not_found", "报告未生成（先跑 fanqie_library_report）");
      return ctx.json(200, { ok: true, source, report });
    }),
    [`GET ${API}/inspiration`]: withPaths(async ({ ctx, input, paths }) => {
      const works = await listWorks(paths),
        workKey = asString(input, "work") || (works.length === 1 ? works[0].key : "");
      let foundation = {
        locks: "",
        happened: "",
        characters: "",
        readerKnowledge: "",
        planned: "",
        threads: "",
        style: "",
      };
      let chapters: { situationLens: string; livedScene: string; stateLens: string }[] = [];
      if (workKey) {
        const dir = await resolveWorkDir(paths, workKey);
        foundation = (await readWorkMeta(dir)).foundation;
        chapters = (await listChapterLensRows(dir)).map((c) => ({
          situationLens: c.situationLens,
          livedScene: c.livedScene,
          stateLens: c.stateLens,
        }));
      }
      return ctx.json(200, {
        ok: true,
        base: paths.base,
        workKey: workKey || null,
        inspiration: await buildInspirationView(paths, { workKey, foundation, chapters }),
        product: buildProductView(),
      });
    }),
    [`GET ${API + ROUTES.snapshot}`]: withPaths(async ({ ctx, input, paths }) => {
      const scope = input.scope === "work" ? "work" : "all",
        works = await listWorks(paths);
      let workKey = asString(input, "work");
      const common = {
        ok: true,
        projectId: projectIdOf(paths.base),
        base: paths.base,
        resolvedVia: paths.resolvedVia,
      };
      if (!workKey && works.length === 0) {
        const library =
          scope === "all"
            ? await buildLibraryView(paths).catch((error) => ({
                unavailable: true,
                recoveryPending:
                  error instanceof NovelError && error.code === "library_recovery_required",
                summary: error instanceof Error ? error.message : String(error),
              }))
            : undefined;
        return ctx.json(200, {
          ...common,
          empty: true,
          message:
            library && "unavailable" in library
              ? library.summary
              : "还没有作品。先用 fanqie_project_create 创建。",
          works: [],
          product: buildProductView(),
          ...(library ? { library } : {}),
        });
      }
      const rows = works.map((w) => ({
        key: w.key,
        title: w.title,
        recoveryPending: w.recoveryPending === true,
      }));
      if (!workKey && works.length > 1)
        return ctx.json(200, {
          ...common,
          needWork: true,
          message: "请选择作品",
          works: rows,
          product: buildProductView(),
        });
      workKey = workKey ?? works[0].key;
      const dir = await resolveWorkDir(paths, workKey),
        snapshot = await buildPanelSnapshot(dir, paths, { scope });
      return ctx.json(200, {
        ...common,
        empty: false,
        snapshot,
        multiDraftEnabled: snapshot.multiDraftEnabled,
        works: rows,
      });
    }),
    [`GET ${API + ROUTES.chapter}`]: readBody("chapter"),
    [`GET ${API + ROUTES.candidate}`]: readBody("candidate"),
  };
  return table;
}
const FANQIE_ROUTES = [
  ...new Set(Object.keys(routesFor({})).map((key) => key.slice(key.indexOf(" ") + 1))),
];
export function fanqieApi(config: PluginConfig = {}): WorkbenchMode {
  const routes = routesFor(config);
  return {
    routes: FANQIE_ROUTES,
    async handle(ctx) {
      if (!FANQIE_ROUTES.includes(ctx.path)) return false;
      const method =
        ctx.method === "HEAD" && ctx.path !== API + ROUTES.capabilities ? "GET" : ctx.method;
      const route = routes[`${method} ${ctx.path}`];
      if (!route) {
        ctx.json(405, { ok: false, code: "method", error: `method not allowed: ${ctx.method}` });
        return true;
      }
      try {
        await withPortConfig({ multiDraft: {enabled: config.multiDraft?.enabled === true} }, () =>
          route(ctx),
        );
      } catch (error) {
        sendError(ctx, error);
      }
      return true;
    },
  };
}
