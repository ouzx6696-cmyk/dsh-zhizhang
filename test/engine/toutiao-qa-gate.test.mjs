import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";

const { resolveQaOutcome, runQaRevisionLoop } = await importBundle(
  "packages/toutiao/src/pipelines/article/qa.ts",
);
const { articlePipeline } = await importBundle("packages/toutiao/src/pipelines/article/index.ts");

function qa(overall, passed, { hardGates = [], fails = [] } = {}) {
  return { ok: true, overall, passed, fails, hard_gates: hardGates };
}

function resultWith(qaResult, passScore = 84) {
  const outcome = resolveQaOutcome(qaResult, passScore);
  return {
    articleId: "article-1",
    title: "测试标题",
    draft: "正文",
    qa: qaResult,
    claims: [],
    antigaming: {
      before: { oralMarkers: 0, headings: 0 },
      after: { oralMarkers: 0, headings: 0 },
      oralDelta: 0,
      headingDelta: 0,
      warnings: [],
    },
    ...outcome,
  };
}

test("质检 83 分两轮后仍不过线 → 保持初稿待改且只回改两轮", async () => {
  const outcome = resolveQaOutcome(qa(83, false), 84);
  assert.equal(outcome.status, "初稿待改");
  assert.deepEqual(outcome.qaGate, {
    score: 83,
    passScore: 84,
    fails: [],
    hardGates: [],
  });

  const revisions = [];
  const verified = [];
  const rechecks = [];
  const runner = {
    stage: async (spec) => {
      revisions.push(spec.id);
      return `回改稿 ${revisions.length}`;
    },
  };
  const revised = await runQaRevisionLoop({
    runner,
    draft: "原稿",
    qa: qa(83, false),
    passScore: 84,
    s6Text: "",
    runQa: async (stepId) => {
      rechecks.push(stepId);
      return qa(83, false);
    },
    verifyRevision: async (_text, stepId) => verified.push(stepId),
  });
  assert.deepEqual(revisions, ["qa-revise-1", "qa-revise-2"]);
  assert.deepEqual(rechecks, ["qa-recheck-1", "qa-recheck-2"]);
  assert.deepEqual(verified, ["qa-revise-1", "qa-revise-2"]);
  assert.equal(revised.draft, "回改稿 2");
  assert.equal(resolveQaOutcome(revised.qa, 84).status, "初稿待改");
});

test("质检 84 分且 passed → 首次即过，不进回改并转待验收", async () => {
  const outcome = resolveQaOutcome(qa(84, true), 84);
  assert.deepEqual(outcome, { status: "待验收", qaGate: "pass" });
  let stageCalls = 0;
  const revised = await runQaRevisionLoop({
    runner: {
      stage: async () => {
        stageCalls++;
        return "不应回改";
      },
    },
    draft: "原稿",
    qa: qa(84, true),
    passScore: 84,
    s6Text: "",
    runQa: async () => assert.fail("首次过线不应复检"),
    verifyRevision: async () => assert.fail("首次过线不应复核"),
  });
  assert.equal(stageCalls, 0);
  assert.equal(revised.draft, "原稿");
});

test("质检 85 分但有硬闸 → 仍保持初稿待改", () => {
  const failure = { code: "hard", message: "硬闸未过" };
  const outcome = resolveQaOutcome(qa(85, false, { hardGates: ["合规"], fails: [failure] }), 84);
  assert.equal(outcome.status, "初稿待改");
  assert.equal(outcome.qaGate.score, 85);
  assert.deepEqual(outcome.qaGate.hardGates, ["合规"]);
  assert.deepEqual(outcome.qaGate.fails, [failure]);
});

test("质检 84 分但 passed=false → 不凭总分转待验收", () => {
  assert.equal(resolveQaOutcome(qa(84, false), 84).status, "初稿待改");
});

async function articleFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zz-qa-deliver-"));
  await fs.mkdir(path.join(dir, "drafts"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify({
      format: "zhizhang/1.3",
      id: "article-1",
      genre: "短图文",
      driver: "账本型",
      status: "初稿待改",
      rulesVersion: "test",
      history: [{ to: "初稿待改", at: "2026-11-16T00:00:00.000Z" }],
    }),
  );
  return dir;
}

function deliverCtx(dir, runId) {
  return { runId, target: { mode: "toutiao", path: dir }, request: {}, state: {} };
}

test("未过线交付 → 草稿与回执保留但文章状态不前进", async () => {
  const dir = await articleFixture();
  const res = resultWith(qa(83, false, { fails: [{ code: "detail", message: "细节不足" }] }));
  const receipt = await articlePipeline.deliver(res, deliverCtx(dir, "run-fail"));
  const meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
  assert.equal(meta.status, "初稿待改");
  assert.match(receipt.summary, /83/);
  assert.match(receipt.summary, /84/);
  assert.match(receipt.summary, /细节不足/);
  assert.equal(
    await fs.readFile(path.join(dir, "drafts", "rev-run-fail.md"), "utf8"),
    "# 测试标题\n\n正文",
  );
});

test("过线交付 → 草稿保存后文章才转待验收", async () => {
  const dir = await articleFixture();
  const res = resultWith(qa(84, true));
  await articlePipeline.deliver(res, deliverCtx(dir, "run-pass"));
  const meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
  assert.equal(meta.status, "待验收");
  assert.equal(meta.history.at(-1).to, "待验收");
});
