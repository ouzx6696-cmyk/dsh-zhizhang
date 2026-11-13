import { pursuitLedger } from "./pursuit";
import { readContinuity } from "./continuity";
import { sha256 } from "../../../../packages/core/src/fsx";
import {
  findChapter,
  readChapter,
  readChapterLenses,
} from "../../../../packages/fanqie/src/engine/storage/chapters";
import { readWorkMeta } from "../../../../packages/fanqie/src/engine/storage/work-meta";
import {
  readForeshadow,
  readKnowledge,
} from "../../../../packages/fanqie/src/engine/storage/continuity";
import { readPlanning } from "../../../../packages/fanqie/src/engine/domain/planning";
import type { Chapter } from "../../../../packages/fanqie/src/engine/types";
import { resolveFanqieWork } from "../main/storage";
import type { WorkflowHost } from "./host";
import type { Target } from "../context";
import type { ContextBlock, WorkflowRequest } from "../../../../packages/core/src/workflow";

/** Open foreshadow lines whose payoff falls within this many chapters ahead are shown to the stage. */
const DUE_AHEAD = 3;
/** Tail kept from free-text foundation fields that grow with every finalized chapter. */
const FOUNDATION_TAIL = 3000;
const RECENT_TOC = 20;
function tail(value: string, max: number) {
  return value.length > max ? `（前文略）…${value.slice(-max)}` : value;
}
function head(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…（后文略）` : value;
}
type Meta = Awaited<ReturnType<typeof readWorkMeta>>;
function chapterDirectory(meta: Meta) {
  return meta.chapters.map(({ id, title, position, status }) => ({ id, title, position, status }));
}
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
  previousTail: number;
  previousSummary: string;
}): ContextBlock[] {
  const { meta, chapter, prev, whole } = input;
  const planning = readPlanning(meta) ?? undefined;
  const groups = planning
    ? [...planning.volumes, ...planning.acts].filter(
        (group) => whole || (chapter !== undefined && group.chapters.includes(chapter.id)),
      )
    : [];
  const foundation = meta.foundation;
  const toc = chapterDirectory(meta);
  return [
    { name: "本章", text: chapter ? JSON.stringify(chapter) : "", required: true },
    {
      name: "前章结尾",
      text: prev
        ? `《${prev.title}》\n${input.previousSummary ? "前章摘要：" + input.previousSummary + "\n" : ""}${prev.body.slice(-input.previousTail)}`
        : "",
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
/**
 * The book state a fanqie run depends on. Built once for the basis and again for every freshness
 * check, so the two use the same fields.
 */
function fanqieDocument(
  meta: Meta,
  chapter: Pick<Chapter, "revision" | "title" | "status"> | undefined,
  previous: Pick<Chapter, "revision" | "title" | "status"> | undefined,
) {
  return {
    book: {
      title: meta.title,
      genre: meta.genre,
      premise: meta.premise,
      pace: meta.pace,
      chapters: chapterDirectory(meta),
    },
    ...(meta.readingBenchmark === undefined ? {} : { readingBenchmark: meta.readingBenchmark }),
    chapter: chapter && {
      revision: chapter.revision,
      title: chapter.title,
      status: chapter.status,
    },
    previous: previous && {
      revision: previous.revision,
      title: previous.title,
      status: previous.status,
    },
  };
}
export async function fanqieContextData(
  host: WorkflowHost,
  target: Target,
  request: WorkflowRequest,
  author: string,
  identity: object,
) {
  const enabled = host.options.fanqie?.pursuit?.enabled === true;
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
  const structured = await readContinuity(dir);
  const readPursuit = async (current: Meta, state: Awaited<ReturnType<typeof readContinuity>>) => {
    const candidates = state.chapters.filter((row) =>
      current.chapters.some((chapter) => chapter.id === row.id && chapter.status === "final"),
    );
    const lenses = await readChapterLenses(
      dir,
      candidates.map((row) => row.id),
    );
    const versions = lenses.map((row) => {
      if (row.lens === undefined)
        throw new Error(`追读账本关联章节无法读取：${row.id} ${row.error}`);
      return [row.id, row.lens.revision];
    });
    const rows = candidates.filter(
      (row, index) => row.pursuit !== undefined && row.revision === versions[index][1],
    );
    return { rows, versions };
  };
  const pursuit = enabled ? await readPursuit(meta, structured) : undefined;
  const auditChapter = structured.chapters.find((row) => row.id === structured.audit?.chapter);
  const audit =
    pursuit !== undefined &&
    pursuit.rows.length === structured.chapters.filter((row) => row.pursuit !== undefined).length &&
    structured.audit !== undefined &&
    structured.audit.sources !== undefined &&
    structured.audit.sources.every((source) =>
      pursuit.versions.some(([id, revision]) => source.id === id && source.revision === revision),
    ) &&
    auditChapter?.position !== undefined &&
    auditChapter.position < position &&
    position <= auditChapter.position + 5 &&
    pursuit.rows.some(
      (row) => row.id === structured.audit?.chapter && row.hash === structured.audit.hash,
    )
      ? structured.audit
      : undefined;
  const readingLedger =
    pursuit === undefined
      ? undefined
      : pursuitLedger(
          pursuit.rows,
          position,
          chapter?.outline.unit,
          meta.chapters.filter((row) => row.status === "final" && row.position < position).length,
        );
  const result = {
    stable: JSON.stringify({
      title: meta.title,
      genre: meta.genre,
      premise: meta.premise,
      ...(enabled && meta.readingBenchmark
        ? { readingTargets: meta.readingBenchmark.targets }
        : {}),
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
      previousTail: enabled ? 1500 : 800,
      previousSummary:
        enabled && prev
          ? (structured.chapters.find((row) => row.id === prev.id && row.hash === sha256(prev.body))
              ?.summary ?? "")
          : "",
    }).concat(
      pursuit === undefined
        ? []
        : [
            {
              name: "当前与下一单元规划",
              text: JSON.stringify(readPlanning(meta)?.units ?? []),
              required: true,
            },
            {
              name: "追读账本（仅有效定稿）",
              text: JSON.stringify(readingLedger),
              required: true,
            },
            {
              name: "十章体检的后续规划建议",
              text:
                audit === undefined
                  ? ""
                  : JSON.stringify({
                      chapter: audit.chapter,
                      risks: audit.risks,
                      forgotten: audit.forgotten,
                      rhythm: audit.rhythm,
                      constraints: audit.constraints,
                    }),
              required: true,
            },
          ],
    ),
    chapterPosition: position,
    pace: meta.pace,
    readingBenchmark: meta.readingBenchmark,
    readingLedger,
    pursuitSources: pursuit?.versions.map(([id, revision]) => ({ id, revision })),
  };
  const basis = JSON.stringify({
    document: fanqieDocument(meta, chapter, prev),
    stable: result.stable,
    material: result.material,
    ...(pursuit === undefined ? {} : { pursuitVersions: pursuit.versions }),
    identity,
  });
  return { ...result, basis, sourceHash: sha256(basis) };
}
