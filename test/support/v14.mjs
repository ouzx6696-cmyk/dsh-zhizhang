import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importTs } from "./ts-loader.mjs";
import { createFakeClock } from "./clock.mjs";
export const core = await importTs("packages/core/src/pipeline/index.ts");
export const outline = await importTs("packages/fanqie/src/outline/index.ts");
export const bible = await importTs("packages/fanqie/src/bible/index.ts");
export const { createLockService } = await importTs("packages/core/src/lock/index.ts");
export const { createWorkLayout } = await importTs("packages/fanqie/src/storage/work.ts");
export const chapter = await importTs("packages/fanqie/src/commands/chapter.ts");
export const text = await importTs("packages/core/src/text/index.ts");
export const provenance = { source: "author", at: "2026-11-17T00:00:00.000Z" };
export async function workspace(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "zz-v14-")),
    work = path.join(base, "book"),
    clock = createFakeClock(),
    locks = createLockService(clock);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await createWorkLayout(work, { id: "test", title: "夜航", nowIso: clock.iso() }, locks);
  return {
    base,
    work,
    clock,
    locks,
    store: outline.createOutlineStore(locks),
    library: bible.createBibleStore(locks),
  };
}
export function treeOps(volumes = 3, acts = 2, chapters = 3) {
  let count = 0;
  const next = (prefix) => `${prefix}-${String(++count).padStart(8, "0")}`;
  const ops = [],
    ids = [];
  const node = (id, title) => ({ id, title, planStatus: "draft", provenance, rev: 0 });
  for (let v = 0; v < volumes; v++) {
    const volume = next("vol");
    ops.push({
      type: "node.create",
      level: "volume",
      index: v,
      node: node(volume, `第${v + 1}卷`),
    });
    for (let a = 0; a < acts; a++) {
      const act = next("act");
      ops.push({
        type: "node.create",
        level: "act",
        parent: volume,
        index: a,
        node: node(act, `第${a + 1}幕`),
      });
      for (let c = 0; c < chapters; c++) {
        const id = next("pl");
        ids.push(id);
        ops.push({
          type: "node.create",
          level: "chapter",
          parent: act,
          index: c,
          node: node(id, `第${ids.length}章`),
        });
      }
    }
  }
  return { ops, ids };
}
export async function runPipeline(def, ctx, gateway, clock, onPersist) {
  const record = {
    format: "zhizhang/1.3",
    id: ctx.runId,
    kind: def.kind,
    target: ctx.target,
    request: ctx.request,
    state: "running",
    stateHistory: [],
    steps: [],
    usage: core.emptyUsage(),
    budget: { inputBudget: 200000, runBudget: 10000000, moneyCap: null },
    created: clock.iso(),
    updated: clock.iso(),
  };
  return core.executePipeline(
    def,
    record,
    ctx,
    gateway,
    clock,
    new AbortController().signal,
    onPersist,
  );
}
