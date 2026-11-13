import { withPluginConfig } from "../engine/runtime-config.js";
import {
  COMMANDS,
  commandPolicy,
  sendError,
  type CommandContext,
  type WorkbenchCommands,
} from "../../../workbench/src/commands.js";
import type { StoragePaths, PluginConfig } from "../engine/types.js";
import { NovelError } from "../engine/errors.js";
import { asString, asStringArray, boolArg } from "../engine/parse.js";
import { assertResourceId } from "../engine/storage/primitives.js";
import {
  candidateHasLintPass,
  countWords,
  listProjects,
  listWorks,
  projectIdOf,
  readCandidate,
  readChapter,
  resolveWorkDir,
  stageCandidate,
} from "../engine/work-store.js";
import { diagnose, stageRevisionCandidate, bodyHash } from "../engine/services/diagnostics.js";
import { buildPanelSnapshot } from "../engine/panel-query.js";
import { buildLibraryView, buildProductView } from "../engine/panel-enrich.js";
import { updateChapter } from "../engine/storage/chapters.js";
import { withPortConfig } from "../engine/ports/config.js";
import { chapterReviewInfo, finalizeProblem } from "../review.js";
import { runPanelAccept } from "./accept.js";
import { panelPaths, resolvePanelPaths } from "./paths.js";
import { prepareUnifyBrief } from "./unify.js";

/** 作者在写作台阅读面板保存正文时写入 ledger 的固定摘要；改稿学习据此识别作者改动（learn-task.ts 引用） */
export const AUTHOR_PANEL_SAVE_SUMMARY = "作者在阅读面板保存正文";

