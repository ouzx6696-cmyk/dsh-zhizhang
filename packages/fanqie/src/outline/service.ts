import { bindingWrites } from "./bindings.js";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { readTextIfExists, sha256, resolveResourcePath } from "@zhizhang/core/fs";
import { createIdSource } from "@zhizhang/core/id";
import type { IntentWrite } from "@zhizhang/core/journal";
import type { LockService } from "@zhizhang/core/lock";
import { dropUndefined } from "@zhizhang/core/schema";
import { readIndexOrEmpty, readLib } from "../bible/read.js";
import { auditWork } from "../bible/audit-work.js";
import { listChapters } from "../commands/chapter.js";
import { serializeChapterMarkdown } from "../domain/chapter.js";
import { applyOutlineOps } from "./ops.js";
import {
  derivePositions,
  nodesOf,
  outlineView,
  readOutline,
  writeOutline,
  type Outline,
} from "./store.js";
import type { OutlineOp, RemapPreview } from "./types.js";

const POSITION_FIELDS = new Set([
  "since",
  "until",
  "opened",
  "plannedPlant",
  "plannedPayoff",
  "dueBy",
  "chapter",
  "position",
  "introducedAt",
  "retiredAt",
]);
export function remapValue(
  value: unknown,
  map: (n: number) => number,
  affected: RemapPreview["affected"],
  file: RemapPreview["affected"][number]["file"],
  parentId = "",
): unknown {
  if (Array.isArray(value))
    return value.map((entry) => remapValue(entry, map, affected, file, parentId));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  const id = "id" in value && typeof value.id === "string" ? value.id : parentId;
  for (const [key, field] of Object.entries(value)) {
    if (POSITION_FIELDS.has(key) && typeof field === "number") {
      result[key] = map(field);
      if (result[key] !== field)
        affected.push({
          file,
          id,
          label: key,
          field:
            key === "position"
              ? "position"
              : key === "until"
                ? "until"
                : key === "since"
                  ? "since"
                  : key === "opened"
                    ? "opened"
                    : key === "plannedPayoff"
                      ? "plannedPayoff"
                      : key === "dueBy"
                        ? "dueBy"
                        : "chapter",
          from: field,
          to: map(field),
        });
    } else result[key] = remapValue(field, map, affected, file, id);
  }
  if (
    "rev" in value &&
    typeof value.rev === "number" &&
    JSON.stringify(result) !== JSON.stringify(value)
  )
    result.rev = value.rev + 1;
  return result;
}
export function positionFunction(before: Outline, after: Outline) {
  const old = derivePositions(before, []).plans,
    next = derivePositions(after, []).plans;
  const reverse = new Map([...old].map(([id, pos]) => [pos, id]));
  return (position: number) => {
    const id = reverse.get(position);
    if (id && next.has(id)) return next.get(id) ?? position;
    if (position > old.size) return position + next.size - old.size;
    for (let p = position + 1; p <= old.size; p++) {
      const successor = reverse.get(p);
      if (successor && next.has(successor)) return next.get(successor) ?? position;
    }
    return next.size + 1;
  };
}
export async function previewData(work: string, before: Outline, after: Outline, ops: OutlineOp[]) {
  const index = await readIndexOrEmpty(work),
    lib = await readLib(work);
  const map = positionFunction(before, after);
  const affected: RemapPreview["affected"] = [],
    invalid: RemapPreview["invalid"] = [],
    writes: IntentWrite[] = [];
  const values: Array<{
    file: string;
    kind: RemapPreview["affected"][number]["file"];
    value: unknown;
  }> = [
    ...(["entities", "states", "threads", "knowledge", "timeline"] as const).map((kind) => ({
      file: path.join(work, "bible", `${kind}.json`),
      kind: kind === "entities" ? ("states" as const) : kind,
      value: lib.bible[kind],
    })),
    ...[...lib.ledgers.values()].map((entry) => ({
      file: resolveResourcePath(work, "bible", "ledger", `${entry.chapter}.json`),
      kind: "ledger" as const,
      value: entry,
    })),
  ];
  for (const item of values) {
    const remapped = remapValue(
      item.value,
      map,
      affected,
      item.kind,
      path.basename(item.file, ".json"),
    );
    const check = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(check);
        return;
      }
      if (!value || typeof value !== "object") return;
      if (
        "since" in value &&
        "until" in value &&
        typeof value.since === "number" &&
        typeof value.until === "number" &&
        value.until <= value.since
      )
        invalid.push({
          id: "id" in value ? String(value.id) : item.file,
          reason: "until_le_since",
        });
      if (
        "plannedPayoff" in value &&
        "opened" in value &&
        typeof value.plannedPayoff === "number" &&
        typeof value.opened === "number" &&
        value.plannedPayoff < value.opened
      )
        invalid.push({
          id: "id" in value ? String(value.id) : item.file,
          reason: "pay_before_plant",
        });
      Object.values(value).forEach(check);
    };
    check(remapped);
    if (JSON.stringify(remapped) !== JSON.stringify(item.value)) {
      const raw = await readTextIfExists(item.file);
      writes.push({
        path: item.file,
        beforeHash: raw === undefined ? null : sha256(raw),
        after: JSON.stringify(dropUndefined(remapped), null, 2),
      });
    }
  }
  const oldPositions = derivePositions(before, []).plans,
    nextPositions = derivePositions(after, []).plans;
  const rows = await listChapters(work);
  const written = new Set(rows.filter((row) => row.status !== "planned").map((row) => row.id));
  const moves = nodesOf(before).flatMap(({ node, level }) => {
    if (
      level !== "chapter" ||
      !("chapterId" in node) ||
      !node.chapterId ||
      !written.has(node.chapterId)
    )
      return [];
    const from = oldPositions.get(node.id) ?? 0,
      to = nextPositions.get(node.id) ?? nextPositions.size + 1;
    return from !== to ? [{ id: node.id, title: node.title, from, to }] : [];
  });
  const token = sha256(JSON.stringify([index.files, before.book.rev, [...before.volumes], ops]));
  return { preview: { moves, affected, invalid, token }, writes };
}
export function createOutlineStore(lock: LockService) {
  async function get(work: string) {
    const [outline, rows, index] = await Promise.all([
      readOutline(work),
      listChapters(work),
      readIndexOrEmpty(work),
    ]);
    let lastPosition = 0;
    for (const position of derivePositions(outline, rows).plans.values())
      lastPosition = Math.max(lastPosition, position);
    const findings = await auditWork(work, lastPosition);
    return outlineView(outline, rows, index.files.outline.rev, findings);
  }
  async function preview(work: string, ops: OutlineOp[]) {
    return lock.write({ kind: "work", path: work }, async () => {
      const before = await readOutline(work),
        after = applyOutlineOps(before, ops);
      return (await previewData(work, before, after, ops)).preview;
    });
  }
  async function apply(
    work: string,
    ops: OutlineOp[],
    expectedRev?: number,
    token?: string,
    extra: IntentWrite[] = [],
  ) {
    return lock.write({ kind: "work", path: work }, async () => {
      const index = await readIndexOrEmpty(work);
      if (expectedRev !== undefined && index.files.outline.rev !== expectedRev)
        throw new AppError("storage.conflict", "大纲版本已变化");
      const before = await readOutline(work),
        after = applyOutlineOps(before, ops);
      const data = await previewData(work, before, after, ops);
      if (token && token !== data.preview.token)
        throw new AppError("storage.conflict", "预览已过期", { reason: "preview_stale" });
      if (data.preview.moves.length && !token)
        throw new AppError("input.invalid", "已写章节位置改变，请先确认重映射", {
          reason: "remap_required",
        });
      if (data.preview.invalid.length)
        throw new AppError("input.invalid", "位置重映射产生无效区间", {
          invalid: data.preview.invalid,
        });
      const lib = await readLib(work),
        entities = new Map(lib.bible.entities.map((entity) => [entity.id, entity]));
      for (const { node, level } of nodesOf(after)) {
        for (const id of node.cast ?? [])
          if (!entities.has(id))
            throw new AppError("input.invalid", "人物引用不存在", {
              path: node.id,
              rule: "V2-4",
              id,
            });
        if (level === "chapter" && !("acts" in node) && !("chapters" in node)) {
          if (node.pov && !entities.has(node.pov))
            throw new AppError("input.invalid", "视角引用不存在", { rule: "V2-4" });
          if (node.location && entities.get(node.location)?.kind !== "place")
            throw new AppError("input.invalid", "地点引用须为地点", { rule: "V2-4" });
        }
      }
      extra.push(...(await bindingWrites(work, after, extra)));
      const result = await writeOutline(work, before, after, lock, [...extra, ...data.writes]);
      return { ...result, remapped: data.preview.affected.length };
    });
  }
  async function createFromPlan(work: string, plan: string) {
    return lock.write({ kind: "work", path: work }, async () => {
      const outline = await readOutline(work),
        ref = nodesOf(outline).find(({ node }) => node.id === plan);
      if (!ref || ref.level !== "chapter" || "acts" in ref.node || "chapters" in ref.node)
        throw new AppError("input.not_found", "未找到章纲");
      if (ref.node.chapterId) throw new AppError("input.invalid", "章纲已绑定正文");
      const chapterId = createIdSource().next("ch"),
        file = resolveResourcePath(work, "chapters", `${chapterId}.md`);
      const body = ref.node.summary ?? "";
      await apply(work, [{ type: "chapter.bind", plan, chapterId }], undefined, undefined, [
        {
          path: file,
          beforeHash: null,
          after: serializeChapterMarkdown({
            meta: {
              id: chapterId,
              outlineId: plan,
              title: ref.node.title,
              revision: `rev-${sha256(body).slice(0, 8)}`,
              status: "planned",
            },
            body,
          }),
        },
      ]);
      const row = (await listChapters(work)).find((item) => item.id === chapterId);
      if (!row) throw new AppError("internal", "正文创建后未出现在索引中");
      return { chapterId, row };
    });
  }
  return { get, apply, preview, createFromPlan };
}
