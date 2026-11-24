import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import {
  atomicWrite,
  readJson,
  readTextIfExists,
  resolveResourcePath,
  sha256,
} from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import {
  buildDeliveryMarker,
  definePipeline,
  isAlreadyDelivered,
  type ContextPacket,
  type DeliveryReceipt,
  type PipelineDefinition,
} from "@zhizhang/core/pipeline";
import { arr, int, obj, opt, str } from "@zhizhang/core/schema";
import { createBibleStore } from "../../bible/store.js";
import { listChapters, readChapter } from "../../commands/chapter.js";
import { readLibraryCards, readWorkReferenceBindings } from "../../commands/library.js";
import { buildChapterContext } from "../../context/builder.js";
import { parseChapterMarkdown } from "../../domain/chapter.js";
import { MAX_EDITOR_REJECTIONS } from "../../domain/status.js";
import { WorkMetaSchema } from "../../storage/work.js";
import { gateDraft, resolvePreviousTextMode } from "./rules.js";
import {
  ChapterPipelineReq,
  type ChapterPipelineState,
  type ChapterReq,
  type ChapterRunResult,
  type DraftOutput,
  type GateReport,
  type ReviewResult,
} from "./schemas.js";
import {
  beatsStage,
  continuityStage,
  draftStage,
  makeCompareStage,
  makeReviewStage,
  makeReviseStage,
  makeScoreStage,
} from "./stages.js";

export * from "./schemas.js";
export * from "./rules.js";
export * from "./stages.js";

const DEFAULT_INPUT_BUDGET = 12000;

export const chapterPipeline: PipelineDefinition<
  ChapterReq,
  ChapterRunResult,
  ChapterPipelineState
