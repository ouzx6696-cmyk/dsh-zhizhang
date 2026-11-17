import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { readTextIfExists, resolveResourcePath, sha256 } from "@zhizhang/core/fs";
import { type IntentWrite } from "@zhizhang/core/journal";
import { createIdSource } from "@zhizhang/core/id";
import type { LockService } from "@zhizhang/core/lock";
import { dropUndefined, type Parser } from "@zhizhang/core/schema";
import { commitSnapshot } from "./transaction.js";
import { BookFileSchema, VolumeFileSchema } from "./schema.js";
import { readIndexOrEmpty } from "../bible/read.js";
import type { BookFile, VolumeFile, ChapterPlan, Act, OutlineView } from "./types.js";
import type { AuditFinding } from "../bible/types.js";

export interface Outline {
  book: BookFile;
  volumes: Map<string, VolumeFile>;
}
export interface NodeRef {
  node: VolumeFile | Act | ChapterPlan;
  level: "volume" | "act" | "chapter";
  parent?: string;
}
export function nodesOf(outline: Outline): NodeRef[] {
  const result: NodeRef[] = [];
  for (const id of outline.book.volumeOrder) {
    const volume = outline.volumes.get(id);
    if (!volume) throw new AppError("storage.format_unsupported", "卷目录与文件不一致", { id });
    result.push({ node: volume, level: "volume" });
    for (const act of volume.acts) {
      result.push({ node: act, level: "act", parent: id });
      for (const chapter of act.chapters)
        result.push({ node: chapter, level: "chapter", parent: act.id });
    }
  }
  return result;
}
export function copyOutline(outline: Outline): Outline {
  return {
    book: structuredClone(outline.book),
    volumes: new Map([...outline.volumes].map(([id, v]) => [id, structuredClone(v)])),
  };
}
export async function readOutline(work: string): Promise<Outline> {
  async function read<T>(file: string, parser: Parser<T>): Promise<T> {
    const raw = await readTextIfExists(file);
    if (raw === undefined)
      throw new AppError("storage.format_unsupported", "缺少大纲真源文件", { file });
    try {
      return parser(JSON.parse(raw));
    } catch {
      throw new AppError("storage.format_unsupported", "大纲文件格式不受支持", { file });
    }
  }
  const book = await read(resolveResourcePath(work, "outline", "book.json"), BookFileSchema);
  const dir = path.join(work, "outline", "volumes");
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  const expected = new Set(book.volumeOrder.map((id) => `${id}.json`));
  if (files.length !== expected.size || files.some((file) => !expected.has(file)))
    throw new AppError("storage.format_unsupported", "卷目录与卷文件不一致", {
      expected: [...expected],
      actual: files,
    });
  const volumes = new Map<string, VolumeFile>();
  for (const id of book.volumeOrder) {
    const volume = await read(
      resolveResourcePath(work, "outline", "volumes", `${id}.json`),
      VolumeFileSchema,
    );
    if (volume.id !== id)
      throw new AppError("storage.format_unsupported", "卷标识与文件名不一致", { id });
    volumes.set(id, volume);
  }
  return { book, volumes };
}
export function validateOutline(outline: Outline): void {
  BookFileSchema(dropUndefined(outline.book));
  const ids = new Set<string>(),
    chapters = new Set<string>();
  for (const { node, level } of nodesOf(outline)) {
    const prefix = level === "volume" ? "vol" : level === "act" ? "act" : "pl";
    if (!new RegExp(`^${prefix}-[0-9a-hjkmnp-tv-z]{8}$`, "i").test(node.id) || ids.has(node.id))
      throw new AppError("input.invalid", "节点标识无效或重复", { path: node.id, rule: "V2-1" });
    ids.add(node.id);
    if ("chapterId" in node && node.chapterId) {
      if (chapters.has(node.chapterId))
        throw new AppError("input.invalid", "正文不能绑定多个章纲", {
          path: node.id,
          rule: "V2-3",
        });
      chapters.add(node.chapterId);
    }
  }
  for (const volume of outline.volumes.values()) VolumeFileSchema(dropUndefined(volume));
}
export function derivePositions(outline: Outline, rows: Array<{ id: string }>) {
  const plans = new Map<string, number>(),
    chapters = new Map<string, number>();
  let position = 0;
  for (const { node, level } of nodesOf(outline))
    if (level === "chapter") {
      plans.set(node.id, ++position);
      if ("chapterId" in node && node.chapterId) chapters.set(node.chapterId, position);
    }
  const unplaced = rows
    .filter((row) => !chapters.has(row.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const row of unplaced) chapters.set(row.id, ++position);
  return { plans, chapters, unplaced: unplaced.map((row) => row.id) };
}
export function outlineView(
  outline: Outline,
  rows: Array<{ id: string; title: string; status: string; wordCount: number }>,
  rev: number,
  findings: AuditFinding[] = [],
): OutlineView {
  const positions = derivePositions(outline, rows);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const refs = nodesOf(outline),
    childrenByParent = new Map<string, NodeRef[]>();
  for (const ref of refs) {
    if (!ref.parent) continue;
    const children = childrenByParent.get(ref.parent);
    if (children) children.push(ref);
    else childrenByParent.set(ref.parent, [ref]);
  }
  const metrics = new Map<
    string,
    { target: number; final: number; total: number; findings: number }
  >();
  for (const ref of [...refs].reverse()) {
    const { node, level } = ref;
    if (level === "chapter") {
      const position = positions.plans.get(node.id);
      const row = "chapterId" in node && node.chapterId ? byId.get(node.chapterId) : undefined;
      const findingCount = findings.filter(
        (finding) =>
          finding.refId === node.id ||
          finding.jump.id === node.id ||
          (position !== undefined && finding.position === position),
      ).length;
      metrics.set(node.id, {
        target: node.wordTarget ?? 0,
        final: row?.status === "final" ? 1 : 0,
        total: 1,
        findings: findingCount,
      });
      continue;
    }
    const children = childrenByParent.get(node.id) ?? [];
    const childMetrics = children.flatMap(({ node: child }) => {
      const item = metrics.get(child.id);
      return item ? [item] : [];
    });
    metrics.set(node.id, {
      target: childMetrics.reduce((sum, item) => sum + item.target, 0) || node.wordTarget || 0,
      final: childMetrics.reduce((sum, item) => sum + item.final, 0),
      total: childMetrics.reduce((sum, item) => sum + item.total, 0),
      findings:
        childMetrics.reduce((sum, item) => sum + item.findings, 0) +
        Number(
          findings.some((finding) => finding.refId === node.id || finding.jump.id === node.id),
        ),
    });
  }
  return {
    book: outline.book,
    rev,
    unplaced: rows
      .filter((row) => positions.unplaced.includes(row.id))
      .map((row) => ({ chapterId: row.id, title: row.title, status: row.status })),
    nodes: refs.map(({ node, level, parent }) => {
      const chapterId = "chapterId" in node ? node.chapterId : undefined;
      const row = chapterId ? byId.get(chapterId) : undefined;
      const summary = metrics.get(node.id);
      return {
        id: node.id,
        level,
        parent,
        title: node.title,
        planStatus: node.planStatus,
        rev: node.rev,
        position: positions.plans.get(node.id),
        chapterId,
        chapterStatus: row?.status,
        wordCount: row?.wordCount,
        wordTargetRollup: summary?.target || undefined,
        progress: summary?.total ? { final: summary.final, total: summary.total } : undefined,
        findings: summary?.findings ?? 0,
      };
    }),
  };
}
export async function outlineWrites(
  work: string,
  before: Outline,
  after: Outline,
): Promise<IntentWrite[]> {
  const files = new Map<string, string | null>();
  files.set(
    path.join(work, "outline", "book.json"),
    JSON.stringify(dropUndefined(after.book), null, 2),
  );
  for (const id of new Set([...before.volumes.keys(), ...after.volumes.keys()])) {
    const volume = after.volumes.get(id);
    files.set(
      resolveResourcePath(work, "outline", "volumes", `${id}.json`),
      volume ? JSON.stringify(dropUndefined(volume), null, 2) : null,
    );
  }
  return Promise.all(
    [...files].map(async ([file, content]) => ({
      path: file,
      beforeHash: await readTextIfExists(file).then((raw) =>
        raw === undefined ? null : sha256(raw),
      ),
      after: content,
    })),
  );
}
export async function writeOutline(
  work: string,
  before: Outline,
  after: Outline,
  lock: LockService,
  extra: IntentWrite[] = [],
  meta: Record<string, string> = {},
) {
  validateOutline(after);
  const index = await readIndexOrEmpty(work);
  const old = index.files.outline;
  const writes = await outlineWrites(work, before, after);
  index.files.outline = {
    rev: old.rev + 1,
    hash: sha256(JSON.stringify(dropUndefined([after.book, ...after.volumes.values()]))),
  };
  for (const write of extra)
    for (const key of [
      "entities",
      "timeline",
      "states",
      "threads",
      "knowledge",
      "style",
    ] as const) {
      if (write.path === path.join(work, "bible", `${key}.json`))
        index.files[key] = { rev: index.files[key].rev + 1, hash: sha256(write.after ?? "") };
    }
  const file = path.join(work, "bible", "index.json");
  const raw = await readTextIfExists(file);
  writes.push(
    {
      path: file,
      beforeHash: raw === undefined ? null : sha256(raw),
      after: JSON.stringify(index, null, 2),
    },
    ...extra,
  );
  const changeId = createIdSource().next("cs");
  await commitSnapshot(
    work,
    writes,
    {
      id: changeId,
      at: new Date().toISOString(),
      kind: "apply",
      source: "author",
      summary: meta.summary ?? "大纲操作与位置变更",
      ops: [],
      inverse: [],
      revs: {},
      files: [],
    },
    lock,
  );
  return { changeId, rev: index.files.outline.rev };
}
