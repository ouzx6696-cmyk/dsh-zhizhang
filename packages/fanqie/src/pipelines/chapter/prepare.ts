import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { readJson, readTextIfExists, resolveResourcePath, sha256 } from "@zhizhang/core/fs";
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

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function verifyLockedPrefix(existingPrefix: string, body: string): boolean {
  const prefix = normalizeLineEndings(existingPrefix).trim();
  if (!prefix) return true;
  const candidate = normalizeLineEndings(body).trim();
  return candidate.startsWith(prefix);
}

export function stitchContinuation(
  existingPrefix: string,
  draft: DraftOutput,
  fallbackTitle: string,
): DraftOutput {
  const trimmedPrefix = normalizeLineEndings(existingPrefix).trim();
  const trimmedBody = normalizeLineEndings(draft.body).trim();
  const title = draft.title.trim() || fallbackTitle;
  if (!trimmedPrefix) {
    return { title, body: trimmedBody };
  }
  if (trimmedBody.startsWith(trimmedPrefix)) {
    return { title, body: trimmedBody };
  }
  const tailAnchor =
    trimmedPrefix.length > CONTINUATION_ANCHOR_CHARS
      ? trimmedPrefix.slice(-CONTINUATION_ANCHOR_CHARS).trim()
      : "";
  const rest =
    tailAnchor && trimmedBody.startsWith(tailAnchor)
      ? trimmedBody.slice(tailAnchor.length).trimStart()
      : trimmedBody;
  return {
    title,
    body: rest ? `${trimmedPrefix}\n\n${rest}` : trimmedPrefix,
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

  const chapters = await listChapters(ctx.target.path);
  const previous = chapters.filter((chapter) => chapter.position < position).at(-1);
  let previousBody: string | undefined;
  let derivedFrom: DerivedFrom | undefined;
  let useFormalPrevSummary = true;
  if (previous) {
    if (req.previousCandidateId) {
      const prevCand = await readCandidate(ctx.target.path, previous.id, req.previousCandidateId);
      previousBody = prevCand.body;
      derivedFrom = {
        kind: "candidate",
        chapterId: previous.id,
        candidateId: req.previousCandidateId,
        sourceHash: sha256(prevCand.body),
      };
      useFormalPrevSummary = false;
    } else {
      const prevDoc = await readChapter(ctx.target.path, previous.id);
      previousBody = prevDoc.body;
      const prevKind: DerivedFrom["kind"] =
        prevDoc.meta.status === "final"
          ? "final"
          : prevDoc.meta.status === "reviewed"
            ? "reviewed"
            : "drafted";
      derivedFrom = {
        kind: prevKind,
        chapterId: previous.id,
        sourceHash: sha256(prevDoc.body),
      };
    }
  }

  const prevSummary = useFormalPrevSummary ? prevRecord?.summary : undefined;
  const prevHandoff =
    useFormalPrevSummary && prevRecord ? JSON.stringify(prevRecord.handoff) : undefined;
  const hits = bibleStore.match(view, [
    outlineText,
    prevSummary ?? "",
    previousBody?.slice(-600) ?? "",
  ]);

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
  const continueText = existingPrefix
    ? [
        "【半章断点续写指令】",
        "以下为本章已写前缀的末尾锚点（完整前缀已锁定不可改动）。请紧接最后一句无缝续写后半段，不要复述已有段落，补足冲突推进与章末钩子：",
        "",
        existingPrefix.slice(-CONTINUATION_ANCHOR_CHARS),
      ].join("\n")
    : undefined;
  const continueTokens = continueText ? Math.ceil(continueText.length / 2) : 0;
  const contextBudget = Math.max(800, inputBudget - continueTokens);
  let appliedCardIds: string[] = [];

  const packet = buildChapterContext({
    chapterId: req.chapterId,
    position,
    outlineText,
    authorNote: req.note,
    brief: req.brief,
    previousSummary: prevSummary,
    previousBody,
    bookPlan: {
      title: workMeta?.title,
      coreConflict: foundation?.coreConflict,
      currentVolume: volume ? { ...volume, summary: volume.summary ?? "" } : undefined,
    },
    referenceCards,
    previousHandoff: prevHandoff,
    bible,
    view,
    hits,
    recentSummaries: bible.chapters
      .filter((c) => c.position < position)
      .slice(-10)
      .map((c) => ({ position: c.position, summary: c.summary })),
    budget: contextBudget,
    previousTextMode: resolvePreviousTextMode(prevModeSetting, grade),
    onIncludedCards: (ids) => {
      appliedCardIds = ids;
    },
  });

  if (continueText) {
    packet.suffix.push({
      id: "continue-prefix",
      layer: 0,
      text: continueText,
      required: true,
      tokens: continueTokens,
      reason: "半章断点续写末尾锚点",
      source: { kind: "chapter", ref: `${req.chapterId}:tail` },
    });
    packet.estimate += continueTokens;
  }

  return {
    packet,
    targetWords,
    position,
    outlineText,
    grade,
    appliedCardIds,
    existingPrefix,
    existingTitle: parsedChapter?.meta.title || req.chapterId,
    derivedFrom,
  };
}
