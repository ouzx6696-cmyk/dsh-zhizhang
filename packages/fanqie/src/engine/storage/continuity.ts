/**
 * continuity/ 目录读写（T10）：foreshadow.json / knowledge.json / commits.json / handoff/<章id>.json。
 * 复用 core 的 atomicWrite 与 readText，不另写序列化；文件级 revision 冲突如实报错。
 * 读取不建目录、不建文件；只有 save 路径 mkdir。开关关闭时调用方不得触碰这里。
 */
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { NovelError } from "../errors.js";
import { readText } from "../../../../core/src/fsx.js";
import type {
  CommitsFile,
  ContinuityCommitRecord,
  ForeshadowFile,
  ForeshadowLine,
  HandoffRecord,
  KnowledgeFile,
  KnowledgeItem,
} from "../types.js";
import { assertNoPendingAccept } from "./accept-journal.js";
import { createWorkRecordJournal, finishChapterJournal } from "./chapter-journal.js";
import { snapshotFile } from "./journal.js";
import { withResourceLock } from "./process-lock.js";
import { atomicWrite, assertResourceId, nowIso } from "./primitives.js";

function continuityDir(dir: string) {
  return path.join(dir, "continuity");
}
function handoffDir(dir: string) {
  return path.join(continuityDir(dir), "handoff");
}
const foreshadowFile = (dir: string) => path.join(continuityDir(dir), "foreshadow.json");
const knowledgeFile = (dir: string) => path.join(continuityDir(dir), "knowledge.json");
const commitsFile = (dir: string) => path.join(continuityDir(dir), "commits.json");
const handoffFile = (dir: string, chapterId: string) =>
  path.join(handoffDir(dir), `${assertResourceId(chapterId, "章节 id")}.json`);

const EMPTY_FORESHADOW = (): ForeshadowFile => ({
  schemaVersion: 1,
  revision: 0,
  updatedAt: "",
  lines: [],
});
const EMPTY_KNOWLEDGE = (): KnowledgeFile => ({
  schemaVersion: 1,
  revision: 0,
  updatedAt: "",
  items: [],
});
const EMPTY_COMMITS = (): CommitsFile => ({
  schemaVersion: 1,
  revision: 0,
  updatedAt: "",
  commits: [],
});

/** 解析 continuity JSON；文件损坏是错误，不当作空数据（与 parseWorkMeta 同一口径）。 */
function parseContinuityJson<T extends { schemaVersion: 1; revision: number; updatedAt: string }>(
  raw: string,
  file: string,
  listKey: "lines" | "items" | "commits",
): T {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new NovelError("bad_continuity", `连续性数据不是合法 JSON：${path.basename(file)}`);
  }
  const record = data as T;
  const list = (record as Record<string, unknown> | null)?.[listKey];
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    record.schemaVersion !== 1 ||
    typeof record.revision !== "number" ||
    !Number.isInteger(record.revision) ||
    record.revision < 0 ||
    !Array.isArray(list)
  )
    throw new NovelError(
      "bad_continuity",
      `连续性数据格式损坏：${path.basename(file)}（缺 schemaVersion/revision 或列表字段）`,
    );
  return record;
}

async function readContinuityFile<
  T extends { schemaVersion: 1; revision: number; updatedAt: string },
>(file: string, empty: () => T, listKey: "lines" | "items" | "commits"): Promise<T> {
  const raw = await readText(file);
  if (raw === undefined) return empty();
  return parseContinuityJson<T>(raw, file, listKey);
}

/**
 * 带文件级 revision 的写入：expectedRevision 与当前盘上 revision 不符时报冲突。
 * 新文件从 revision 1 开始；返回写入后的记录（revision 已自增）。
 */
async function writeContinuityFile<
  T extends { schemaVersion: 1; revision: number; updatedAt: string },
>(file: string, current: T, next: T, expectedRevision: number | undefined): Promise<T> {
  if (expectedRevision !== undefined && expectedRevision !== current.revision)
    throw new NovelError(
      "revision_conflict",
      `continuity/${path.basename(file)} 已被其他写入更新（盘上 revision ${current.revision}，本次基于 ${expectedRevision}），请重读后再试。`,
    );
  next.revision = current.revision + 1;
  next.updatedAt = nowIso();
  await mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, JSON.stringify(next, null, 2) + "\n");
  return next;
}

