import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { readJson, readTextIfExists, resolveResourcePath } from "@zhizhang/core/fs";
import type { ContextPacket, RunCtx } from "@zhizhang/core/pipeline";
import { arr, int, obj, opt, str } from "@zhizhang/core/schema";
import type { createBibleStore } from "../../bible/store.js";
import { readCandidate } from "../../commands/candidate.js";
import { listChapters, readChapter } from "../../commands/chapter.js";
import { readLibraryCards, readWorkReferenceBindings } from "../../commands/library.js";
import { buildChapterContext } from "../../context/builder.js";
import { parseChapterMarkdown } from "../../domain/chapter.js";
import { WorkMetaSchema } from "../../storage/work.js";
import { resolvePreviousTextMode } from "./rules.js";
import type { ChapterPipelineState, ChapterReq, DerivedFrom, DraftOutput } from "./schemas.js";

const DEFAULT_INPUT_BUDGET = 12000;
const CONTINUATION_ANCHOR_CHARS = 500;

export interface PreparedChapter {
  packet: ContextPacket;
  targetWords: number;
  position: number;
  outlineText: string;
  grade: "economy" | "standard" | "premium";
  appliedCardIds: string[];
  existingPrefix?: string;
  existingTitle?: string;
  derivedFrom?: DerivedFrom;
}

export function stitchContinuation(
  existingPrefix: string,
  draft: DraftOutput,
  fallbackTitle: string,
): DraftOutput {
  const trimmedPrefix = existingPrefix.trim();
  const trimmedBody = draft.body.trim();
  const headProbe = trimmedPrefix.slice(0, Math.min(80, trimmedPrefix.length));
  const title = draft.title.trim() || fallbackTitle;
  if (headProbe.length > 0 && trimmedBody.startsWith(headProbe)) {
    return { title, body: trimmedBody };
  }
  return {
    title,
    body: `${trimmedPrefix}\n\n${trimmedBody}`,
  };
}

export async function prepareChapterContext(
  ctx: RunCtx<ChapterReq, ChapterPipelineState>,
  bibleStore: ReturnType<typeof createBibleStore>,
): Promise<PreparedChapter> {
  const req = ctx.request;
  const workMeta = await readJson(path.join(ctx.target.path, "work.json"), WorkMetaSchema);
  const chapterRaw = await readTextIfExists(
    resolveResourcePath(ctx.target.path, "chapters", `${req.chapterId}.md`),
  );
  const parsedChapter = chapterRaw ? parseChapterMarkdown(chapterRaw) : undefined;
  const existingPrefix = req.continueFromExisting ? (parsedChapter?.body.trim() ?? "") : undefined;
  if (req.continueFromExisting && (!existingPrefix || existingPrefix.length === 0)) {
    throw new AppError("input.invalid", `当前章节尚无已写正文，无法断点续写：${req.chapterId}`, {
      chapterId: req.chapterId,
    });
  }

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
  let previousBody: string | undefined;
  let derivedFrom: DerivedFrom | undefined;
  if (previous) {
    if (req.previousCandidateId) {
      const prevCand = await readCandidate(ctx.target.path, previous.id, req.previousCandidateId);
      previousBody = prevCand.body;
      derivedFrom = {
        kind: "candidate",
        chapterId: previous.id,
        candidateId: req.previousCandidateId,
      };
    } else {
      previousBody = (await readChapter(ctx.target.path, previous.id)).body;
      derivedFrom = { kind: "final", chapterId: previous.id };
    }
  }

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
    .map((card) => {
      const chapterScope: "work" | "chapter" = "chapter";
      return briefCardSet && briefCardSet.has(card.id) ? { ...card, scope: chapterScope } : card;
    });
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

  if (existingPrefix) {
    const tailAnchor = existingPrefix.slice(-CONTINUATION_ANCHOR_CHARS);
    const continueText = [
      "【半章断点续写指令】",
      "以下为本章已写前缀的末尾锚点（完整前缀已锁定不可改动）。请紧接最后一句无缝续写后半段，不要复述已有段落，补足冲突推进与章末钩子：",
      "",
      tailAnchor,
    ].join("\n");
    packet.suffix.push({
      id: "continue-prefix",
      layer: 0,
      text: continueText,
      required: true,
      tokens: Math.ceil(continueText.length / 2),
      reason: "半章断点续写末尾锚点",
      source: { kind: "chapter", ref: `${req.chapterId}:tail` },
    });
    packet.estimate += Math.ceil(continueText.length / 2);
  }

  return {
    packet,
    targetWords,
    position,
    outlineText,
    grade,
    appliedCardIds: referenceCards.map((c) => c.id),
    existingPrefix,
    existingTitle: parsedChapter?.meta.title || req.chapterId,
    derivedFrom,
  };
}
