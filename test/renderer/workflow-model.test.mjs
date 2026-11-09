import test from "node:test";
import assert from "node:assert/strict";
import { loadRenderer } from "../engine/helpers.mjs";
import { createRuntime, plain } from "../engine/runtime.mjs";

const { workflowModel: model } = loadRenderer(createRuntime().react);
const sum = (steps) => plain(model.sumUsage(steps));

const T0 = Date.parse("2026-11-01T00:00:00.000Z");
const at = (ms) => new Date(T0 + ms).toISOString();
const usage = (input = 0, output = 0, cost = null, cacheRead = 0, cacheWrite = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  cost,
});
function step(id, fields = {}) {
  return {
    id,
    title: id,
    status: "complete",
    started: at(0),
    durationMs: 0,
    attempts: 1,
    usage: usage(),
    output: null,
    ...fields,
  };
}
function record(steps, fields = {}) {
  return {
    schema: 1,
    id: "wf-1",
    request: {
      kind: "chapter",
      chapter: "c001",
      instruction: "写",
      grade: "standard",
      source: "",
      line: "story",
    },
    sourceHash: "h",
    state: "running",
    created: at(0),
    updated: at(0),
    steps,
    basis: "",
    ...fields,
  };
}

// —— stepPhase ——

test("stepPhase：完成与失败的阶段原样返回记录里的状态", () => {
  const r = record([]);
  assert.equal(model.stepPhase(step("a", { status: "complete" }), r), "complete");
  assert.equal(model.stepPhase(step("a", { status: "failed" }), r), "failed");
});

test("stepPhase：流水线运行中时，running 阶段显示为运行中", () => {
  assert.equal(model.stepPhase(step("a", { status: "running" }), record([])), "running");
});

test("stepPhase：流水线已暂停、失败或待作者时，遗留的 running 阶段显示为暂停", () => {
  for (const state of ["paused", "failed", "awaiting-author"])
    assert.equal(
      model.stepPhase(step("a", { status: "running" }), record([], { state })),
      "paused",
    );
});

// —— stageRows ——

test("stageRows：普通阶段各占一行，保持记录里的顺序与标题", () => {
  const r = record([step("plan", { title: "规划" }), step("draft", { title: "起稿" })]);
  const rows = model.stageRows(r);
  assert.deepEqual(plain(rows.map((row) => [row.key, row.title, row.phase, row.steps.length])), [
    ["plan", "规划", "complete", 1],
    ["draft", "起稿", "complete", 1],
  ]);
});

test("stageRows：同一挑战者的读者投票合成一行，标题按挑战稿编号", () => {
  const r = record([
    step("pair-1-vote-0"),
    step("pair-1-vote-1"),
    step("pair-2-vote-0"),
    step("delivery"),
  ]);
  const rows = model.stageRows(r);
  assert.deepEqual(plain(rows.map((row) => row.key)), ["pair-1-", "pair-2-", "delivery"]);
  assert.equal(rows[0].steps.length, 2);
  assert.equal(rows[0].title, "读者比较 · 第 2 稿挑战");
  assert.equal(rows[1].title, "读者比较 · 第 3 稿挑战");
});

test("stageRows：一组并行阶段取最需要注意的状态，失败压过运行中", () => {
  const r = record([
    step("pair-0-a", { status: "complete" }),
    step("pair-0-b", { status: "running" }),
    step("pair-0-c", { status: "failed" }),
  ]);
  assert.equal(model.stageRows(r)[0].phase, "failed");
});

test("stageRows：运行中压过完成，与阶段出现的先后无关", () => {
  const r = record([step("pair-0-a", { status: "running" }), step("pair-0-b")]);
  assert.equal(model.stageRows(r)[0].phase, "running");
  const reversed = record([step("pair-0-b"), step("pair-0-a", { status: "running" })]);
  assert.equal(model.stageRows(reversed)[0].phase, "running");
});

test("stageRows：流水线暂停时一组里遗留的 running 记为暂停，仍压过完成", () => {
  const r = record([step("pair-0-a"), step("pair-0-b", { status: "running" })], {
    state: "paused",
  });
  assert.equal(model.stageRows(r)[0].phase, "paused");
});

test("stageRows：没有阶段时返回空列表", () => {
  assert.deepEqual(plain(model.stageRows(record([]))), []);
});

// —— stepElapsed / spanElapsed / rowElapsed ——

test("stepElapsed：已结束的阶段只计记录的累计耗时", () => {
  const s = step("a", { durationMs: 1500, started: at(0) });
  assert.equal(model.stepElapsed(s, record([s]), T0 + 99_000), 1500);
});

