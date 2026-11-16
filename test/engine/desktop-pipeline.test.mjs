import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";
import { createFakeClock } from "../support/clock.mjs";
import { createFakeModelPort } from "../support/fake-port.mjs";

const ROOT = process.cwd();
const desk = await importBundle("test/support/desktop-entry.ts");
const REAL_SCRIPTS = path.join(ROOT, "packages/toutiao/skill/scripts");

const BODY = "雨落在旧码头的铁皮棚上，林川把手电压低，沿着湿滑的台阶往下走。".repeat(20);

/** 按阶段的返回格式说明分派假回答（流水线把 shape 拼在 user 末尾）。 */
function fanqieAnswer(req) {
  const tail = req.user.slice(-400);
  if (tail.includes("<<<END>>>")) return { text: `# 第二章 夜码头\n\n${BODY}\n<<<END>>>` };
  if (tail.includes('"scenes"')) {
    return {
      text: JSON.stringify({
        scenes: [{ title: "码头", goal: "找人", conflict: "雨夜", hook: "来电" }],
      }),
    };
  }
  if (tail.includes('"verdict"'))
    return { text: JSON.stringify({ verdict: "pass", issues: [], summary: "可以交付" }) };
  if (tail.includes('"issues"')) return { text: JSON.stringify({ issues: [] }) };
  return {
    error: Object.assign(new Error(`unexpected stage prompt: ${req.user.slice(-80)}`), {
      status: 400,
    }),
  };
}

function services(base, port, clock, extra = {}) {
  const gateway = desk.createModelGateway(
    port,
    {
      globalConcurrency: 4,
      perRunConcurrency: 3,
      roles: { writer: { connection: "fake", model: "fake-model" } },
    },
    clock,
  );
  const events = [];
  const runs = desk.createRunStore(path.join(base, "state", "runs"));
  const workflow = desk.createWorkflowService({
    clock,
    runs,
    gateway: () => gateway,
    budget: () => ({ inputBudget: 200000, runBudget: 10000000, moneyCap: null }),
    profileRoots: (mode) => ({
      builtinDir: path.join(ROOT, "packages", mode, "profiles"),
      userDir: path.join(base, "state", "profiles"),
    }),
    profileId: async () => "default",
    emit: (event) => events.push(event),
    ...extra,
  });
  return { workflow, events, runs };
}

function commandCtx(base, clock) {
  return {
    clock,
    locks: desk.createLockService(clock),
    inside: (p) => path.resolve(p),
    roots: () => ({
      fanqie: path.join(base, "长篇"),
      toutiao: path.join(base, "头条"),
      library: path.join(base, "拆书库"),
    }),
    profiles: {
      builtin: (m) => path.join(ROOT, "packages", m, "profiles"),
      userDir: path.join(base, "state", "profiles"),
    },
    scriptsDir: REAL_SCRIPTS,
    workflow: { startAndWait: async () => assert.fail("not used") },
  };
}

