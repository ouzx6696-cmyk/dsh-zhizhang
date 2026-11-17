import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { createBibleStore } = await importTs("packages/fanqie/src/bible/store.ts");
const { createLockService } = await importTs("packages/core/src/lock/index.ts");

const files = () => ({
  entities: { rev: 0, hash: "" },
  timeline: { rev: 0, hash: "" },
  states: { rev: 0, hash: "" },
  threads: { rev: 0, hash: "" },
  knowledge: { rev: 0, hash: "" },
  style: { rev: 0, hash: "" },
  outline: { rev: 0, hash: "" },
});

test("states.json 损坏 → storage.format_unsupported，且不覆盖原文件", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-bible-bad-"));
  try {
    const clock = createFakeClock();
    const store = createBibleStore(createLockService(clock), { clock });
    const file = path.join(workDir, "bible", "states.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ "broken": ');

    const expectUnsupported = (error) => {
      assert.equal(error.code, "storage.format_unsupported");
      return true;
    };
    await assert.rejects(store.read(workDir), expectUnsupported);
    await assert.rejects(
      store.apply(
        workDir,
        [
          {
            type: "entity.upsert",
            entity: {
              id: "ent-1",
              kind: "character",
              name: "林默",
              aliases: [],
              summary: "",
              locked: [],
              provenance: { source: "author", at: clock.iso() },
              rev: 0,
            },
          },
        ],
        0,
      ),
      expectUnsupported,
    );
    assert.equal(await fs.readFile(file, "utf8"), '{ "broken": ');
    assert.deepEqual(await fs.readdir(path.join(workDir, "bible")), ["states.json"]);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test("读到未知键 → storage.format_unsupported 且文件字节不变", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-bible-key-"));
  try {
    const clock = createFakeClock();
    const store = createBibleStore(createLockService(clock), { clock });
    const file = path.join(workDir, "bible", "entities.json");
    const raw = JSON.stringify([
      {
        id: "ent-1",
        kind: "character",
        name: "林默",
        aliases: [],
        summary: "",
        locked: [],
        provenance: { source: "author", at: clock.iso() },
        rev: 0,
        unknown: true,
      },
    ]);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, raw);
    await assert.rejects(store.read(workDir), (error) => {
      assert.equal(error.code, "storage.format_unsupported");
      return true;
    });
    assert.equal(await fs.readFile(file, "utf8"), raw);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test("ledger 章节 id 带路径分隔符 → input.invalid，拒绝写出作品目录", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-bible-path-"));
  try {
    const clock = createFakeClock();
    const store = createBibleStore(createLockService(clock), { clock });
    await assert.rejects(
      store.apply(
        workDir,
        [
          {
            type: "ledger.write",
            entry: {
              format: "zhizhang/1.3",
              chapter: "../escape",
              revision: "rev-1",
              position: 1,
              summary: "",
              handoff: { ending: "", openQuestions: [], positions: {}, carried: [] },
              hook: "",
              emotion: "",
              facts: [],
              appearances: [],
              ledgerRun: "run-1",
              rev: 0,
            },
          },
        ],
        0,
      ),
      (error) => {
        assert.equal(error.code, "input.invalid");
        assert.equal(error.data.rule, "invalid_id");
        return true;
      },
    );
    assert.deepEqual(await fs.readdir(path.join(workDir, "bible")).catch(() => []), []);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test("写入引用不存在的实体 → input.invalid 且 data.path 指向字段，不落盘", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-bible-ref-"));
  try {
    const clock = createFakeClock();
    const store = createBibleStore(createLockService(clock), { clock });
    await assert.rejects(
      store.apply(
        workDir,
        [
          {
            type: "state.add",
            entry: {
              id: "st-1",
              entity: "ent-missing",
              facet: "condition",
              field: "境界",
              value: "炼气",
              since: 1,
              mode: "replace",
              status: "confirmed",
              provenance: { source: "author", at: clock.iso() },
              rev: 0,
            },
          },
        ],
        0,
      ),
      (error) => {
        assert.equal(error.code, "input.invalid");
        assert.equal(error.data.rule, "dangling_ref");
        assert.equal(error.data.path, "$.states.st-1.entity");
        return true;
      },
    );
    assert.deepEqual((await store.read(workDir)).states, []);
    assert.deepEqual(await fs.readdir(path.join(workDir, "bible")).catch(() => []), []);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test("bible store: propose/decide 只写批次，commit 后 asOf 与巡检正确", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-bible-"));
  try {
    const clock = createFakeClock();
    const store = createBibleStore(createLockService(clock), { clock });
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
            rev: 0,
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
            rev: 0,
          },
        },
        {
          type: "state.add",
          entry: {
            id: "st-1",
            entity: "ent-lin",
            facet: "condition",
            field: "境界",
            value: "炼气三层",
            since: 1,
            until: 5,
            mode: "replace",
            status: "confirmed",
            provenance: prov,
            rev: 0,
          },
        },
        {
          type: "state.add",
          entry: {
            id: "st-2",
            entity: "ent-lin",
            facet: "condition",
            field: "境界",
            value: "筑基初期",
            since: 5,
            mode: "replace",
            status: "confirmed",
            provenance: prov,
            rev: 0,
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
            importance: "major",
            beats: [{ chapter: 1, kind: "plant", note: "初次发光" }],
            status: "open",
            provenance: prov,
            rev: 0,
          },
        },
        {
          type: "thread.upsert",
          thread: {
            id: "th-forgot",
            title: "黑衣人令牌",
            kind: "mystery",
            opened: 2,
            importance: "minor",
            beats: [{ chapter: 2, kind: "plant", note: "留下令牌" }],
            status: "open",
            provenance: prov,
            rev: 0,
          },
        },
      ],
      prov,
    );

    assert.equal(pending.length, 6);
    const [batch] = await store.readPendingBatches(workDir);
    await store.decide(
      workDir,
      batch.id,
      pending.map((item) => ({ id: item.id, decision: "accept" })),
    );
    assert.equal((await store.read(workDir)).entities.length, 0, "decide 不得写真源");
    assert.equal(await store.pendingCount(workDir), 0);

    const result = await store.commit(workDir, batch.id, files());
    assert.equal(result.committed, 6);
    assert.deepEqual(result.stale, []);

    const bible = await store.read(workDir);
    assert.equal(bible.entities.length, 2);
    assert.equal(bible.states.length, 2);

    const viewCh3 = store.asOf(bible, 3);
    assert.deepEqual(
      viewCh3.states.map((state) => state.value),
      ["炼气三层"],
    );
    const viewCh5 = store.asOf(bible, 5);
    assert.deepEqual(
      viewCh5.states.map((state) => state.value),
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
      findings.map((finding) => `${finding.kind}:${finding.refId}`),
      ["thread_overdue:th-due", "thread_forgotten:th-forgot"],
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});
