import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { commands as fanqie } from "@zhizhang/fanqie";
import { computeSerialBuffer } from "@zhizhang/fanqie/view";
import { wordDocument } from "../exports.js";
import {
  assertOutPath,
  safeId,
  workDirName,
  type CommandGroup,
  type CommandHandler,
} from "./commands-shared.js";

async function snapshotRevision(
  work: string,
  rows: unknown,
  bufferConfig: { publishedThrough?: string; dailyTargetChars?: number },
): Promise<string> {
  const structure = (await readTextIfExists(path.join(work, "plan", "structure.json"))) ?? "[]";
  return sha256(JSON.stringify({ rows, structure, bufferConfig }));
}

export const FANQIE_HANDLERS: { [K in CommandGroup<"fanqie">]: CommandHandler<K> } = {
  async "fanqie.snapshot"(input, ctx) {
    const work = ctx.inside(input.work);
    const meta = await fanqie.getWork(work);
    const rows = await fanqie.listChapters(work);
    const bufferConfig = {
      publishedThrough: meta.publishedThrough,
      dailyTargetChars: meta.dailyTargetChars,
    };
    const revision = await snapshotRevision(work, rows, bufferConfig);
    if (input.since === revision) return { revision, full: false, rows: [], removedIds: [] };
    const buffer = computeSerialBuffer(rows, bufferConfig);
    return { revision, full: true, rows, removedIds: [], buffer };
  },
  async "fanqie.chapter.list"(input, ctx) {
    return { rows: await fanqie.listChapters(ctx.inside(input.work)) };
  },
  async "fanqie.chapter.get"(input, ctx) {
    const doc = await fanqie.readChapter(ctx.inside(input.work), input.chapter);
    return {
      id: doc.meta.id,
      title: doc.meta.title,
      body: doc.body,
      revision: doc.meta.revision,
      status: doc.meta.status,
    };
  },
  async "fanqie.chapter.save"(input, ctx) {
    const work = ctx.inside(input.work);
    const chapter = safeId(input.chapter, "chapter");
    const before = await fanqie.readChapter(work, chapter).catch(() => undefined);
    const doc = await fanqie.saveChapter(
      work,
      {
        chapterId: chapter,
        body: input.body,
        ...(input.title ? { title: input.title } : {}),
        ...(input.base ? { expectedRevision: input.base } : {}),
      },
      ctx.locks,
    );
    if (before && before.body !== doc.body) {
      await fanqie
        .recordChapterEditLearning(
          work,
          {
            chapterId: chapter,
            beforeBody: before.body,
            afterBody: doc.body,
            nowIso: ctx.clock.iso(),
          },
          ctx.locks,
        )
        .catch((err: unknown) => {
          ctx.log?.("learning_record_failed", {
            chapter,
            message: err instanceof Error ? err.message : String(err),
          });
        });
    }
    const row = (await fanqie.listChapters(work)).find((r) => r.id === chapter);
    if (!row) throw new AppError("storage.io", `章节保存后未能读回：${chapter}`, { chapter });
    return { revision: doc.meta.revision, row };
  },
  async "fanqie.chapter.finalize"(input, ctx) {
    await fanqie.finalizeChapter(ctx.inside(input.work), { chapterId: input.chapter }, ctx.locks);
    return { status: "final" };
  },
  async "fanqie.candidate.list"(input, ctx) {
    return { candidates: await fanqie.listCandidates(ctx.inside(input.work), input.chapter) };
  },
  async "fanqie.candidate.get"(input, ctx) {
    return fanqie.readCandidate(ctx.inside(input.work), input.chapter, input.candidateId);
  },
  async "fanqie.candidate.accept"(input, ctx) {
    const work = ctx.inside(input.work);
    const doc = await fanqie.acceptCandidate(
      work,
      { chapterId: input.chapter, candidateId: input.candidateId, expectedRevision: input.base },
      ctx.locks,
    );
    return {
      revision: doc.meta.revision,
      staleDownstreamCandidates: doc.staleDownstreamCandidates,
    };
  },
  async "fanqie.candidate.reject"(input, ctx) {
    return fanqie.rejectCandidate(
      ctx.inside(input.work),
      {
        chapterId: input.chapter,
        candidateId: input.candidateId,
        ...(input.reason ? { reason: input.reason } : {}),
      },
      ctx.locks,
    );
  },
  async "fanqie.work.list"(input, ctx) {
    return { works: await fanqie.listWorks(ctx.inside(input.root)) };
  },
  async "fanqie.work.get"(input, ctx) {
    return fanqie.getWork(ctx.inside(input.work));
  },
  async "fanqie.work.create"(input, ctx) {
    const root = ctx.inside(input.root);
    const workPath = path.join(root, workDirName(input.title));
    await fanqie.createWork(
      workPath,
      { id: `w-${ctx.clock.now().toString(36)}`, title: input.title, grade: input.grade },
      ctx.locks,
    );
    if (input.premise.trim()) {
      await atomicWrite(path.join(workPath, "plan", "premise.md"), `${input.premise.trim()}\n`);
    }
    return { workPath };
  },
  async "fanqie.work.importLegacy"(input, ctx) {
    const worksRoot = ctx.inside(input.root);
    const sourcePath = ctx.inside(input.sourcePath);
    const result = await fanqie.importLegacyWork(
      {
        worksRoot,
        workId: workDirName(input.title),
        title: input.title,
        sourcePath,
        sourceKind: input.sourceKind,
        grade: input.grade,
      },
      ctx.locks,
      ctx.clock,
    );
    return {
      workPath: result.workPath,
      chapterCount: result.chapterCount,
      totalWords: result.totalWords,
      backupDir: result.backupDir,
    };
  },
  async "fanqie.work.settings"(input, ctx) {
    const { work, ...patch } = input;
    return fanqie.updateWorkSettings(ctx.inside(work), patch, ctx.locks);
  },
  async "fanqie.book.export"(input, ctx) {
    const work = ctx.inside(input.work);
    const outPath = assertOutPath(input.outPath, input.format);
    if (input.format === "txt") {
      const result = await fanqie.exportWorkTxt(work, { onlyFinal: input.finalOnly, outPath });
      return { outPath, chapterCount: result.chapterCount };
    }
    const result = await fanqie.exportWorkTxt(work, { onlyFinal: input.finalOnly });
    await atomicWrite(outPath, await wordDocument(result.title, result.content));
    return { outPath, chapterCount: result.chapterCount };
  },
  async "fanqie.bible.get"(input, ctx) {
    return fanqie.readBible(ctx.inside(input.work), ctx.locks);
  },
  async "fanqie.bible.view"(input, ctx) {
    return fanqie.viewBibleAt(ctx.inside(input.work), input.position, ctx.locks);
  },
  async "fanqie.bible.propose"(input, ctx) {
    return {
      items: await fanqie.proposeBibleOps(ctx.inside(input.work), input.ops, input.from, ctx.locks),
    };
  },
  async "fanqie.bible.decide"(input, ctx) {
    await fanqie.decideBiblePending(ctx.inside(input.work), input.id, input.decision, ctx.locks);
    return { ok: true };
  },
  async "fanqie.bible.audit"(input, ctx) {
    return { findings: await fanqie.auditBible(ctx.inside(input.work), input.upTo, ctx.locks) };
  },
  async "fanqie.bible.trace"(input, ctx) {
    return fanqie.traceBibleEntity(
      ctx.inside(input.work),
      input.query,
      { includeBody: input.includeBody, maxBodyHits: input.maxBodyHits },
      ctx.locks,
    );
  },
  async "fanqie.reference.bind"(input, ctx) {
    const work = ctx.inside(input.work);
    await fanqie.getWork(work);
    return fanqie.bindReferenceCards(
      work,
      ctx.roots().library,
      {
        sourceId: input.sourceId,
        cardIds: input.cardIds,
        ...(input.scope ? { scope: input.scope } : {}),
        ...(input.chapterId ? { chapterId: safeId(input.chapterId, "chapterId") } : {}),
      },
      ctx.clock.iso(),
      ctx.locks,
    );
  },
  async "fanqie.reference.list"(input, ctx) {
    const work = ctx.inside(input.work);
    await fanqie.getWork(work);
    return { bindings: await fanqie.readWorkReferenceBindings(work) };
  },
};

