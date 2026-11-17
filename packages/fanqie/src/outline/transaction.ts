import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { readTextIfExists, resolveInside, sha256 } from "@zhizhang/core/fs";
import { commitIntent, type IntentWrite } from "@zhizhang/core/journal";
import { createIdSource } from "@zhizhang/core/id";
import type { LockService } from "@zhizhang/core/lock";
import type { ChangeSet, RevertResult } from "../bible/types.js";
import { readIndexOrEmpty } from "../bible/read.js";

export async function commitSnapshot(
  work: string,
  writes: IntentWrite[],
  change: ChangeSet,
  lock: LockService,
) {
  change.snapshots = await Promise.all(
    writes.map(async (write) => ({
      file: path.relative(work, write.path).split(path.sep).join("/"),
      before: (await readTextIfExists(write.path)) ?? null,
      after: write.after,
    })),
  );
  change.files = change.snapshots.map((entry) => entry.file);
  const file = path.join(work, "bible", "changes", `${change.at.slice(0, 7)}.jsonl`);
  const old = (await readTextIfExists(file)) ?? "";
  writes.push({
    path: file,
    beforeHash: old ? sha256(old) : null,
    after: old + JSON.stringify(change) + "\n",
  });
  await commitIntent(
    path.join(work, ".journal"),
    {
      format: "zhizhang/1.3",
      id: change.id,
      writes,
      meta: { kind: change.kind, source: change.source },
    },
    lock,
    { kind: "work", path: work },
  );
}
export async function revertSnapshot(
  work: string,
  source: ChangeSet,
  force: boolean,
  lock: LockService,
): Promise<RevertResult> {
  if (!source.snapshots) throw new AppError("input.invalid", "变更集没有文件快照");
  if (!force) {
    const changed = [];
    for (const snapshot of source.snapshots) {
      if (snapshot.file === "bible/index.json") continue;
      const raw = (await readTextIfExists(resolveInside(work, snapshot.file))) ?? null;
      if (raw !== snapshot.after)
        changed.push({
          target: snapshot.file,
          reason: raw === null ? ("missing" as const) : ("rev_changed" as const),
        });
    }
    if (changed.length) return { changeIds: [], skipped: changed };
  }
  const skipped: RevertResult["skipped"] = [],
    writes: IntentWrite[] = [];
  for (const snapshot of source.snapshots) {
    if (snapshot.file === "bible/index.json") continue;
    const file = resolveInside(work, snapshot.file);
    const raw = (await readTextIfExists(file)) ?? null;
    if (!force && raw !== snapshot.after) {
      skipped.push({ target: snapshot.file, reason: raw === null ? "missing" : "rev_changed" });
      continue;
    }
    writes.push({
      path: file,
      beforeHash: raw === null ? null : sha256(raw),
      after: snapshot.before,
    });
  }
  if (!writes.length) return { changeIds: [], skipped };
  const index = await readIndexOrEmpty(work);
  for (const key of ["entities", "timeline", "states", "threads", "knowledge", "style"] as const) {
    const write = writes.find((item) => path.relative(work, item.path) === `bible/${key}.json`);
    if (!write) continue;
    index.files[key].rev++;
    index.files[key].hash = sha256(write.after ?? "");
  }
  const outlineFiles = writes.filter((item) => item.path.includes(`${path.sep}outline${path.sep}`));
  if (outlineFiles.length) {
    const bookWrite = outlineFiles.find((item) => path.basename(item.path) === "book.json");
    if (!bookWrite?.after) throw new AppError("storage.format_unsupported", "撤销快照缺少书目录");
    const book = JSON.parse(bookWrite.after) as { volumeOrder: string[] };
    const volumes = book.volumeOrder.map((id) => {
      const write = outlineFiles.find((item) => path.basename(item.path) === `${id}.json`);
      if (!write?.after)
        throw new AppError("storage.format_unsupported", "撤销快照缺少卷文件", { id });
      return JSON.parse(write.after) as unknown;
    });
    index.files.outline.rev++;
    index.files.outline.hash = sha256(JSON.stringify([JSON.parse(bookWrite.after), ...volumes]));
  }
  const file = path.join(work, "bible", "index.json"),
    raw = await readTextIfExists(file);
  writes.push({
    path: file,
    beforeHash: raw === undefined ? null : sha256(raw),
    after: JSON.stringify(index, null, 2),
  });
  const change: ChangeSet = {
    id: createIdSource().next("cs"),
    at: new Date().toISOString(),
    kind: "revert",
    reverts: source.id,
    source: "author",
    batch: source.batch,
    summary: `撤销 ${source.id}`,
    ops: [],
    inverse: [],
    revs: {},
    files: [],
  };
  await commitSnapshot(work, writes, change, lock);
  return { changeIds: [change.id], skipped };
}
