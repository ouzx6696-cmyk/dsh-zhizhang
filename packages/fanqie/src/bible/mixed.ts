/** 同一批次中的大纲与设定集在一个 Intent 内提交。 */
import { bindingWrites } from "../outline/bindings.js";
import { previewData, remapValue, positionFunction } from "../outline/service.js";
import { BibleSnapshotSchema, LedgerEntrySchema } from "./schema.js";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { createIdSource } from "@zhizhang/core/id";
import type { LockService } from "@zhizhang/core/lock";
import { dropUndefined } from "@zhizhang/core/schema";
import { applyOutlineOps } from "../outline/ops.js";
import { nodesOf, outlineWrites, readOutline, validateOutline } from "../outline/store.js";
import { commitSnapshot } from "../outline/transaction.js";
import { applyBibleOp, normalizeBible, validateBible } from "./apply.js";
import { currentRev, isBibleOp } from "./ops.js";
import { pendingFilePath, readIndexOrEmpty, readLib, SNAPSHOT_FILES } from "./read.js";
import { PendingBatchSchema } from "./ops-schema.js";
import type { ChangeSet, CommitResult, PendingBatch, PendingItem } from "./types.js";

export async function commitMixedBatch(
  work: string,
  batch: PendingBatch,
  items: PendingItem[],
  lock: LockService,
  at: string,
  remapToken?: string,
): Promise<CommitResult> {
  const lib = await readLib(work),
    before = await readOutline(work);
  let outline = before;
  const stale: string[] = [],
    applied: PendingItem[] = [],
    failed = new Set(
      batch.items
        .filter((item) => !item.committed && item.decision !== "accept" && item.decision !== "edit")
        .map((item) => item.id),
    );
  for (const item of items) {
    if (item.committed) {
      stale.push(item.id);
      continue;
    }
    if (item.dependsOn.some((id) => failed.has(id))) {
      stale.push(item.id);
      failed.add(item.id);
      continue;
    }
    const op = item.edited ?? item.op;
    const rev = isBibleOp(op)
      ? currentRev(lib, op)
      : op.type === "book.update"
        ? outline.book.rev
        : "id" in op
          ? nodesOf(outline).find(({ node }) => node.id === op.id)?.node.rev
          : undefined;
    if (item.baseRev !== undefined && rev !== item.baseRev) {
      stale.push(item.id);
      failed.add(item.id);
      continue;
    }
    if (isBibleOp(op)) applyBibleOp(lib, op);
    else outline = applyOutlineOps(outline, [op]);
    applied.push(item);
  }
  const outlineOps = applied.flatMap((item) => {
    const op = item.edited ?? item.op;
    return isBibleOp(op) ? [] : [op];
  });
  const data = await previewData(work, before, outline, outlineOps);
  if (remapToken && data.preview.token !== remapToken)
    throw new AppError("storage.conflict", "预览已过期", { reason: "preview_stale" });
  if (data.preview.moves.length && !remapToken)
    throw new AppError("input.invalid", "请确认已写章节的位置变更", {
      reason: "remap_required",
      preview: data.preview,
    });
  if (data.preview.invalid.length)
    throw new AppError("input.invalid", "位置重映射产生无效区间", {
      invalid: data.preview.invalid,
    });
  const remap = positionFunction(before, outline);
  lib.bible = BibleSnapshotSchema(remapValue(lib.bible, remap, [], "states"));
  lib.ledgers = new Map(
    [...lib.ledgers].map(([id, entry]) => [
      id,
      LedgerEntrySchema(remapValue(entry, remap, [], "ledger")),
    ]),
  );
  validateOutline(outline);
  validateBible(lib);
  normalizeBible(lib);
  const entities = new Map(lib.bible.entities.map((entity) => [entity.id, entity]));
  for (const { node } of nodesOf(outline)) {
    for (const id of node.cast ?? [])
      if (!entities.has(id))
        throw new AppError("input.invalid", "大纲引用的实体不存在", { id, rule: "V2-4" });
    if (
      !("acts" in node) &&
      !("chapters" in node) &&
      node.location &&
      entities.get(node.location)?.kind !== "place"
    )
      throw new AppError("input.invalid", "大纲地点引用无效", { rule: "V2-4" });
  }
  const writes = [
    ...(await outlineWrites(work, before, outline)),
    ...(await bindingWrites(work, outline)),
  ];
  const add = async (file: string, after: string | null) => {
    const raw = await readTextIfExists(file);
    writes.push({ path: file, beforeHash: raw === undefined ? null : sha256(raw), after });
  };
  const index = await readIndexOrEmpty(work);
  for (const key of Object.keys(SNAPSHOT_FILES)) {
    if (!(
      key === "entities" ||
      key === "states" ||
      key === "timeline" ||
      key === "knowledge" ||
      key === "threads" ||
      key === "style"
    ))
      continue;
    const body = JSON.stringify(dropUndefined(lib.bible[key]), null, 2);
    const file = path.join(work, "bible", SNAPSHOT_FILES[key]);
    if (body !== (await readTextIfExists(file))) await add(file, body);
    index.files[key] = { rev: index.files[key].rev + 1, hash: sha256(body) };
  }
  for (const entry of lib.ledgers.values())
    await add(
      path.join(work, "bible", "ledger", `${entry.chapter}.json`),
      JSON.stringify(dropUndefined(entry), null, 2),
    );
  index.files.outline = {
    rev: index.files.outline.rev + 1,
    hash: sha256(JSON.stringify([outline.book, ...outline.volumes.values()])),
  };
  await add(path.join(work, "bible", "index.json"), JSON.stringify(index, null, 2));
  const changeId = createIdSource().next("cs");
  for (const item of applied) item.committed = changeId;
  batch.commits.push(changeId);
  batch.status = batch.items.every((item) => item.decision !== "undecided") ? "closed" : "partial";
  await add(
    pendingFilePath(work, batch.id),
    JSON.stringify(PendingBatchSchema(dropUndefined(batch)), null, 2),
  );
  if (batch.source === "import")
    await add(path.join(work, "imports", batch.id, "commits.json"), JSON.stringify(batch.commits));
  const change: ChangeSet = {
    id: changeId,
    at,
    kind: "apply",
    source:
      batch.source === "import"
        ? "import"
        : batch.source === "ledger"
          ? "ledger"
          : batch.source === "plan"
            ? "plan"
            : "assistant",
    batch: batch.id,
    run: batch.run,
    summary: `提交 ${applied.length} 项`,
    ops: applied.map((item) => item.edited ?? item.op),
    inverse: [],
    revs: {},
    files: [],
  };
  await commitSnapshot(work, writes, change, lock);
  return { changeId, committed: applied.length, stale };
}
