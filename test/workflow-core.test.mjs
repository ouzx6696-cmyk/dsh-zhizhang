/** Workflow journal, packet and root identity: the core pieces every run resumes through. */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tempDir, buildUrl } from "./helpers.mjs";

const { WorkflowJournal, WorkflowBudgetError, contextPacket, estimateInput, isUnfinishedRun } =
  await import(buildUrl("core/src/workflow.js"));
const { rootIdentity } = await import(buildUrl("core/src/identity.js"));
const { snapshotFiles } = await import(buildUrl("core/src/snapshots.js"));

const REQUEST = {
  kind: "article",
  chapter: "",
  instruction: "写一篇资讯",
  grade: "economy",
  source: "来源",
  line: "news",
};
const usage = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: null };
const signal = new AbortController().signal;

async function journalFile(t) {
  const dir = await tempDir("workflow-core-");
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, "run-abc.json");
}
const open = (file, request = REQUEST) =>
  WorkflowJournal.open(file, request, "hash", "basis", () => {});

/** A finished journal on disk, rewritten by `patch` to look damaged. */
async function damaged(t, patch) {
  const file = await journalFile(t);
  const journal = await open(file);
  await journal.step("s", "阶段", { parse: (v) => v }, async () => ({ value: 1, usage }), signal);
  const raw = JSON.parse(await readFile(file, "utf8"));
  patch(raw);
  await writeFile(file, JSON.stringify(raw));
  return file;
}

test("journal 重开：已完成阶段经结构解析原样恢复，parse(parse(x)) 与首轮结果一致", async (t) => {
  const file = await journalFile(t);
  const parse = (value) => ({
    body: String(value.body).trim(),
    words: String(value.body).trim().length,
  });
  const first = await open(file);
  const value = await first.step(
    "draft",
    "起稿",
    { parse },
    async () => ({ value: { body: "  正文  " }, usage }),
    signal,
  );
  let calls = 0;
  const second = await open(file);
  assert.equal(second.record.id, "run-abc");
  const again = await second.step(
    "draft",
    "起稿",
    { parse },
    async () => {
      calls++;
      return { value: { body: "别的" }, usage };
    },
    signal,
  );
  assert.deepEqual(again, value);
  assert.deepEqual(value, { body: "正文", words: 2 });
  assert.equal(calls, 0);
  assert.deepEqual(second.record.steps[0].usage, usage);
});

test("journal 重开：任务要求或来源变化时拒绝套用旧进度", async (t) => {
  const file = await journalFile(t);
  const journal = await open(file);
  await journal.save();
  await assert.rejects(open(file, { ...REQUEST, instruction: "换个要求" }), /任务要求已改变/);
  await assert.rejects(
    WorkflowJournal.open(file, REQUEST, "other", "basis", () => {}),
    /任务要求已改变/,
  );
});

test("journal 读取：非 JSON 报损坏而不是当作没有记录", async (t) => {
  const file = await journalFile(t);
  await writeFile(file, "{坏");
  await assert.rejects(WorkflowJournal.read(file), (error) => error.code === "CONFLICT");
});

test("journal 读取：状态、请求与阶段状态损坏分别报错", async (t) => {
  const cases = [
    [(raw) => (raw.state = "done"), /流水线状态损坏/],
    [(raw) => (raw.request.kind = "poem"), /流水线类型无效/],
    [(raw) => (raw.steps[0].status = "skipped"), /流水线阶段记录损坏/],
    [(raw) => delete raw.basis, /流水线时间损坏/],
    [(raw) => (raw.schema = 2), /流水线记录损坏/],
  ];
  for (const [patch, message] of cases)
    await assert.rejects(WorkflowJournal.read(await damaged(t, patch)), message);
});

test("journal 读取：用量与费用为负、非数或缺失时报错", async (t) => {
  const cases = [
    [(raw) => (raw.steps[0].usage.input = -1), /流水线用量损坏/],
    [(raw) => (raw.steps[0].usage.cacheWrite = "3"), /流水线用量损坏/],
    [(raw) => (raw.steps[0].usage.cost = "0.1"), /流水线费用损坏/],
    [(raw) => (raw.steps[0].usage.cost = -0.1), /流水线费用损坏/],
    [(raw) => (raw.steps[0].usage = null), /流水线阶段记录损坏/],
  ];
  for (const [patch, message] of cases)
    await assert.rejects(WorkflowJournal.read(await damaged(t, patch)), message);
});

