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
import { readPlanning } from "../../../../packages/fanqie/src/engine/domain/planning";
import { resolveFanqieWork } from "../main/storage";
import type { Sessions } from "../session/manager";
import type { Target } from "../context";
import type { ContextBlock, WorkflowRequest } from "../../../../packages/core/src/workflow";
import type { WorkflowContext } from "./run";

/** Open foreshadow lines whose payoff falls within this many chapters ahead are shown to the stage. */
const DUE_AHEAD = 3;
/** Tail kept from free-text foundation fields that grow with every finalized chapter. */
const FOUNDATION_TAIL = 3000;
const RECENT_TOC = 20;
const FEEDBACK_TAIL = 4000;
function tail(value: string, max: number) {
  return value.length > max ? `（前文略）…${value.slice(-max)}` : value;
}
function head(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…（后文略）` : value;
}
type Meta = Awaited<ReturnType<typeof readWorkMeta>>;
/**
 * Chapter material scales with the chapter, not with the book: the current chapter, the
 * previous tail, due continuity and confirmed facts are required; plans, accumulated
 * foundation text and the table of contents are windowed and yield to the stage budget.
 */
function fanqieMaterial(input: {
  meta: Meta;
  chapter: Awaited<ReturnType<typeof findChapter>>;
  prev: Awaited<ReturnType<typeof readChapter>> | undefined;
  continuity: unknown;
  confirmed: unknown[];
  recent: unknown[];
  whole: boolean;
}): ContextBlock[] {
  const { meta, chapter, prev, whole } = input;
  const planning = readPlanning(meta) ?? undefined;
  const groups = planning
    ? [...planning.volumes, ...planning.acts].filter(
        (group) => whole || (chapter !== undefined && group.chapters.includes(chapter.id)),
      )
    : [];
  const foundation = meta.foundation;
  const toc = meta.chapters.map((row) => ({
    id: row.id,
    title: row.title,
    position: row.position,
    status: row.status,
  }));
  return [
    { name: "本章", text: chapter ? JSON.stringify(chapter) : "", required: true },
    {
      name: "前章结尾",
      text: prev ? `《${prev.title}》\n${prev.body.slice(-800)}` : "",
      required: true,
    },
    {
      name: "到期伏笔与知情边界",
      text: JSON.stringify(input.continuity),
      required: true,
    },
    { name: "已确认事实", text: JSON.stringify(input.confirmed), required: true },
    {
      name: "本卷规划",
      text: groups.length
        ? JSON.stringify(
            groups.map((group) => ({
              id: group.id,
              title: group.title,
              content: whole ? group.content : head(group.content, 4000),
            })),
          )
        : "",
      required: false,
    },
    {
      name: "全书规划",
      text: planning?.book ? head(planning.book.content, whole ? 12000 : 2000) : "",
      required: false,
    },
    { name: "近期章节记录", text: JSON.stringify(input.recent), required: false },
    {
      name: "根基（已发生、读者已知、计划、伏笔）",
      text: JSON.stringify({
        happened: whole ? foundation.happened : tail(foundation.happened, FOUNDATION_TAIL),
        readerKnowledge: tail(foundation.readerKnowledge, FOUNDATION_TAIL),
        planned: head(foundation.planned, FOUNDATION_TAIL),
        threads: tail(foundation.threads, FOUNDATION_TAIL),
      }),
      required: false,
    },
    {
      name: "章节目录",
      text: JSON.stringify({
        total: toc.length,
        chapters: whole ? toc : toc.slice(-RECENT_TOC),
      }),
      required: false,
    },
  ];
}
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
      // Author feedback accumulates per article; the newest part carries the current preferences.
      stable: author + "\n" + tail(feedback, FEEDBACK_TAIL),
      material: [
        { name: "文章与立项卡", text: JSON.stringify({ article: meta, card }), required: true },
        {
          name: "当前工作稿",
          text: current ? await store.readDraft(meta.id, current.rev) : "",
          required: true,
        },
      ],
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
    // Settled lines stay in the ledger, not in every packet: only open lines due soon or touched here.
    foreshadow: foreshadow.lines.filter(
      (line) =>
        line.status !== "committed" &&
        (line.plannedPayoff <= position + DUE_AHEAD ||
          line.beats.some((beat) => beat.chapter === position)),
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
    material: fanqieMaterial({
      meta,
      chapter,
      prev,
      continuity,
      confirmed: structured.facts.filter((fact) => presence.includes(fact.subject)),
      recent: structured.chapters.slice(-3),
      whole: request.kind === "book",
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