test("番茄章节流水线经 ModelGateway + 假端口跑通：交付候选稿、正文不变、运行记录落盘且重启后可列出", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "zz-pipe-fq-"));
  const clock = createFakeClock();
  const ctx = commandCtx(base, clock);
  await fs.mkdir(path.join(base, "长篇"), { recursive: true });
  const { workPath } = await desk.dispatchWorkbenchCommand(
    {
      command: "fanqie.work.create",
      input: { root: path.join(base, "长篇"), title: "夜航", premise: "", grade: "economy" },
    },
    ctx,
  );
  const previousBody = "前章衔接唯一句，林川把信藏进雨衣。";
  await desk.dispatchWorkbenchCommand(
    {
      command: "fanqie.chapter.save",
      input: {
        work: workPath,
        chapter: "ch-001",
        base: "",
        body: previousBody,
      },
    },
    ctx,
  );
  const port = createFakeModelPort([fanqieAnswer], { repeatLast: true });
  const { workflow, events } = services(base, port, clock);
  const target = { mode: "fanqie", path: workPath };

  const request = { chapterId: "ch-002", grade: "economy", targetWords: 500, note: "雨夜码头" };
  const [first, duplicate] = await Promise.allSettled([
    workflow.startAndWait(target, "fanqie.chapter", request),
    workflow.start(target, "fanqie.chapter", request),
  ]);
  assert.equal(first.status, "fulfilled");
  assert.equal(duplicate.status, "rejected");
  assert.equal(duplicate.reason.code, "gate.denied");
  const detail = first.value;
  assert.equal(detail.state, "awaiting-author", JSON.stringify(detail.error ?? {}));
  const stepIds = detail.steps.map((s) => s.id);
  assert.deepEqual(stepIds, ["prepare", "beats", "draft-0", "gate", "continuity-check", "review"]);
  assert.ok(detail.steps.find((s) => s.id === "draft-0").methodHash, "起稿阶段带方法指纹");
  assert.ok(port.calls.every((req) => req.connection === "fake" && req.model === "fake-model"));
  assert.ok(port.calls.some((req) => req.system.includes(previousBody)));
  assert.ok(
    port.calls.some((req) => req.system.length > 0),
    "方法方案进入系统提示",
  );

  const candidate = await fs.readFile(
    path.join(workPath, "candidates", "ch-002", `${detail.id}.md`),
    "utf8",
  );
  assert.match(candidate, /^# 第二章 夜码头/);
  await assert.rejects(fs.stat(path.join(workPath, "chapters", "ch-002.md")), { code: "ENOENT" });

  const runEvents = events.filter((e) => e.kind === "run");
  assert.equal(runEvents.at(-1).run.state, "awaiting-author");
  assert.ok(events.some((e) => e.kind === "workspace.changed" && e.scope === "chapter"));
  assert.deepEqual(events.filter((e) => e.kind === "running").at(-1).rows, []);

  const restarted = services(base, port, clock).workflow;
  const history = await restarted.history(target);
  assert.equal(history.length, 1);
  await desk.dispatchWorkbenchCommand(
    {
      command: "fanqie.candidate.accept",
      input: {
        work: workPath,
        chapter: "ch-002",
        candidateId: detail.id,
        base: "",
      },
    },
    ctx,
  );
  await desk.dispatchWorkbenchCommand(
    {
      command: "fanqie.chapter.finalize",
      input: {
        work: workPath,
        chapter: "ch-002",
      },
    },
    ctx,
  );
  const finalized = await desk.dispatchWorkbenchCommand(
    {
      command: "fanqie.chapter.get",
      input: {
        work: workPath,
        chapter: "ch-002",
      },
    },
    ctx,
  );
  assert.equal(finalized.status, "final");
  const edited = await desk.dispatchWorkbenchCommand(
    {
      command: "fanqie.chapter.save",
      input: {
        work: workPath,
        chapter: "ch-002",
        base: finalized.revision,
        body: `${finalized.body}新段落。`,
      },
    },
    ctx,
  );
  assert.equal(edited.row.status, "drafted");
  const reviewed = await workflow.startAndWait(target, "fanqie.review", { chapterId: "ch-002" });
  assert.equal(reviewed.state, "awaiting-author");
  await workflow.decide({ target, runId: reviewed.id }, "apply");
  const chapter = await desk.dispatchWorkbenchCommand(
    {
      command: "fanqie.chapter.get",
      input: {
        work: workPath,
        chapter: "ch-002",
      },
    },
    ctx,
  );
  assert.equal(chapter.status, "reviewed");

  assert.equal(history[0].id, detail.id);
  assert.deepEqual(history[0].stages, stepIds);
  const reloaded = await restarted.get({ runId: detail.id, target });
  assert.equal(reloaded.steps.length, stepIds.length);

  const discarded = await restarted.decide({ runId: detail.id, target }, "discard");
  assert.equal(discarded.state, "discarded");

  await assert.rejects(
    workflow.start(target, "fanqie.unknown", {}),
    (err) => err.code === "input.invalid",
  );
  await assert.rejects(
    workflow.start(target, "fanqie.chapter", { chapterId: "" }),
    (err) => err.code === "input.invalid",
  );
});

test("中断与失败：重启时遗留的 running 记录转为可恢复的 paused(interrupted)；模型鉴权失败记录错误码", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "zz-pipe-int-"));
  const clock = createFakeClock();
  const ctx = commandCtx(base, clock);
  await fs.mkdir(path.join(base, "长篇"), { recursive: true });
  const { workPath } = await desk.dispatchWorkbenchCommand(
    {
      command: "fanqie.work.create",
      input: { root: path.join(base, "长篇"), title: "断点", premise: "", grade: "economy" },
    },
    ctx,
  );
  const target = { mode: "fanqie", path: workPath };
  const authError = Object.assign(new Error("401 Unauthorized"), { status: 401 });
  const failing = services(
    base,
    createFakeModelPort([{ error: authError }], { repeatLast: true }),
    clock,
  );
  const failed = await failing.workflow.startAndWait(target, "fanqie.chapter", {
    chapterId: "ch-001",
    grade: "economy",
    targetWords: 500,
  });
  assert.equal(failed.state, "failed");
  assert.equal(failed.error.code, "model.auth");

  const stuck = { ...failed, id: "run-stuck", state: "running", error: undefined, steps: [] };
  delete stuck.error;
  await failing.runs.save(stuck);
  const recovered = await services(
    base,
    createFakeModelPort([fanqieAnswer], { repeatLast: true }),
    clock,
  ).workflow;
  const interrupted = await recovered.recoverInterrupted();
  assert.deepEqual(
    interrupted.map((r) => [r.id, r.state, r.reason]),
    [["run-stuck", "paused", "interrupted"]],
  );
  const resumed = await recovered.control({ runId: "run-stuck", target }, "resume");
  assert.equal(resumed.state, "running");
  const all = await recovered.history(target);
  assert.ok(all.some((r) => r.id === "run-stuck"));
});