export async function readForeshadow(dir: string): Promise<ForeshadowFile> {
  await assertNoPendingAccept(dir);
  return readContinuityFile<ForeshadowFile>(foreshadowFile(dir), EMPTY_FORESHADOW, "lines");
}
export async function saveForeshadow(
  dir: string,
  lines: ForeshadowLine[],
  expectedRevision?: number,
): Promise<ForeshadowFile> {
  return withResourceLock(dir, async () => {
    const current = await readForeshadow(dir);
    return writeContinuityFile(
      foreshadowFile(dir),
      current,
      { ...current, lines },
      expectedRevision,
    );
  });
}
export async function readKnowledge(dir: string): Promise<KnowledgeFile> {
  await assertNoPendingAccept(dir);
  return readContinuityFile<KnowledgeFile>(knowledgeFile(dir), EMPTY_KNOWLEDGE, "items");
}
export async function saveKnowledge(
  dir: string,
  items: KnowledgeItem[],
  expectedRevision?: number,
): Promise<KnowledgeFile> {
  return withResourceLock(dir, async () => {
    const current = await readKnowledge(dir);
    return writeContinuityFile(
      knowledgeFile(dir),
      current,
      { ...current, items },
      expectedRevision,
    );
  });
}
export async function readCommits(dir: string): Promise<CommitsFile> {
  await assertNoPendingAccept(dir);
  return readContinuityFile<CommitsFile>(commitsFile(dir), EMPTY_COMMITS, "commits");
}
export async function readHandoff(
  dir: string,
  chapterId: string,
): Promise<HandoffRecord | undefined> {
  await assertNoPendingAccept(dir);
  const raw = await readText(handoffFile(dir, chapterId));
  if (raw === undefined) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new NovelError("bad_continuity", `章末交接不是合法 JSON：handoff/${chapterId}.json`);
  }
  const record = data as HandoffRecord;
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    record.chapter !== chapterId ||
    !Array.isArray(record.mustCarry) ||
    !Array.isArray(record.nextConstraints) ||
    !Array.isArray(record.openLoops) ||
    typeof record.revision !== "number"
  )
    throw new NovelError("bad_continuity", `章末交接格式损坏：handoff/${chapterId}.json`);
  return record;
}
/** Commit the three continuity views through the existing work journal. */
export async function commitContinuity(
  dir: string,
  input: {
    lines?: ForeshadowLine[];
    foreshadowRevision: number;
    handoff: Omit<HandoffRecord, "revision">;
    handoffRevision: number;
    commits: ContinuityCommitRecord[];
    commitsRevision: number;
  },
) {
  return withResourceLock(dir, async () => {
    await assertNoPendingAccept(dir);
    const chapterId = assertResourceId(input.handoff.chapter, "章节 id");
    const files = [
      ...(input.lines ? ["continuity/foreshadow.json"] : []),
      `continuity/handoff/${chapterId}.json`,
      "continuity/commits.json",
    ];
    const before = await Promise.all(files.map((file) => snapshotFile(path.join(dir, file))));
    const [foreshadow, handoff, commits] = await Promise.all([
      readForeshadow(dir),
      readHandoff(dir, chapterId),
      readCommits(dir),
    ]);
    if (
      foreshadow.revision !== input.foreshadowRevision ||
      (handoff?.revision ?? 0) !== input.handoffRevision ||
      commits.revision !== input.commitsRevision
    )
      throw new NovelError("revision_conflict", "连续性数据已变化，请重新核验后提交。");
    const at = nowIso();
    const values = [
      ...(input.lines
        ? [{ ...foreshadow, lines: input.lines, revision: foreshadow.revision + 1, updatedAt: at }]
        : []),
      { ...input.handoff, revision: input.handoffRevision + 1 },
      { ...commits, commits: input.commits, revision: commits.revision + 1, updatedAt: at },
    ];
    const id = await createWorkRecordJournal(dir, {
      kind: "continuity",
      chapterId,
      writes: files.map((file, index) => ({
        file,
        before: before[index],
        content: JSON.stringify(values[index], null, 2) + "\n",
      })),
    });
    await finishChapterJournal(dir, id);
  });
}

/** 列出全部章末交接（按文件名，即章 id 排序）。 */
export async function listHandoffs(dir: string): Promise<HandoffRecord[]> {
  await assertNoPendingAccept(dir);
  let names: string[];
  try {
    names = await readdir(handoffDir(dir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: HandoffRecord[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const record = await readHandoff(dir, name.replace(/\.json$/, ""));
    if (record) records.push(record);
  }
  return records;
}

/** 简报投影（formatReaderContract 的 continuity 输入）；作品还没有任何连续性数据时返回 null。 */
interface ContinuityBriefProjection {
  handoff: HandoffRecord | null;
  plannedBeats: Array<{ lineId: string; title: string; beat: ForeshadowLine["beats"][number] }>;
  knowledge: KnowledgeItem[];
}
/**
 * 收集本章简报投影：上章 handoff、计划落在本章的 beats、出场人物相关的知识条目。
 * presenceText 由调用方给（正文 + 章纲 pov/knowledge 等在场文本）；无在场数据时只保留 beats 与 handoff。
 */
export async function collectContinuityBrief(
  dir: string,
  opts: { position: number; previousChapterId?: string; presenceText?: string },
): Promise<ContinuityBriefProjection | null> {
  const [foreshadow, knowledge, handoff] = await Promise.all([
    readForeshadow(dir),
    readKnowledge(dir),
    opts.previousChapterId ? readHandoff(dir, opts.previousChapterId) : Promise.resolve(undefined),
  ]);
  const plannedBeats = foreshadow.lines.flatMap((line) =>
    line.beats
      .filter((beat) => beat.chapter === opts.position)
      .map((beat) => ({ lineId: line.id, title: line.title, beat })),
  );
  const presence = opts.presenceText ?? "";
  const related =
    presence.trim().length > 0
      ? knowledge.items.filter((item) => item.holders.some((h) => presence.includes(h.who)))
      : [];
  if (!plannedBeats.length && !related.length && !handoff) return null;
  return { handoff: handoff ?? null, plannedBeats, knowledge: related };
}