test("stepElapsed：运行中的阶段加上本次已走的时间（含之前尝试的耗时）", () => {
  const s = step("a", { status: "running", durationMs: 2000, started: at(10_000) });
  assert.equal(model.stepElapsed(s, record([s]), T0 + 13_000), 5000);
});

test("stepElapsed：本机时钟早于开始时间时，本次耗时按 0 计而不是负数", () => {
  const s = step("a", { status: "running", durationMs: 700, started: at(10_000) });
  assert.equal(model.stepElapsed(s, record([s]), T0 + 5000), 700);
});

test("stepElapsed：流水线暂停时 running 阶段不再走秒", () => {
  const s = step("a", { status: "running", durationMs: 700, started: at(0) });
  assert.equal(model.stepElapsed(s, record([s], { state: "paused" }), T0 + 60_000), 700);
});

test("spanElapsed：并行阶段的时间段取并集，重叠部分不重复累加", () => {
  const steps = [
    step("a", { started: at(0), durationMs: 10_000 }),
    step("b", { started: at(5000), durationMs: 10_000 }),
  ];
  assert.equal(model.spanElapsed(steps, record(steps), T0 + 99_000), 15_000);
});

test("spanElapsed：不相交的时间段相加，被完全包含的时间段不加", () => {
  const steps = [
    step("c", { started: at(30_000), durationMs: 1000 }),
    step("a", { started: at(0), durationMs: 10_000 }),
    step("b", { started: at(2000), durationMs: 3000 }),
  ];
  assert.equal(model.spanElapsed(steps, record(steps), T0 + 99_000), 11_000);
});

test("spanElapsed：运行中的阶段算到当前时刻，时钟落后时不为负", () => {
  const steps = [step("a", { status: "running", started: at(1000), durationMs: 400 })];
  assert.equal(model.spanElapsed(steps, record(steps), T0 + 4000), 3000);
  assert.equal(model.spanElapsed(steps, record(steps), T0), 0);
});

test("rowElapsed：单阶段的行按阶段累计耗时，多阶段的行按墙钟并集", () => {
  const single = step("plan", { started: at(0), durationMs: 4000, attempts: 2 });
  const pair = [
    step("pair-0-a", { started: at(0), durationMs: 6000 }),
    step("pair-0-b", { started: at(1000), durationMs: 6000 }),
  ];
  const r = record([single, ...pair]);
  const [planRow, pairRow] = model.stageRows(r);
  assert.equal(model.rowElapsed(planRow, r, T0 + 99_000), 4000);
  assert.equal(model.rowElapsed(pairRow, r, T0 + 99_000), 7000);
});

// —— sumUsage / inputTokens ——

test("sumUsage：只算真正调用过模型的阶段，各项相加", () => {
  const steps = [
    step("a", { usage: usage(100, 20, 0.01, 5, 1) }),
    step("local"),
    step("b", { usage: usage(50, 10, 0.02) }),
  ];
  const total = sum(steps);
  assert.deepEqual({ ...total, cost: Number(total.cost.toFixed(6)) }, usage(150, 30, 0.03, 5, 1));
});

test("sumUsage：任何一个调用过模型的阶段费用未知，合计费用就是未知", () => {
  const steps = [step("a", { usage: usage(100, 20, 0.01) }), step("b", { usage: usage(1, 1) })];
  assert.equal(sum(steps).cost, null);
  const first = [step("b", { usage: usage(1, 1) }), step("a", { usage: usage(100, 20, 0.01) })];
  assert.equal(sum(first).cost, null);
});

test("sumUsage：本地阶段的未知费用不传染合计", () => {
  const steps = [
    step("local", { usage: usage(0, 0, null) }),
    step("a", { usage: usage(9, 1, 0.5) }),
  ];
  assert.equal(sum(steps).cost, 0.5);
});

test("sumUsage：没有调用模型时合计为零且费用为 0", () => {
  assert.deepEqual(sum([step("local")]), usage(0, 0, 0));
  assert.deepEqual(sum([]), usage(0, 0, 0));
});

test("inputTokens：输入、缓存读取与缓存写入都计入任务输入，输出不计", () => {
  assert.equal(model.inputTokens(usage(100, 999, null, 20, 3)), 123);
});

// —— stageProgress ——

test("stageProgress：按行计数，只有完成的行算进度", () => {
  const r = record(
    [
      step("plan"),
      step("pair-0-a"),
      step("pair-0-b", { status: "running" }),
      step("delivery", { status: "failed" }),
    ],
    { state: "failed" },
  );
  assert.deepEqual(plain(model.stageProgress(model.stageRows(r))), { done: 1, total: 3 });
});

// —— stopReason ——

test("stopReason：没有记录原因时没有原因", () => {
  assert.equal(model.stopReason(record([], { state: "paused" })), undefined);
  assert.equal(model.stopReason(record([], { state: "failed", error: "ECONNRESET" })), undefined);
});

