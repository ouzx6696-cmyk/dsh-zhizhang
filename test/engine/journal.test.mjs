import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import path from "node:path";
import { createToolHarness } from "../helpers.mjs";
import { ensureStorage } from "../../build/fanqie/src/engine/work-store.js";
import { sha256 } from "../../build/core/src/fsx.js";
import { snapshotFile } from "../../build/fanqie/src/engine/storage/journal.js";

for (const file of [
  "chapter-v1.json",
  "chapter-v2-brief.json",
  "chapter-v2-payoff.json",
  "chapter-v3-lint.json",
  "chapter-v4-stage.json",
  "chapter-v5.json",
]) {
  test(`T4 旧事务样本 ${file} 经生产工具检查、断点续写且字节不变`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "writer-legacy-journal-"));
    try {
      const paths = await ensureStorage({ cwd: root }, { storageRoot: root });
      const dir = path.join(paths.works, "legacy");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "meta.json"), "{}");
      const j = JSON.parse(
        await readFile(new URL(`../fixtures/journals/${file}`, import.meta.url), "utf8"),
      );
      j.owner = { pid: process.pid, host: hostname() };
      // Reproduce a crash after the first write, with the rest at their recorded baseline.
      const first = path.join(dir, j.writes[0].file);
      await mkdir(path.dirname(first), { recursive: true });
      await writeFile(first, j.writes[0].content);
      const pending = path.join(dir, ".writer-chapter-pending.json");
      await writeFile(pending, JSON.stringify(j));
      const harness = await createToolHarness({
        mode: "fanqie",
        cwd: root,
        config: { storageRoot: root },
      });
      assert.match(
        await harness.call("fanqie_status", { work: "legacy", recovery: "inspect" }),
        /已写入/,
      );
      assert.match(
        await harness.call("fanqie_status", { work: "legacy", recovery: "resume" }),
        /已恢复/,
      );
      for (const w of j.writes)
        assert.equal(await readFile(path.join(dir, w.file), "utf8"), w.content);
      assert.equal(await snapshotFile(pending), null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

const write = (file, content = "after") => ({ file, before: null, content });
const cases = [
  {
    name: "accept",
    create: "createAcceptJournal",
    inspect: "inspectPendingAccept",
    resume: "resumePendingAccept",
    input: {
      chapterId: "c001",
      candidateId: "cand-a",
      mode: "append",
      bodyFile: "cand-a.md",
      bodyHash: sha256("candidate"),
      writes: [
        write("chapters/c001.md"),
        write("meta.json"),
        write("candidates/cand-a.json"),
        write("ledger.json"),
      ],
    },
    init: [["candidates/cand-a.md", "candidate"]],
  },
  {
    name: "chapter",
    create: "createChapterJournal",
    inspect: "inspectPendingChapterSave",
    resume: "resumePendingChapterSave",
    input: { chapterId: "c001", writes: [write("chapters/c001.md"), write("meta.json")] },
  },
  {
    name: "card",
    create: "createCardJournal",
    inspect: "inspectPendingCard",
    resume: "resumePendingCard",
    input: {
      candidateId: "cand-a",
      cardId: "card-a",
      writes: [write("cards/card-a.json"), write("index.json"), write("candidates/cand-a.json")],
    },
  },
  {
    name: "analysis",
    create: "createAnalysisJournal",
    inspect: "inspectPendingAnalysis",
    resume: "resumePendingAnalysis",
    input: {
      sourceId: "src-a",
      dataFile: "rhythms.json",
      writes: [write("analyses/src-a/rhythms.json"), write("analyses/src-a/meta.json")],
    },
  },
  {
    name: "discard",
    create: "createDiscardJournal",
    inspect: "inspectPendingDiscard",
    resume: "resumePendingDiscard",
    input: {
      cardId: "card-a",
      indexBefore: sha256("{}"),
      indexContent: '{"cards":[]}',
      cardBefore: sha256("card"),
    },
    init: [
      ["index.json", "{}"],
      ["cards/card-a.json", "card"],
    ],
  },
  {
    name: "plan",
    create: "createPlanJournal",
    inspect: "inspectPendingPlan",
    resume: "resumePendingPlan",
    input: {
      sourceId: "src-a",
      clearConfirm: true,
      writes: [
        write("analyses/src-a/plan.json"),
        write("analyses/src-a/plan.md"),
        write("analyses/src-a/meta.json"),
        { file: "analyses/src-a/plan-confirm.json", before: sha256("confirmation") },
      ],
    },
    init: [["analyses/src-a/plan-confirm.json", "confirmation"]],
  },
  {
    name: "source",
    create: "createSourceJournal",
    inspect: "inspectPendingSource",
    resume: "resumePendingSource",
    input: {
      sourceId: "src-a",
      text: "book",
      metaContent: "{}",
      indexBefore: sha256("{}"),
      indexContent: '{"sources":["src-a"]}',
    },
    init: [["index.json", "{}"]],
  },
  {
    name: "inspiration",
    create: "createInspirationJournal",
    inspect: "inspectPendingInspiration",
    resume: "resumePendingInspiration",
    input: {
      workKey: "legacy",
      candidateId: "cand-a",
      writes: [
        { ...write("meta.json"), target: "work" },
        { ...write("candidates/cand-a.json"), target: "inspiration" },
      ],
    },
  },
];
for (const c of cases)
  test(`T4 ${c.name} 恢复确认绑定 id 与完整日志指纹，拒绝越权写入`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "writer-journal-confirm-"));
    try {
      const api = await import(`../../build/fanqie/src/engine/storage/${c.name}-journal.js`);
      const context =
        c.name === "inspiration" ? { inspiration: root, works: path.join(root, "works") } : root;
      if (c.name === "inspiration")
        await mkdir(path.join(root, "works", "legacy"), { recursive: true });
      for (const [file, content] of c.init ?? []) {
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), content);
      }
      const id = await api[c.create](context, c.input);
      const pending = path.join(root, `.writer-${c.name}-pending.json`),
        raw = await readFile(pending, "utf8");
      const inspected = await api[c.inspect](context);
      if (c.name === "chapter") {
        const j = JSON.parse(raw);
        assert.equal(j.version, 1);
        assert.equal(j.kind, "save");
      }
      await assert.rejects(
        api[c.resume](context, { id: "different", fingerprint: inspected.fingerprint }),
        (e) => e.code.endsWith("recovery_conflict"),
      );
      await writeFile(pending, raw + "\n");
      await assert.rejects(
        api[c.resume](context, { id, fingerprint: inspected.fingerprint }),
        (e) => e.code.endsWith("recovery_conflict"),
      );
      const j = JSON.parse(raw);
      if (c.name === "discard") j.cardId = "../escape";
      else j.writes[0].file = "../escape";
      await writeFile(pending, JSON.stringify(j));
      await assert.rejects(api[c.resume](context), (e) => e.code.endsWith("recovery_invalid"));
      assert.equal(await snapshotFile(path.join(root, "escape")), null);
      await writeFile(pending, raw);
      const fresh = await api[c.inspect](context);
      assert.equal(fresh.conflict, false);
      await api[c.resume](context, { id, fingerprint: fresh.fingerprint });
      assert.equal(await snapshotFile(pending), null);
      for (const w of JSON.parse(raw).writes ?? []) {
        const file = path.join(
          w.target === "work" ? path.join(root, "works", "legacy") : root,
          w.file,
        );
        assert.equal(await snapshotFile(file), w.after);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test("FQ-03 写锁检查：当前进程持有判为活锁且不可清理，记录损坏或缺失判为状态不明", async () => {
  const { inspectWriteLock, clearWriteLock } =
    await import("../../build/fanqie/src/engine/storage/process-lock.js");
  const root = await mkdtemp(path.join(tmpdir(), "writer-write-lock-"));
  const dir = path.join(root, ".writer-write-lock");
  try {
    assert.equal((await inspectWriteLock(root)).state, "absent");
    await mkdir(dir);
    assert.equal((await inspectWriteLock(root)).state, "unknown");
    await writeFile(path.join(dir, "owner.json"), "{坏");
    assert.equal((await inspectWriteLock(root)).state, "unknown");
    await assert.rejects(clearWriteLock(root), { code: "resource_lock_not_stale" });
    const self = { id: "self", pid: process.pid, host: hostname(), createdAt: "2026-11-01" };
    await writeFile(path.join(dir, "owner.json"), JSON.stringify(self));
    assert.equal((await inspectWriteLock(root)).state, "active");
    await assert.rejects(clearWriteLock(root), { code: "resource_lock_not_stale" });
    await writeFile(
      path.join(dir, "owner.json"),
      JSON.stringify({ ...self, host: "other-host", pid: 999999 }),
    );
    assert.equal((await inspectWriteLock(root)).state, "unknown");
    await assert.rejects(clearWriteLock(root), { code: "resource_lock_not_stale" });
    assert.equal(JSON.parse(await readFile(path.join(dir, "owner.json"), "utf8")).pid, 999999);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("RC-06 锁目录整体 rename 到位：持锁期间总有 owner.json，残留暂存目录不影响取锁，失败不留暂存", async () => {
  const { withResourceLock, inspectWriteLock } =
    await import("../../build/fanqie/src/engine/storage/process-lock.js");
  const { readdir } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(tmpdir(), "writer-lock-rename-"));
  try {
    // a crash during an earlier attempt leaves only a private staging directory behind
    await mkdir(path.join(root, ".writer-write-lock.staging-crashed"));
    assert.equal((await inspectWriteLock(root)).state, "absent");
    await withResourceLock(root, async () => {
      const owner = JSON.parse(
        await readFile(path.join(root, ".writer-write-lock", "owner.json"), "utf8"),
      );
      assert.equal(owner.pid, process.pid);
      assert.equal((await inspectWriteLock(root)).state, "active");
    });
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.startsWith(".writer-write-lock")),
      [".writer-write-lock.staging-crashed"],
    );
    // an existing lock (here an empty one left by 1.1.0 mid-acquire) is never replaced
    await mkdir(path.join(root, ".writer-write-lock"));
    const started = Date.now();
    await assert.rejects(
      withResourceLock(root, async () => "never"),
      { code: "resource_locked" },
    );
    assert.ok(Date.now() - started >= 9000);
    assert.deepEqual(await readdir(path.join(root, ".writer-write-lock")), []);
    assert.deepEqual(
      (await readdir(root)).filter(
        (name) => name.includes("staging-") && !name.endsWith("crashed"),
      ),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("FQ-11 锁释放失败不盖掉写入的原错误；写入成功时如实抛释放错误", async () => {
  const { withResourceLock } =
    await import("../../build/fanqie/src/engine/storage/process-lock.js");
  const root = await mkdtemp(path.join(tmpdir(), "writer-lock-release-"));
  const ownerFile = path.join(root, ".writer-write-lock", "owner.json");
  try {
    const original = new Error("写入本身失败");
    await assert.rejects(
      withResourceLock(root, async () => {
        await rm(ownerFile);
        throw original;
      }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[0], original);
        assert.equal(error.errors[1].code, "resource_lock_invalid");
        assert.match(error.message, /写入本身失败/);
        return true;
      },
    );
    await rm(path.join(root, ".writer-write-lock"), { recursive: true });
    await assert.rejects(
      withResourceLock(root, async () => {
        await rm(ownerFile);
        return "ok";
      }),
      { code: "resource_lock_invalid" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("FQ-11 恢复记录解码失败保留 cause：程序错误与已知错误都可追溯", async () => {
  const { journal } = await import("../../build/fanqie/src/engine/storage/journal.js");
  const { NovelError } = await import("../../build/fanqie/src/engine/errors.js");
  const root = await mkdtemp(path.join(tmpdir(), "writer-journal-cause-"));
  const record = {
    version: 1,
    id: "0b5c0d4e-1f2a-4b3c-8d9e-0a1b2c3d4e5f",
    owner: { pid: process.pid, host: hostname() },
    createdAt: new Date().toISOString(),
    writes: [],
  };
  await writeFile(path.join(root, ".writer-cause-pending.json"), JSON.stringify(record));
  const spec = (decode) => ({
    file: ".writer-cause-pending.json",
    label: "测试操作",
    root: () => root,
    decode,
  });
  try {
    const bug = journal(
      spec(() => {
        throw new TypeError("程序错误");
      }),
    );
    await assert.rejects(bug.inspect({}), (error) => {
      assert.equal(error.code, "recovery_invalid");
      assert.ok(error.cause instanceof TypeError);
      return true;
    });
    const known = new NovelError("recovery_unsupported", "已知问题");
    const rejected = journal(
      spec(() => {
        throw known;
      }),
    );
    await assert.rejects(rejected.inspect({}), (error) => {
      assert.equal(error.code, "recovery_invalid");
      assert.equal(error.cause, known);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("同进程在途写入的恢复记录不算中断：无锁读者等写入收尾；真正中断的记录照常报错", async () => {
  const { withResourceLock } =
    await import("../../build/fanqie/src/engine/storage/process-lock.js");
  const { createChapterJournal, finishChapterJournal, assertNoPendingChapterSave } =
    await import("../../build/fanqie/src/engine/storage/chapter-journal.js");
  const root = await mkdtemp(path.join(tmpdir(), "writer-journal-inflight-"));
  const input = { chapterId: "c001", writes: [write("chapters/c001.md"), write("meta.json")] };
  try {
    await mkdir(path.join(root, "chapters"));
    let entered, release;
    const staged = new Promise((resolve) => (entered = resolve));
    const gate = new Promise((resolve) => (release = resolve));
    const writer = withResourceLock(root, async () => {
      const id = await createChapterJournal(root, input);
      entered();
      await gate;
      await finishChapterJournal(root, id);
    });
    await staged;
    // 读者在记录已落盘、写入尚未收尾时到达（并发抽卡的另一路读作品目录就是这个时刻）。
    const reader = assertNoPendingChapterSave(root);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await Promise.all([writer, reader]);
    await createChapterJournal(root, input);
    await assert.rejects(assertNoPendingChapterSave(root), { code: "recovery_required" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
