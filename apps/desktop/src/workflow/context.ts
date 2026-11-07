import { methodBasis } from "./methods";
import { readContinuity } from "./continuity";
import { readText, sha256 } from "../../../../packages/core/src/fsx";
import { ArticleStore } from "../../../../packages/toutiao/src/store";
import { findChapter, readChapter } from "../../../../packages/fanqie/src/engine/storage/chapters";
import { readWorkMeta } from "../../../../packages/fanqie/src/engine/storage/work-meta";
import {
  readForeshadow,
  readKnowledge,
} from "../../../../packages/fanqie/src/engine/storage/continuity";
import { resolveFanqieWork } from "../main/storage";
import type { Sessions } from "../session/manager";
import type { Target } from "../context";
import type { WorkflowRequest } from "../../../../packages/core/src/workflow";
import type { WorkflowContext } from "./run";

export async function workflowContext(
  host: Sessions,
  target: Target,
  request: WorkflowRequest,
): Promise<WorkflowContext> {
  const author = (await host.extras.preferences?.()) ?? "",
    methods = await methodBasis(host, request);
  const identity = { author, methods };
  const assertIdentity = async () => {
    if (
      JSON.stringify({
        author: (await host.extras.preferences?.()) ?? "",
        methods: await methodBasis(host, request),
      }) !== JSON.stringify(identity)
    )
      throw new Error("作者偏好或方法方案已变化，请新建任务以采用新依据");
  };
  if (target.mode === "toutiao") {
    if (!target.article) throw new Error("请先新建或选择文章");
    const store = new ArticleStore(target.root),
      meta = await store.get(target.article),
      card = await store.readCard(meta.id);
    if (meta.delivered || meta.status === "已交稿") throw new Error("文章已交稿，请新建文章");
    const feedback = (await readText(store.feedbackPath)) ?? "";
    const current = store.currentDraft(meta);
    const basis = JSON.stringify({ meta, card, identity, feedback });
    return {
      stable: author + "\n" + feedback,
      material: JSON.stringify({
        article: meta,
        card,
        current: current ? await store.readDraft(meta.id, current.rev) : "",
      }),
      chapterPosition: 0,
      basis,
      sourceHash: sha256(basis + author + request.source),
      assertCurrent: async () => {
        await assertIdentity();
        const now = await store.get(meta.id),
          nowCard = await store.readCard(meta.id);
        if (
          JSON.stringify({
            meta: now,
            card: nowCard,
            identity,
            feedback: (await readText(store.feedbackPath)) ?? "",
          }) !== basis
        )
          throw new Error("文章、标题或立项卡已变化，进度保留，请新建任务以采用当前版本");
      },
    };
  }
  const dir = await resolveFanqieWork(host.options, target),
    meta = await readWorkMeta(dir);
  const chapter =
    request.kind === "chapter" || request.kind === "ledger"
      ? await findChapter(dir, request.chapter)
      : undefined;
  const index = meta.chapters.findIndex((row) => row.id === request.chapter);
  const ordered = [...meta.chapters].sort((a, b) => a.position - b.position);
  const previous =
    index >= 0
      ? ordered.filter((row) => row.position < (chapter?.position ?? index + 1)).at(-1)
      : ordered.at(-1);
  const prev = previous ? await readChapter(dir, previous.id) : undefined;
  const [foreshadow, knowledge] = await Promise.all([readForeshadow(dir), readKnowledge(dir)]);
  const presence = JSON.stringify(chapter?.outline ?? request.instruction);
  const position = chapter?.position ?? (ordered.at(-1)?.position ?? 0) + 1;
  const continuity = {
    foreshadow: foreshadow.lines.filter(
      (line) =>
        line.plannedPayoff <= position || line.beats.some((beat) => beat.chapter === position),
    ),
    knowledge: knowledge.items.filter((item) =>
      item.holders.some((holder) => presence.includes(holder.who)),
    ),
  };
  const snapshot = () =>
    JSON.stringify({
      book: {
        title: meta.title,
        genre: meta.genre,
        premise: meta.premise,
        chapters: meta.chapters.map((row) => ({ id: row.id, position: row.position })),
      },
      foundation: meta.foundation,
      planning: meta.planning,
      chapter: chapter?.revision,
      previous: prev?.revision,
      foreshadow,
      knowledge,
    });
  const structured = await readContinuity(dir);
  const basis = JSON.stringify({ document: JSON.parse(snapshot()), structured, identity });
  return {
    stable: JSON.stringify({
      title: meta.title,
      genre: meta.genre,
      premise: meta.premise,
      foundation: {
        locks: meta.foundation.locks,
        characters: meta.foundation.characters,
        style: meta.foundation.style,
      },
      author,
    }),
    material: JSON.stringify({
      existingChapters: meta.chapters.map((row) => ({
        id: row.id,
        title: row.title,
        position: row.position,
        status: row.status,
      })),
      foundation: meta.foundation,
      planning: meta.planning,
      chapter,
      previousTail: prev?.body.slice(-800) ?? "",
      previousTitle: prev?.title,
      continuity,
      confirmed: structured.facts.filter((fact) => presence.includes(fact.subject)),
      recent: structured.chapters.slice(-3),
    }),
    chapterPosition: position,
    basis,
    sourceHash: sha256(basis + author),
    assertCurrent: async () => {
      await assertIdentity();
      const now = await readWorkMeta(dir),
        current =
          request.kind === "chapter" || request.kind === "ledger"
            ? await findChapter(dir, request.chapter)
            : undefined;
      const prior = previous ? await readChapter(dir, previous.id) : undefined;
      const [f, k] = await Promise.all([readForeshadow(dir), readKnowledge(dir)]);
      if (
        JSON.stringify({
          document: {
            book: {
              title: now.title,
              genre: now.genre,
              premise: now.premise,
              chapters: now.chapters.map((row) => ({ id: row.id, position: row.position })),
            },
            foundation: now.foundation,
            planning: now.planning,
            chapter: current?.revision,
            previous: prior?.revision,
            foreshadow: f,
            knowledge: k,
          },
          structured: await readContinuity(dir),
          identity,
        }) !== basis
      )
        throw new Error("作品依据或前章已变化，进度保留；请新建任务，避免覆盖作者修改");
    },
  };
}
