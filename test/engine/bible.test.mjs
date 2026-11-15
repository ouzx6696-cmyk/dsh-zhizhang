import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { createBibleStore } = await importTs("packages/fanqie/src/bible/store.ts");
const { createLockService } = await importTs("packages/core/src/lock/index.ts");

test("bible store supports propose/decide, asOf windowing, alias matching, and thread audit", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-bible-"));
  try {
    const clock = createFakeClock();
    const store = createBibleStore(createLockService(clock));
    const prov = { source: "author", at: clock.iso() };

    const pending = await store.propose(
      workDir,
      [
        {
          type: "entity.upsert",
          entity: {
            id: "ent-lin",
            kind: "character",
            name: "林默",
            aliases: ["默哥", "林师兄"],
            summary: "主角",
            locked: [],
            provenance: prov,
          },
        },
        {
          type: "entity.upsert",
          entity: {
            id: "ent-rule",
            kind: "rule",
            name: "灵气枯竭",
            aliases: [],
            summary: "世界观铁律",
            locked: ["灵气枯竭"],
            global: true,
            provenance: prov,
          },
        },
        {
          type: "state.add",
          entry: {
            id: "st-1",
            entity: "ent-lin",
            field: "境界",
            value: "炼气三层",
            since: 1,
            until: 5,
            mode: "replace",
            status: "confirmed",
            provenance: prov,
          },
        },
        {
          type: "state.add",
          entry: {
            id: "st-2",
            entity: "ent-lin",
            field: "境界",
            value: "筑基初期",
            since: 5,
            mode: "replace",
            status: "confirmed",
            provenance: prov,
          },
        },
        {
          type: "thread.upsert",
          thread: {
            id: "th-due",
            title: "玉佩秘纹",
            kind: "foreshadow",
            opened: 1,
            plannedPayoff: 10,
            beats: [{ chapter: 1, kind: "plant", note: "初次发光" }],
            status: "open",
          },
        },
        {
          type: "thread.upsert",
          thread: {
            id: "th-forgot",
            title: "黑衣人令牌",
            kind: "mystery",
            opened: 2,
            beats: [{ chapter: 2, kind: "plant", note: "留下令牌" }],
            status: "open",
          },
        },
      ],
      prov,
    );

    assert.equal(pending.length, 6);
    for (const item of pending) {
      await store.decide(workDir, item.id, "accept");
    }

    const bible = await store.read(workDir);
    assert.equal(bible.pending.length, 0);

    const viewCh3 = store.asOf(bible, 3);
    assert.deepEqual(
      viewCh3.states.map((s) => s.value),
      ["炼气三层"],
    );
    const viewCh5 = store.asOf(bible, 5);
    assert.deepEqual(
      viewCh5.states.map((s) => s.value),
      ["筑基初期"],
    );

    const hits = store.match(viewCh5, ["林师兄推门而入，默哥随后跟上。"]);
    assert.equal(hits.length, 2);
    assert.equal(hits[0].entity.id, "ent-lin");
    assert.equal(hits[0].count, 2);
    assert.equal(hits[1].entity.id, "ent-rule");
    assert.equal(hits[1].count, 0);

    const findings = store.audit(bible, 12);
    assert.deepEqual(
      findings.map((f) => `${f.kind}:${f.refId}`),
      ["due_unpaid:th-due", "forgotten_thread:th-forgot"],
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});