type RouteHandler = (ctx: CommandContext) => Promise<unknown>;
type ProjectRequest = { ctx: CommandContext; input: Record<string, unknown>; paths: StoragePaths };
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
function commandsFor(config: PluginConfig): Record<string, RouteHandler> {
  const withPaths =
    (handler: (request: ProjectRequest) => Promise<unknown>): RouteHandler =>
    async (ctx) => {
      const input = ctx.input;
      const paths = await panelPaths(
        config,
        asString(input, "base") ?? asString(input, "project") ?? "",
      );
      return handler({ ctx, input, paths });
    };
  const withWork = (handler: (request: WorkRequest) => Promise<unknown>): RouteHandler =>
    withPaths(async (request) => {
      const workKey = requireValue(request.input, "work", "work_required", "缺少 work");
      const dir = await resolveWorkDir(request.paths, workKey);
      return handler({ ...request, workKey, dir });
    });
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
        expectedReadVersion: asString(input, "expectedReadVersion"),
        status: action === "review" ? "reviewed" : action === "finalize" ? "final" : undefined,
        reviewSummary: asString(input, "summary") ?? "作者在阅读面板声明已完整审读当前版本",
        reviewResult: input.result === "blocked" ? "blocked" : "pass",
        reviewedBy: "panel author",
        acknowledgeRevision: action === "acknowledge",
      });
      return ctx.reply({ ok: true, chapterId: chapter.id, status: chapter.status });
    });
  const readBody = (kind: "chapter" | "candidate") =>
    withWork(async ({ ctx, input, dir, workKey }) => {
      const id = assertResourceId(
        requireValue(input, "id", "id_required", `缺少${kind === "chapter" ? "章节" : "候选"} id`),
      );
      if (kind === "chapter") {
        const rec = await readChapter(dir, id),
          writer = await chapterReviewInfo(dir, id, rec.body, config.requireEditorPass === true);
        return ctx.reply({
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
      return ctx.reply({
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
  const unify = withPaths(async ({ ctx, input, paths }) => {
    const raw = input.candidateIds;
    const candidateIds =
      ctx.kind === "write"
        ? (asStringArray(input, "candidateIds") ?? [])
        : typeof raw === "string"
          ? raw.split(/[,\s]+/).filter(Boolean)
          : [];
    const result = await prepareUnifyBrief(paths, {
      work: asString(input, "work") ?? "",
      chapter: asString(input, "chapter") ?? "",
      candidateIds: [...new Set(candidateIds)].slice(0, 8),
    });
    return ctx.reply(result);
  });
  const table: Record<string, RouteHandler> = {
    [COMMANDS.diagnose]: withWork(async ({ ctx, input, dir }) =>
      ctx.reply({ ok: true, ...(await diagnose(dir, input)) }),
    ),
    [COMMANDS.stageRevision]: withWork(async ({ ctx, input, dir }) =>
      ctx.reply({ ok: true, ...(await stageRevisionCandidate(dir, input)) }),
    ),
    [COMMANDS.reviewChapter]: chapterAction("review"),
    [COMMANDS.finalizeChapter]: chapterAction("finalize"),
    [COMMANDS.acknowledge]: chapterAction("acknowledge"),
    [COMMANDS.accept]: withPaths(async ({ ctx, input, paths }) => {
      const mode = asString(input, "mode") ?? "replace";
      if (mode !== "append" && mode !== "replace")
        throw new NovelError("bad_mode", "mode 只支持 append / replace");
      const result = await runPanelAccept(paths, {
        work: asString(input, "work") ?? "",
        candidate: asString(input, "candidate") ?? "",
        confirm: input.confirm === true,
        mode,
        observedRevision: asString(input, "expectedRevision"),
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
      return ctx.reply(result);
    }),
    [COMMANDS.unifyPrepare]: unify,
    [COMMANDS.saveChapter]: withWork(async ({ ctx, input, dir }) => {
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
        return ctx.reply({
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
        expectedReadVersion: asString(input, "expectedReadVersion"),
        force: boolArg(input, "force"),
        ledgerEntry: AUTHOR_PANEL_SAVE_SUMMARY,
      });
      return ctx.reply({
        ok: true,
        chapterId: saved.id,
        revision: saved.revision,
        status: saved.status,
        wordCount: saved.wordCount,
      });
    }),
    [COMMANDS.projects]: async (ctx) => {
      const paths = await resolvePanelPaths(config),
        current = projectIdOf(paths.base),
        known = await listProjects({ refresh: String(ctx.input.refresh) === "1" });
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
      return ctx.reply({
        ok: true,
        base: paths.base,
        resolvedVia: paths.resolvedVia,
        current,
        projects: known,
      });
    },
    [COMMANDS.snapshot]: withPaths(async ({ ctx, input, paths }) => {
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
            ? // allow-catch: return the library error as an unavailable summary to keep empty-workspace navigation usable.
              await buildLibraryView(paths).catch((error) => ({
                unavailable: true,
                recoveryPending:
                  error instanceof NovelError && error.code === "library_recovery_required",
                summary: error instanceof Error ? error.message : String(error),
              }))
            : undefined;
        return ctx.reply({
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
        return ctx.reply({
          ...common,
          needWork: true,
          message: "请选择作品",
          works: rows,
          product: buildProductView(),
        });
      workKey = workKey ?? works[0].key;
      const dir = await resolveWorkDir(paths, workKey),
        snapshot = await buildPanelSnapshot(dir, paths, { scope });
      return ctx.reply({
        ...common,
        empty: false,
        snapshot,
        multiDraftEnabled: snapshot.multiDraftEnabled,
        works: rows,
      });
    }),
    [COMMANDS.chapter]: readBody("chapter"),
    [COMMANDS.candidate]: readBody("candidate"),
  };
  return table;
}
export function fanqieApi(config: PluginConfig = {}): WorkbenchCommands {
  const handlers = commandsFor(config);
  return {
    async handle(ctx) {
      const handler = handlers[ctx.command];
      if (!handler) return false;
      const policy = commandPolicy(ctx.command);
      if (!policy || (policy.kind !== "both" && policy.kind !== ctx.kind)) {
        ctx.reply({ ok: false, code: "invalid_command", error: `操作类型不匹配：${ctx.command}` });
        return true;
      }
      try {
        await withPortConfig(
          {
            multiDraft: { enabled: config.multiDraft?.enabled === true },
            continuity: { enabled: config.continuity?.enabled === true },
          },
          () => withPluginConfig(config, () => handler(ctx)),
        );
      } catch (error) {
        sendError(ctx, error);
      }
      return true;
    },
  };
}
