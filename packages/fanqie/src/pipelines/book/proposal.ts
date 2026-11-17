import { readPendingBatches, pendingFilePath } from "../../bible/read.js";
import path from "node:path";
import { atomicWrite, readTextIfExists, resolveResourcePath } from "@zhizhang/core/fs";
import { createIdSource } from "@zhizhang/core/id";
import { systemClock } from "@zhizhang/core/clock";
import type { LockService } from "@zhizhang/core/lock";
import { PendingBatchSchema } from "../../bible/ops-schema.js";
import { readOutline } from "../../outline/store.js";
import type { AnyOp, PendingItem, Provenance } from "../../bible/types.js";
import type { BookPlanResult } from "./index.js";

export async function proposeBookPlan(
  work: string,
  run: string,
  plan: BookPlanResult,
  lock: LockService,
) {
  return lock.write({ kind: "work", path: work }, async () => {
    const existing = (await readPendingBatches(work)).find(
      (batch) => batch.source === "plan" && batch.run === run,
    );
    if (existing)
      return {
        backupDir: path.join(work, ".cache", "planning"),
        backedUpFiles: [],
        writtenPlanFiles: [pendingFilePath(work, existing.id)],
      };
    const receipt = resolveResourcePath(work, ".cache", "planning", `${run}.json`),
      previous = await readTextIfExists(receipt);
    if (previous)
      return {
        backupDir: path.dirname(receipt),
        backedUpFiles: [],
        writtenPlanFiles: [JSON.parse(previous).file],
      };
    const ids = createIdSource(),
      batch = ids.next("pln"),
      provenance: Provenance = { source: "plan", run, batch, at: systemClock.iso() };
    const ops: AnyOp[] = [];
    const outline = await readOutline(work);
    ops.push({
      type: "book.update",
      expectedRev: outline.book.rev,
      patch: {
        title: plan.card.title,
        logline: plan.card.hook,
        coreConflict: plan.foundation.coreConflict,
        sellingPoints: plan.card.sellingPoints,
      },
    });
    const protagonist = ids.next("ent");
    ops.push({
      type: "entity.upsert",
      entity: {
        id: protagonist,
        kind: "character",
        name: plan.foundation.protagonist.name,
        aliases: [],
        summary: `${plan.foundation.protagonist.goal}；${plan.foundation.protagonist.flaw}；${plan.foundation.protagonist.goldenFinger}`,
        locked: [],
        provenance,
        rev: 0,
      },
    });
    ops.push({
      type: "entity.upsert",
      entity: {
        id: ids.next("ent"),
        kind: "rule",
        name: "世界观与主线冲突",
        aliases: [],
        summary: `${plan.foundation.worldview}；${plan.foundation.coreConflict}`,
        locked: [],
        global: true,
        provenance,
        rev: 0,
      },
    });
    ops.push({
      type: "entity.upsert",
      entity: {
        id: ids.next("ent"),
        kind: "power",
        name: "力量体系",
        aliases: [],
        summary: plan.foundation.powerSystem,
        locked: [],
        global: true,
        provenance,
        rev: 0,
      },
    });
    const dependencies = new Map<string, string>();
    for (const volume of plan.structure.volumes) {
      const id = ids.next("vol"),
        act = ids.next("act");
      ops.push({
        type: "node.create",
        level: "volume",
        index: volume.volume - 1,
        node: {
          id,
          title: volume.title,
          summary: volume.summary,
          planStatus: "draft",
          provenance,
          rev: 0,
        },
      });
      ops.push({
        type: "node.create",
        level: "act",
        parent: id,
        index: 0,
        node: {
          id: act,
          title: volume.title,
          summary: volume.summary,
          planStatus: "draft",
          provenance,
          rev: 0,
        },
      });
      for (const chapter of plan.outline.chapters.filter(
        (chapter) =>
          chapter.position >= volume.startChapter && chapter.position <= volume.endChapter,
      ))
        ops.push({
          type: "node.create",
          level: "chapter",
          parent: act,
          index: chapter.position - volume.startChapter,
          node: {
            id: ids.next("pl"),
            title: chapter.title,
            summary: chapter.synopsis,
            conflict: chapter.conflict,
            hook: chapter.hook,
            cast: [protagonist],
            planStatus: "draft",
            provenance,
            rev: 0,
          },
        });
    }
    const items: PendingItem[] = ops.map((op) => {
      const id = ids.next("p");
      if (op.type === "node.create") dependencies.set(op.node.id, id);
      if (op.type === "entity.upsert") dependencies.set(op.entity.id, id);
      if (op.type === "book.update") {
        const currentBook: Record<string, unknown> = { ...outline.book };
        const diff = Object.entries(op.patch).flatMap(([field, after]) => {
          const before = currentBook[field];
          return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ field, before, after }];
        });
        return {
          id,
          op,
          group: "foundation",
          change: diff.length ? "update" : "same",
          diff,
          dependsOn: [],
          notes: [],
          decision: "undecided",
          baseRev: outline.book.rev,
        };
      }
      return {
        id,
        op,
        group: op.type === "node.create" ? (op.parent ?? op.node.id) : "foundation",
        change: "new",
        dependsOn: [],
        notes: [],
        decision: "undecided",
      };
    });
    for (const item of items)
      if (item.op.type === "node.create")
        item.dependsOn = [item.op.parent, ...(item.op.node.cast ?? [])].flatMap((id) =>
          id && dependencies.has(id) ? [dependencies.get(id) ?? ""] : [],
        );
    const pending = PendingBatchSchema({
      format: "zhizhang/1.3",
      id: batch,
      source: "plan",
      run,
      created: systemClock.iso(),
      status: "open",
      commits: [],
      items,
    });
    const file = resolveResourcePath(work, "bible", "pending", `${batch}.json`);
    await atomicWrite(file, JSON.stringify(pending, null, 2));
    await atomicWrite(receipt, JSON.stringify({ batch, file }));
    return { backupDir: path.dirname(receipt), backedUpFiles: [], writtenPlanFiles: [file] };
  });
}