> = definePipeline<ChapterReq, ChapterRunResult, ChapterPipelineState>({
  kind: "fanqie.chapter",
  request: ChapterPipelineReq,
  async context(target, req, env) {
    const clock = env.clock ?? systemClock;
    const lock = env.lock ?? createLockService(clock);
    return {
      runId: `run-${clock.now()}`,
      target,
      request: req,
      state: {},
      clock,
      lock,
      budget: env.budget,
      profileId: env.profileId,
      profile: env.profile,
      profileRoots: env.profileRoots,
    };
  },
  async run(runner, ctx) {
    const req = ctx.request;
    const clock = ctx.clock ?? systemClock;
    const lock = ctx.lock ?? createLockService(clock);
    const bibleStore = createBibleStore(lock, clock);

    const prepared = await runner.local("prepare", async () => {
      const workMeta = await readJson(path.join(ctx.target.path, "work.json"), WorkMetaSchema);
      const chapterRaw = await readTextIfExists(
        resolveResourcePath(ctx.target.path, "chapters", `${req.chapterId}.md`),
      );
      const parsedChapter = chapterRaw ? parseChapterMarkdown(chapterRaw) : undefined;
      const outlineText = parsedChapter?.meta.outline
        ? Object.entries(parsedChapter.meta.outline)
            .map(([k, v]) => `${k}：${v}`)
            .join("\n")
        : (req.note ?? `章节 ${req.chapterId}`);

      const bible = await bibleStore.read(ctx.target.path);
      const parsedPos = req.position ? Number.parseInt(req.position, 10) : NaN;
      const position =
        Number.isFinite(parsedPos) && parsedPos > 0
          ? parsedPos
          : Number(/\d+/.exec(req.chapterId)?.[0]) || bible.chapters.length + 1;
      const view = bibleStore.asOf(bible, position);
      const prevRecord = bible.chapters
        .filter((c) => c.position < position)
        .sort((a, b) => b.position - a.position)[0];
      const hits = bibleStore.match(view, [outlineText, prevRecord?.summary ?? ""]);

      const chapters = await listChapters(ctx.target.path);
      const previous = chapters.filter((chapter) => chapter.position < position).at(-1);
      const previousBody = previous
        ? (await readChapter(ctx.target.path, previous.id)).body
        : undefined;
      const foundation = await readJson(
        path.join(ctx.target.path, "plan/foundation.json"),
        obj({ coreConflict: str() }, { strict: false }),
      );
      const volumes = await readJson(
        path.join(ctx.target.path, "plan/structure.json"),
        arr(
          obj({
            volume: int(),
            title: str(),
            summary: opt(str()),
            startChapter: int(),
            endChapter: int(),
          }),
        ),
      );
      const volume = volumes?.find(
        (item) => item.startChapter <= position && item.endChapter >= position,
      );
      const allBindings = await readWorkReferenceBindings(ctx.target.path);
      const activeBindings = allBindings
        .filter((b) => (b.scope ?? "work") === "work" || b.chapterId === req.chapterId)
        .sort((a, b) =>
          (a.scope ?? "work") === "chapter" ? -1 : (b.scope ?? "work") === "chapter" ? 1 : 0,
        );
      const libraryRoot = ctx.libraryRoot;
      const loadedCards =
        libraryRoot && activeBindings.length > 0
          ? (
              await Promise.all(
                activeBindings.map(async (binding) => {
                  const { cards } = await readLibraryCards(libraryRoot, binding.sourceId);
                  const scope = binding.scope ?? "work";
                  return cards
                    .filter((card) => binding.cardIds.includes(card.id))
                    .map((card) => ({ ...card, scope }));
                }),
              )
            ).flat()
          : [];
      const briefCardSet = req.brief?.boundCardIds ? new Set(req.brief.boundCardIds) : null;
      const seenCard = new Set<string>();
      const referenceCards = loadedCards
        .filter((card) => {
          if (seenCard.has(card.id)) return false;
          if (briefCardSet && briefCardSet.size > 0 && !briefCardSet.has(card.id)) return false;
          seenCard.add(card.id);
          return true;
        })
        .map((card) =>
          briefCardSet && briefCardSet.has(card.id) ? { ...card, scope: "chapter" as const } : card,
        );
      const targetWords = req.targetWords ?? workMeta?.settings.targetWords ?? 3000;
      const grade = req.grade ?? workMeta?.grade ?? "standard";
      const prevModeSetting = workMeta?.settings.previousTextMode ?? "auto";
      const inputBudget = ctx.budget?.inputBudget ?? DEFAULT_INPUT_BUDGET;

      const packet = buildChapterContext({
        chapterId: req.chapterId,
        position,
        outlineText,
        authorNote: req.note,
        brief: req.brief,
        previousSummary: prevRecord?.summary,
        previousBody,
        bookPlan: {
          title: workMeta?.title,
          coreConflict: foundation?.coreConflict,
          currentVolume: volume ? { ...volume, summary: volume.summary ?? "" } : undefined,
        },
        referenceCards,
        previousHandoff: prevRecord ? JSON.stringify(prevRecord.handoff) : undefined,
        bible,
        view,
        hits,
        recentSummaries: bible.chapters
          .filter((c) => c.position < position)
          .slice(-10)
          .map((c) => ({ position: c.position, summary: c.summary })),
        budget: inputBudget,
        previousTextMode: resolvePreviousTextMode(prevModeSetting, grade),
      });

      return {
        packet,
        targetWords,
        position,
        outlineText,
        grade,
        appliedCardIds: referenceCards.map((c) => c.id),
      };
    });

    ctx.state.outlineText = prepared.outlineText;
    ctx.state.grade = prepared.grade;
    ctx.state.appliedCardIds = prepared.appliedCardIds;
    const packet: ContextPacket = prepared.packet;

    // 1. beats
    const beats = await runner.stage(beatsStage, packet);
    ctx.state.beats = beats;

    // 2. draft × N
    const drafts = await runner.fanOut(draftStage, packet);

    // 3. gate (篇幅 / 占位符 / 命中项)
    const gateResults = await runner.local("gate", async () => {
      const reports = drafts.map((draft, idx) => ({
        idx,
        draft,
        report: gateDraft(draft, { targetWords: prepared.targetWords }),
      }));
      const passing = reports.filter((r) => r.report.passed);
      if (passing.length === 0) {
        const reasons = reports.flatMap((r) => r.report.reasons).slice(0, 6);
        throw new AppError(
          "model.output_invalid",
          `所有候选稿未通过基础门禁：${reasons.join("；")}`,
          { reasons },
        );
      }
      return passing;
    });

    const passingDrafts = gateResults.map((g) => g.draft);
    ctx.state.passingDrafts = passingDrafts;

    // 4. select (逐稿独立打分 + 前二换位比较)
    let chosen = passingDrafts[0];
    let chosenGate = gateResults[0].report;

    if (passingDrafts.length > 1) {
      const scored: Array<{ idx: number; draft: DraftOutput; gate: GateReport; score: number }> =
        await Promise.all(
          passingDrafts.map(async (draft, i) => {
            const res = await runner.stage(makeScoreStage(i), packet);
            return {
              idx: i,
              draft,
              gate: gateResults[i].report,
              score: res.score,
            };
          }),
        );
      scored.sort((a, b) => b.score - a.score || a.idx - b.idx);

      ctx.state.topTwo = [scored[0].draft, scored[1].draft];
      const [ab, ba] = await Promise.all([
        runner.stage(makeCompareStage("ab", true), packet),
        runner.stage(makeCompareStage("ba", false), packet),
      ]);

      if (ab.winner === "B" && ba.winner === "A") {
        chosen = scored[1].draft;
        chosenGate = scored[1].gate;
      } else {
        chosen = scored[0].draft;
        chosenGate = scored[0].gate;
      }
    }

    ctx.state.currentDraft = chosen;

    // 5. continuity-check
    const continuity = await runner.stage(continuityStage, packet);

    // 6. review & revise loop (<= MAX_EDITOR_REJECTIONS = 2)
    let editorPass = false;
    let editorRejections = 0;
    let latestReview: ReviewResult = {
      verdict: "pass",
      issues: [],
      summary: "尚未审读",
    };

    for (let round = 1; round <= MAX_EDITOR_REJECTIONS + 1; round++) {
      latestReview = await runner.stage(makeReviewStage(round), packet);
      const combinedIssues =
        round === 1 ? [...continuity.issues, ...latestReview.issues] : latestReview.issues;

      if (latestReview.verdict === "pass" && combinedIssues.length === 0) {
        editorPass = true;
        break;
      }

      if (round > MAX_EDITOR_REJECTIONS) {
        editorRejections = MAX_EDITOR_REJECTIONS;
        break;
      }

      editorRejections = round;
      ctx.state.pendingIssues = combinedIssues;
      const revised = await runner.stage(makeReviseStage(round), packet);
      const revisedGate = await runner.local(`gate-revise-${round}`, async () =>
        gateDraft(revised, { targetWords: prepared.targetWords }),
      );
      if (!revisedGate.passed) {
        latestReview = {
          verdict: "reject",
          issues: [
            ...combinedIssues,
            {
              kind: "reader",
              quote: "",
              issue: `第 ${round} 轮修稿未通过门禁：${revisedGate.reasons.join("；")}`,
              fix: "已保留上一版通过门禁的候选稿，请作者审阅并决定是否手工调整",
            },
          ],
          summary: `${latestReview.summary}（第 ${round} 轮修稿未通过门禁，已回退保留上一版候选稿）`,
        };
        editorPass = false;
        break;
      }
      chosen = revised;
      chosenGate = revisedGate;
      ctx.state.currentDraft = chosen;
    }

    return {
      title: chosen.title,
      body: chosen.body,
      beats,
      gate: chosenGate,
      review: latestReview,
      editorPass,
      editorRejections,
    };
  },
  async deliver(res, ctx): Promise<DeliveryReceipt> {
    const req = ctx.request;
    const candDir = resolveResourcePath(ctx.target.path, "candidates", req.chapterId);
    const marker = path.join(candDir, `${ctx.runId}.marker.json`);
    if (await isAlreadyDelivered(marker, ctx.runId)) {
      return {
        runId: ctx.runId,
        deliveredPaths: [],
        contentHash: sha256(res.body),
        summary: "已幂等交付",
      };
    }
    const candFile = path.join(candDir, `${ctx.runId}.md`);
    const metaFile = path.join(candDir, `${ctx.runId}.meta.json`);
    await atomicWrite(candFile, `# ${res.title}\n\n${res.body}`);
    await atomicWrite(
      metaFile,
      JSON.stringify(
        {
          runId: ctx.runId,
          chapterId: req.chapterId,
          title: res.title,
          wordCount: res.gate.wordCount,
          editorPass: res.editorPass,
          editorRejections: res.editorRejections,
          bodyHash: sha256(res.body),
          review: res.review,
          beats: res.beats,
          ...(req.brief ? { brief: req.brief } : {}),
          ...(Array.isArray(ctx.state.appliedCardIds)
            ? { appliedCardIds: ctx.state.appliedCardIds }
            : {}),
          ...(ctx.profileId ? { profileId: ctx.profileId } : {}),
        },
        null,
        2,
      ),
    );
    await atomicWrite(marker, buildDeliveryMarker(ctx.runId, res.body));
    return {
      runId: ctx.runId,
      deliveredPaths: [candFile, metaFile],
      contentHash: sha256(res.body),
      summary: `已交付候选稿「${res.title}」（${res.gate.wordCount} 字，${res.editorPass ? "编辑通过" : `待作者裁决，打回 ${res.editorRejections} 轮`}）`,
    };
  },
  async recover(record, ctx) {
    const req = ctx.request;
    const marker = resolveResourcePath(
      ctx.target.path,
      "candidates",
      req.chapterId,
      `${record.id}.marker.json`,
    );
    return (await isAlreadyDelivered(marker, record.id)) ? "delivered" : "resume";
  },
});