export const LIBRARY_HANDLERS: { [K in CommandGroup<"library">]: CommandHandler<K> } = {
  async "library.import"(input, ctx) {
    return fanqie.importLibrarySource(
      ctx.inside(input.libraryRoot),
      { id: safeId(input.id, "id"), title: input.title, content: input.content },
      ctx.locks,
    );
  },
  async "library.list"(input, ctx) {
    return { sources: await fanqie.listLibrarySources(ctx.inside(input.libraryRoot)) };
  },
  async "library.cards"(input, ctx) {
    const { cards, report } = await fanqie.readLibraryCards(
      ctx.inside(input.libraryRoot),
      input.sourceId,
    );
    return { cards, ...(report !== undefined ? { report } : {}) };
  },
  async "library.cards.save"(input, ctx) {
    return fanqie.saveLibraryCards(
      ctx.inside(input.libraryRoot),
      safeId(input.sourceId, "sourceId"),
      input.cards,
      ctx.locks,
    );
  },
  async "library.dissect"(input, ctx) {
    const libraryRoot = ctx.inside(input.libraryRoot);
    const detail = await ctx.workflow.startAndWait(
      { mode: "fanqie", path: libraryRoot },
      "library.dissect",
      {
        sourceId: input.sourceId,
        title: input.title,
        ...(input.sourcePath ? { sourcePath: ctx.inside(input.sourcePath) } : {}),
      },
    );
    if (detail.state !== "awaiting-author") {
      const error = detail.error ?? {
        code: "run.interrupted" as const,
        message: `拆书未完成（${detail.state}）`,
      };
      throw new AppError(error.code, error.message, { runId: detail.id, state: detail.state });
    }
    const { cards, report } = await fanqie.readLibraryCards(libraryRoot, input.sourceId);
    return {
      sourceId: input.sourceId,
      title: input.title,
      cardCount: cards.length,
      summary: (report ?? "").split("\n").find((line) => line.trim()) ?? "",
    };
  },
};