test("stopReason：七种原因都只读记录上的 reason，与错误文案无关", () => {
  const cases = [
    ["paused", "run-budget"],
    ["paused", "stage-budget"],
    ["paused", "balance"],
    ["paused", "context"],
    ["paused", "interrupted"],
    ["paused", "stopped"],
    ["failed", "auth"],
  ];
  for (const [state, reason] of cases) {
    // 文案故意改写：旧实现按句子匹配，改写后就认不出原因
    const r = record([], { state, reason, error: "措辞已调整的说明" });
    assert.equal(model.stopReason(r), reason, reason);
  }
});

test("stopReason：运行中或待作者处理的任务不显示停止原因", () => {
  for (const state of ["running", "awaiting-author"])
    assert.equal(model.stopReason(record([], { state, reason: "stopped" })), undefined, state);
});

// —— deliveryOpen / selectedCandidate ——

test("deliveryOpen：交付回执标明仍有未解决项时为真", () => {
  const r = record([step("delivery", { output: { unresolved: true } })]);
  assert.equal(model.deliveryOpen(r), true);
});

test("deliveryOpen：没有交付阶段、输出不是对象或未标 true 时为假", () => {
  assert.equal(model.deliveryOpen(record([step("plan")])), false);
  assert.equal(model.deliveryOpen(record([step("delivery", { output: "文本" })])), false);
  assert.equal(
    model.deliveryOpen(record([step("delivery", { output: { unresolved: "yes" } })])),
    false,
  );
});

test("selectedCandidate：取交付回执里标为推荐的候选稿编号", () => {
  const output = {
    candidates: [
      { id: "c1", selected: false },
      { id: "c2", selected: true },
      { id: "c3", selected: true },
    ],
  };
  assert.equal(model.selectedCandidate(record([step("delivery", { output })])), "c2");
});

test("selectedCandidate：没有候选列表、没有推荐或编号不是文本时没有结果", () => {
  const of = (output) => model.selectedCandidate(record([step("delivery", { output })]));
  assert.equal(model.selectedCandidate(record([])), undefined);
  assert.equal(of({ candidates: "c1" }), undefined);
  assert.equal(of({ candidates: [{ id: "c1" }, null, "c2"] }), undefined);
  assert.equal(of({ candidates: [{ id: 7, selected: true }] }), undefined);
});

// —— canApply ——

test("canApply：待作者选择的本书规划与文章流水线可以采用", () => {
  for (const kind of ["book", "article"]) {
    const r = record([step("delivery")], { state: "awaiting-author" });
    r.request.kind = kind;
    assert.equal(model.canApply(r), true, kind);
  }
});

test("canApply：章节与台账流水线不走采用", () => {
  for (const kind of ["chapter", "ledger"]) {
    const r = record([step("delivery")], { state: "awaiting-author" });
    r.request.kind = kind;
    assert.equal(model.canApply(r), false, kind);
  }
});

test("canApply：尚未等待作者时不能采用", () => {
  for (const state of ["running", "paused", "failed"]) {
    const r = record([step("delivery")], { state });
    r.request.kind = "book";
    assert.equal(model.canApply(r), false, state);
  }
});

test("canApply：已完成作者采用阶段后不再提供采用；采用失败可以重试", () => {
  const done = record([step("delivery"), step("author-application")], {
    state: "awaiting-author",
  });
  done.request.kind = "article";
  assert.equal(model.canApply(done), false);
  const failed = record([step("delivery"), step("author-application", { status: "failed" })], {
    state: "awaiting-author",
  });
  failed.request.kind = "article";
  assert.equal(model.canApply(failed), true);
});

// —— 标签 ——

test("KIND_LABEL 与 STATE_LABEL 覆盖每一种流水线类型与状态", () => {
  assert.deepEqual(plain(Object.keys(model.KIND_LABEL).sort()), [
    "article",
    "book",
    "chapter",
    "ledger",
  ]);
  assert.deepEqual(plain(Object.keys(model.STATE_LABEL).sort()), [
    "awaiting-author",
    "failed",
    "paused",
    "running",
  ]);
  for (const label of [...Object.values(model.KIND_LABEL), ...Object.values(model.STATE_LABEL)])
    assert.ok(typeof label === "string" && label.length > 0);
});

test("T132 较旧响应不覆盖同任务的新快照", () => {
  const latest = { id: "run-one", updated: at(2000) },
    older = { ...latest, updated: at(1000) };
  assert.equal(model.acceptRecord(latest, older), latest);
  assert.equal(model.acceptRecord(older, latest), latest);
  assert.equal(model.acceptRecord(latest, null), null);
  assert.equal(model.acceptRecord(latest, { ...older, id: "different" }).id, "different");
});
