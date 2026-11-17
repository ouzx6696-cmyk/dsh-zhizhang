import path from "node:path";
import { readJson, readTextIfExists, resolveResourcePath } from "@zhizhang/core/fs";
import { arr, obj, str, lit } from "@zhizhang/core/schema";
import type { RunCtx } from "@zhizhang/core/pipeline";
import { WorkMetaSchema } from "../../storage/work.js";
import { parseChapterMarkdown } from "../../domain/chapter.js";
import { listChapters, readChapter } from "../../commands/chapter.js";
import { readLibraryCards } from "../../commands/library.js";
import { buildChapterContext } from "../../context/builder.js";
import { readOutline, derivePositions, nodesOf } from "../../outline/store.js";
import type { createBibleStore } from "../../bible/store.js";
import type { ChapterReq } from "./index.js";

export async function prepareChapter(
  ctx: RunCtx,
  req: Pick<ChapterReq, "chapterId"> & Partial<ChapterReq>,
  bibleStore: ReturnType<typeof createBibleStore>,
) {
  const workMeta = await readJson(path.join(ctx.target.path, "work.json"), WorkMetaSchema).catch(
    () => undefined,
  );
  const chapterRaw = await readTextIfExists(
    resolveResourcePath(ctx.target.path, "chapters", `${req.chapterId}.md`),
  );
  const parsedChapter = chapterRaw ? parseChapterMarkdown(chapterRaw) : undefined;
  const outline = await readOutline(ctx.target.path);
  const plan = nodesOf(outline).find(({ node }) => node.id === parsedChapter?.meta.outlineId)?.node;
  const { notes: _notes, provenance: _provenance, src: _src, rev: _rev, ...modelPlan } = plan ?? {};
  const outlineText = plan
    ? JSON.stringify(modelPlan)
    : parsedChapter?.meta.outline
      ? Object.entries(parsedChapter.meta.outline)
          .map(([k, v]) => `${k}：${v}`)
          .join("\n")
      : (req.note ?? `章节 ${req.chapterId}`);

  const bible = await bibleStore.read(ctx.target.path);
  const ledgers = await bibleStore.ledgers(ctx.target.path);
  const chapters = await listChapters(ctx.target.path);
  const positions = derivePositions(outline, chapters).chapters;
  const position =
    positions.get(req.chapterId) ??
    [...positions.values(), ...ledgers.map((entry) => entry.position)].reduce(
      (latest, value) => Math.max(latest, value),
      0,
    ) + 1;
  const view = bibleStore.asOf(bible, position, ledgers, workMeta?.settings.recentFactsWindow ?? 5);
  const prevRecord = ledgers
    .filter((c) => c.position < position)
    .sort((a, b) => b.position - a.position)[0];
  const hits = bibleStore.match(view, [outlineText, prevRecord?.summary ?? ""]);

  const previous = chapters.filter((chapter) => chapter.position < position).at(-1);
  const previousBody = previous
    ? (await readChapter(ctx.target.path, previous.id)).body
    : undefined;
  const volumeNode = nodesOf(outline).filter(
    ({ level, node }) =>
      level === "volume" &&
      "acts" in node &&
      node.acts.some((act) => act.chapters.some((chapter) => chapter.id === plan?.id)),
  )[0]?.node;
  const actNode = nodesOf(outline).find(
    ({ level, node }) =>
      level === "act" &&
      "chapters" in node &&
      node.chapters.some((chapter) => chapter.id === plan?.id),
  )?.node;
  const references = await readJson(
    path.join(ctx.target.path, "plan/references.json"),
    obj({
      format: lit("zhizhang/1.3"),
      bindings: arr(obj({ sourceId: str(), cardIds: arr(str()), boundAt: str() })),
    }),
  );
  const libraryRoot = ctx.libraryRoot;
  const referenceCards =
    libraryRoot && references
      ? (
          await Promise.all(
            references.bindings.map(async (binding) => {
              const { cards } = await readLibraryCards(libraryRoot, binding.sourceId);
              return cards.filter((card) => binding.cardIds.includes(card.id));
            }),
          )
        ).flat()
      : [];
  const targetWords = req.targetWords ?? workMeta?.settings.targetWords ?? 3000;
  const requiredIds = [
    ...(plan?.cast ?? []),
    ...(plan && "pov" in plan && plan.pov ? [plan.pov] : []),
    ...(plan && "location" in plan && plan.location ? [plan.location] : []),
  ];
  for (const entity of bible.entities)
    if (
      (requiredIds.includes(entity.id) ||
        entity.global ||
        hits.some((hit) => hit.entity.parent === entity.id)) &&
      !hits.some((hit) => hit.entity.id === entity.id)
    )
      hits.push({
        entity: {
          ...entity,
          summary: entity.global ? entity.summary.slice(0, 300) : entity.summary,
        },
        count: 1,
        firstIndex: 0,
        matchedTerm: entity.name,
      });
  const packet = buildChapterContext({
    chapterId: req.chapterId,
    position,
    outlineText,
    authorNote: req.note,
    previousSummary: prevRecord?.summary,
    previousBody,
    bookPlan: {
      title: workMeta?.title,
      coreConflict: outline.book.coreConflict,
      currentVolume: volumeNode
        ? {
            volume: outline.book.volumeOrder.indexOf(volumeNode.id) + 1,
            title: volumeNode.title,
            summary: volumeNode.summary ?? "",
          }
        : undefined,
      currentAct:
        actNode && "chapters" in actNode
          ? { title: actNode.title, summary: actNode.summary ?? "" }
          : undefined,
    },
    referenceCards,
    previousHandoff: prevRecord ? JSON.stringify(prevRecord.handoff) : undefined,
    bible,
    ledgers,
    view,
    hits,
    recentSummaries: ledgers
      .filter((c) => c.position < position)
      .slice(-10)
      .map((c) => ({ position: c.position, summary: c.summary })),
    earlyChapters: await Promise.all(
      chapters
        .filter((chapter) => chapter.position < Math.max(1, position - 10))
        .map(async (chapter) => ({
          chapter: chapter.id,
          position: chapter.position,
          summary: ledgers.find((entry) => entry.chapter === chapter.id)?.summary ?? "",
          body: (await readChapter(ctx.target.path, chapter.id)).body.slice(0, 2000),
        })),
    ),
    budget:
      workMeta?.settings.contextBudget ??
      (typeof ctx.state.inputBudget === "number" ? ctx.state.inputBudget : 24000),
    requiredEntityIds: requiredIds,
    requiredThreadIds: [...(plan?.plant ?? []), ...(plan?.pay ?? [])].flatMap((ref) =>
      ref.thread ? [ref.thread] : [],
    ),
    previousTextMode:
      (req.grade ?? workMeta?.grade) === "economy"
        ? { kind: "tail", chars: 1500 }
        : { kind: "full", maxChars: 4000 },
  });

  return {
    packet,
    targetWords,
    position,
    outlineText,
    grade: req.grade ?? workMeta?.grade ?? "standard",
  };
}