test("journal 读取：阶段计时损坏与阶段编号重复报错", async (t) => {
  await assert.rejects(
    WorkflowJournal.read(await damaged(t, (raw) => (raw.steps[0].attempts = 1.5))),
    /流水线阶段计时损坏/,
  );
  await assert.rejects(
    WorkflowJournal.read(await damaged(t, (raw) => (raw.steps[0].durationMs = -1))),
    /流水线阶段计时损坏/,
  );
  await assert.rejects(
    WorkflowJournal.read(await damaged(t, (raw) => raw.steps.push({ ...raw.steps[0] }))),
    /流水线阶段编号重复/,
  );
});

test("journal 读取：合法记录只保留已知字段，可选字段按类型保留", async (t) => {
  const file = await damaged(t, (raw) => {
    raw.steps[0].error = "上次失败";
    raw.steps[0].model = 7;
    raw.extra = "丢弃";
  });
  const record = await WorkflowJournal.read(file);
  assert.equal(record.steps[0].error, "上次失败");
  assert.equal("model" in record.steps[0], false);
  assert.equal("extra" in record, false);
  assert.deepEqual(record.request, REQUEST);
});

test("contextPacket：必需材料超预算时报预算错误，不截断", () => {
  assert.throws(
    () => contextPacket([{ name: "设定", text: "字".repeat(50), required: true }], [], 10),
    WorkflowBudgetError,
  );
});

test("contextPacket：前缀稳定——一块可选材料放不下后，后面的可选材料也让位", () => {
  const packet = contextPacket(
    [
      { name: "设定", text: "设定", required: true },
      { name: "长材料", text: "长".repeat(40), required: false },
      { name: "短材料", text: "短", required: false },
      { name: "空材料", text: "  ", required: false },
    ],
    [{ name: "输入", text: "输入", required: true }],
    30,
  );
  assert.deepEqual(packet.omitted, ["长材料", "短材料"]);
  assert.equal(packet.prefix, "## 设定\n设定");
  assert.equal(packet.suffix, "## 输入\n输入");
  assert.equal(packet.text, packet.prefix + "\n\n" + packet.suffix);
  assert.equal(packet.tokens, estimateInput(packet.text));
  assert.ok(!packet.text.includes("空材料"));
});

test("isUnfinishedRun：运行、暂停、失败与未采用的方案都算未完成；章节交付与已采用方案不算", () => {
  const run = (state, kind, steps = []) => ({ state, request: { ...REQUEST, kind }, steps });
  for (const state of ["running", "paused", "failed"])
    assert.equal(isUnfinishedRun(run(state, "chapter")), true, state);
  assert.equal(isUnfinishedRun(run("awaiting-author", "book")), true);
  assert.equal(isUnfinishedRun(run("awaiting-author", "article")), true);
  assert.equal(isUnfinishedRun(run("awaiting-author", "chapter")), false);
  assert.equal(isUnfinishedRun(run("awaiting-author", "ledger")), false);
  const applied = [{ id: "author-application", status: "complete" }];
  assert.equal(isUnfinishedRun(run("awaiting-author", "book", applied)), false);
});

test("rootIdentity：Windows 下反斜杠归一且不区分大小写", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    const upper = rootIdentity("Writer\\Books\\Night"),
      lower = rootIdentity("writer\\books\\NIGHT");
    assert.equal(upper, lower);
    assert.ok(upper.endsWith("/writer/books/night"), upper);
    assert.ok(!upper.includes("\\"));
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
  assert.notEqual(rootIdentity("Writer/Night"), rootIdentity("writer/night"));
});

test("snapshotFiles：只复制存在的文件，内容一致；全部缺失时不建快照目录", async (t) => {
  const root = await tempDir("snapshots-");
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await snapshotFiles(root, [path.join(root, "missing.json")]), undefined);
  await assert.rejects(readdir(path.join(root, ".writer-snapshots")), { code: "ENOENT" });
  await writeFile(path.join(root, "meta.json"), '{"a":1}');
  await mkdir(path.join(root, "chapters"));
  const output = await snapshotFiles(root, [
    path.join(root, "meta.json"),
    path.join(root, "chapters"),
    path.join(root, "missing.json"),
  ]);
  assert.equal(path.dirname(output), path.join(root, ".writer-snapshots"));
  assert.deepEqual(await readdir(output), ["0-meta.json"]);
  assert.equal(await readFile(path.join(output, "0-meta.json"), "utf8"), '{"a":1}');
});