async function toutiaoScriptsWithCardShim(base) {
  const dir = path.join(base, "scripts");
  await fs.mkdir(dir, { recursive: true });
  for (const name of ["rules.py", "ledger.py", "writer_bridge.py", "fetch_hot.py", "qa_check.py"]) {
    const source = path.join(REAL_SCRIPTS, name);
    const destination = path.join(dir, name);
    if (process.platform === "win32") await fs.copyFile(source, destination);
    else await fs.symlink(source, destination);
  }
  return dir;
}

test("头条文章流水线经 ModelGateway + 假端口跑通：真实 Python 质检未过线，草稿交付并保持初稿待改", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "zz-pipe-tt-"));
  const clock = createFakeClock();
  const ctx = commandCtx(base, clock);
  const toutiaoRoot = path.join(base, "头条");
  await fs.mkdir(toutiaoRoot, { recursive: true });
  const { articleDir } = await desk.dispatchWorkbenchCommand(
    {
      command: "toutiao.article.create",
      input: { root: toutiaoRoot, genre: "短图文", driver: "账本型" },
    },
    ctx,
  );
  await desk.dispatchWorkbenchCommand(
    {
      command: "toutiao.source.register",
      input: { articleDir, sourceId: "s1", kind: "paste", content: "2026 年基本养老金上调 2%。" },
    },
    ctx,
  );
  const scriptsDir = await toutiaoScriptsWithCardShim(base);
  const profileDir = path.join(ROOT, "packages/toutiao/profiles/default");
  const motifs = ["数字反差", "身份点名", "时间坐标"];
  const titles = [
    "养老金上调后每月到手多少",
    "退休金涨了这笔账怎么算",
    "上调2%落到你手里是多少",
    "今年养老金调整看这三点",
    "临近退休的人先看这笔账",
  ].map((text, i) => ({ text, motif: motifs[i % 3] }));
  const article = `# ${titles[0].text}\n\n## 先算账\n\n今年基本养老金上调 2%，按月领 3000 元算，每月多 60 元。\n\n## 再看细则\n\n各地方案陆续公布，到账时间以当地通知为准。`;
  const answer = (req) => {
    const tail = req.user.slice(-400);
    if (tail.includes("立项卡对象")) {
      return {
        text: JSON.stringify({
          主问题: "上调后到手多少",
          核心事实: ["基本养老金上调2%"],
          读者: "临近退休职工",
          内容线: "资讯线",
          垂类: "民生社保",
        }),
      };
    }
    if (tail.includes('"alternatives"'))
      return { text: JSON.stringify({ main: titles[0], alternatives: titles.slice(1) }) };
    if (tail.includes('"openingStyle"')) {
      return {
        text: JSON.stringify({
          openingStyle: "算账开头",
          endingStyle: "提醒结尾",
          sections: [{ heading: "先算账", question: "多多少", action: "举例" }],
        }),
      };
    }
    if (tail.includes('"claims"')) return { text: JSON.stringify({ claims: [] }) };
    if (tail.includes('"skeleton"'))
      return { text: JSON.stringify({ issues: [], summary: "结构清楚" }) };
    if (tail.includes("Markdown 正文")) return { text: article };
    return {
      error: Object.assign(new Error(`unexpected stage prompt: ${req.user.slice(-80)}`), {
        status: 400,
      }),
    };
  };
  const port = createFakeModelPort([answer], { repeatLast: true });
  const { workflow } = services(base, port, clock, {
    prepareRequest: (kind, request) => ({
      ...request,
      scriptsDir,
      profileDir,
      ledgerPath: path.join(toutiaoRoot, "ledger.csv"),
    }),
  });
  const meta = JSON.parse(await fs.readFile(path.join(articleDir, "meta.json"), "utf8"));
  const detail = await workflow.startAndWait(
    { mode: "toutiao", path: articleDir },
    "toutiao.article",
    {
      articleId: meta.id,
      genre: "短图文",
      driver: "账本型",
      draftCount: 1,
    },
  );
  assert.equal(detail.state, "awaiting-author", JSON.stringify(detail.error ?? {}));
  const stepIds = detail.steps.map((s) => s.id);
  for (const id of [
    "source",
    "rules-limits",
    "card",
    "title",
    "blueprint",
    "draft-0",
    "review",
    "revise",
    "qa",
  ]) {
    assert.ok(stepIds.includes(id), `missing step ${id}: ${stepIds.join(",")}`);
  }
  const qa = detail.steps.find((s) => s.id === "qa").output;
  assert.equal(typeof qa.overall, "number");
  assert.equal(qa.passed, false);
  const draft = await fs.readFile(path.join(articleDir, "drafts", `rev-${detail.id}.md`), "utf8");
  assert.match(draft, /^# 养老金上调后每月到手多少/);
  const after = JSON.parse(await fs.readFile(path.join(articleDir, "meta.json"), "utf8"));
  assert.equal(after.status, "初稿待改");
});
