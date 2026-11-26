import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { createFakeModelPort } from "../support/fake-port.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { isAppError } = await importTs("packages/core/src/errors/index.ts");
const { sha256 } = await importTs("packages/core/src/fs/index.ts");
const { createLockService } = await importTs("packages/core/src/lock/index.ts");
const { createModelGateway } = await importTs("packages/core/src/model/index.ts");
const { FORMAT_VERSION } = await importTs("packages/core/src/paths.ts");
const { emptyUsage, executePipeline } = await importTs("packages/core/src/pipeline/index.ts");
const { createBibleStore } = await importTs("packages/fanqie/src/bible/index.ts");
const { bookPipeline, chapterPipeline, commands, ledgerPipeline, revisePipeline } = await importTs(
  "packages/fanqie/src/index.ts",
);
const {
  acceptCandidate,
  createWork,
  finalizeChapter,
  listCandidates,
  readChapter,
  saveChapter,
  updateWorkSettings,
} = commands;

function makeLongBody(seed, repeat = 60) {
  return Array.from(
    { length: repeat },
    (_, i) => `${seed}第${i + 1}段：林默稳住呼吸，目光紧盯着门外的身影。`,
  ).join("\n\n");
}

const FAKE_BEATS_JSON = JSON.stringify({
  scenes: [{ title: "主场景", goal: "推进冲突", conflict: "正面交锋", hook: "意外反转" }],
});

function makeGateway(port, clock) {
  return createModelGateway(
    port,
    {
      globalConcurrency: 4,
      perRunConcurrency: 4,
      roles: {
        writer: { connection: "c1", model: "m1" },
        reviewer: { connection: "c1", model: "m1" },
        editor: { connection: "c1", model: "m1" },
        judge: { connection: "c1", model: "m1" },
        planner: { connection: "c1", model: "m1" },
        archivist: { connection: "c1", model: "m1" },
      },
    },
    clock,
  );
}

function makeRunRecord(id, kind, target, request, nowIso) {
  return {
    format: FORMAT_VERSION,
    id,
    kind,
    target,
    request,
    state: "running",
    stateHistory: [{ to: "running", reason: "start", at: nowIso }],
    steps: [],
    usage: emptyUsage(),
    budget: { inputBudget: 12000, runBudget: 100000, moneyCap: 10 },
    created: nowIso,
    updated: nowIso,
  };
}

test("番茄整书规划将提案隔离在 plan/proposals/<runId>/，应用后才覆盖正式规划文件", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-book-plan-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    await fs.mkdir(path.join(dir, "plan"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "plan", "card.json"),
      JSON.stringify({ format: "zhizhang/2.0", title: "旧书名" }),
      "utf8",
    );

    const port = createFakeModelPort([
      {
        text: JSON.stringify({
          title: "云海闻铃",
          genre: "悬疑",
          hook: "雨夜铜铃自鸣",
          sellingPoints: ["悬疑", "民俗"],
          targetAudience: "男频悬疑读者",
        }),
      },
      {
        text: JSON.stringify({
          protagonist: {
            name: "沈砚",
            goal: "查明州府沉案",
            flaw: "过于谨慎",
            goldenFinger: "古铃辨煞",
          },
          worldview: "青崖州府雾气缭绕，古井藏有百年前封煞旧案",
          powerSystem: "听铃辨煞、以药镇灵",
          coreConflict: "镇妖失衡与旧案掩盖",
        }),
      },
      {
        text: JSON.stringify({
          volumes: [
            {
              volume: 1,
              title: "雾起青崖",
              summary: "初遇异象",
              startChapter: 1,
              endChapter: 20,
            },
          ],
        }),
      },
      {
        text: JSON.stringify({
          chapters: [
            {
              position: 1,
              title: "雨夜闻铃",
              synopsis: "引出古井异象",
              conflict: "神秘来客夜访",
              hook: "铜铃自鸣",
            },
          ],
        }),
      },
    ]);

    const target = { mode: "fanqie", path: dir };
    const req = { title: "云海闻铃", genre: "悬疑", premise: "民俗悬疑长篇", outlineCount: 1 };
    const ctx = await bookPipeline.context(target, req, { clock, lock });
    const record = makeRunRecord(ctx.runId, bookPipeline.kind, target, req, clock.iso());
    const res = await executePipeline(
      bookPipeline,
      record,
      ctx,
      makeGateway(port, clock),
      clock,
      new AbortController().signal,
    );

    assert.equal(res.state, "awaiting-author");
    const oldCard = JSON.parse(await fs.readFile(path.join(dir, "plan", "card.json"), "utf8"));
    assert.equal(oldCard.title, "旧书名");

    const proposalCard = JSON.parse(
      await fs.readFile(path.join(dir, "plan", "proposals", ctx.runId, "card.json"), "utf8"),
    );
    assert.equal(proposalCard.format, "zhizhang/2.0");
    assert.equal(proposalCard.title, "云海闻铃");

    const freshCtx = { ...ctx, state: {} };
    await bookPipeline.apply(res, { adopt: true }, freshCtx);
    const appliedCard = JSON.parse(await fs.readFile(path.join(dir, "plan", "card.json"), "utf8"));
    assert.equal(appliedCard.title, "云海闻铃");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("revisePipeline(mode=deai) 无 issues 时单轮输出去 AI 腔候选，不改正式章节且不冒充完整审读", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-deai-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const workPath = path.join(root, "book-deai");
    await createWork(workPath, { id: "book-deai", title: "去腔测试", grade: "economy" }, lock);
    const originalBody = makeLongBody("原文内容", 60);
    await saveChapter(workPath, { chapterId: "C001", title: "雨夜开局", body: originalBody }, lock);

    const revisedBody = makeLongBody("去腔后的口语化改写", 60);
    const port = createFakeModelPort([{ text: `# 雨夜开局\n\n${revisedBody}\n<<<END>>>` }]);
    const gateway = makeGateway(port, clock);
    const target = { mode: "fanqie", path: workPath };
    const req = { chapterId: "C001", mode: "deai" };
    const ctx = await revisePipeline.context(target, req, { clock, lock });
    const rec = makeRunRecord(ctx.runId, revisePipeline.kind, target, req, clock.iso());

    const done = await executePipeline(
      revisePipeline,
      rec,
      ctx,
      gateway,
      clock,
      new AbortController().signal,
    );
    assert.equal(done.state, "awaiting-author");
    assert.equal(port.calls.length, 1, "deai 专项模式应只走 1 轮模型调用");
    assert.ok(port.calls[0].user.includes("去 AI 腔"), "提示词应注入去 AI 腔专项指令");

    const official = await readChapter(workPath, "C001");
    assert.equal(official.body, originalBody);

    const metaRaw = await fs.readFile(
      path.join(workPath, "candidates", "C001", `${ctx.runId}.meta.json`),
      "utf8",
    );
    const meta = JSON.parse(metaRaw);
    assert.equal(meta.mode, "deai");
    assert.equal(meta.editorPass, false);
    assert.equal(meta.reviewPerformed, false);

    await updateWorkSettings(workPath, { requireEditorPass: true }, lock);
    const accepted = await acceptCandidate(
      workPath,
      { chapterId: "C001", candidateId: ctx.runId },
      lock,
    );
    assert.equal(accepted.meta.status, "drafted");
    assert.equal(accepted.meta.editorPass, false);
    await assert.rejects(
      () => finalizeChapter(workPath, { chapterId: "C001" }, lock),
      (err) => isAppError(err, "gate.denied"),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("chapterPipeline(continueFromExisting) 空章报错，半章锁定前缀续写并在修订篡改时自动回退", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-cont-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const workPath = path.join(root, "book-cont");
    await createWork(workPath, { id: "book-cont", title: "续写测试", grade: "economy" }, lock);
    const target = { mode: "fanqie", path: workPath };

    await saveChapter(workPath, { chapterId: "C001", title: "空章", body: "   " }, lock);
    const failPort = createFakeModelPort([]);
    const failCtx = await chapterPipeline.context(
      target,
      { chapterId: "C001", continueFromExisting: true, grade: "economy" },
      { clock, lock },
    );
    const failRec = makeRunRecord(
      failCtx.runId,
      chapterPipeline.kind,
      target,
      failCtx.request,
      clock.iso(),
    );
    await assert.rejects(
      () =>
        executePipeline(
          chapterPipeline,
          failRec,
          failCtx,
          makeGateway(failPort, clock),
          clock,
          new AbortController().signal,
        ),
      (err) => isAppError(err) && err.code === "input.invalid",
    );
    assert.equal(failPort.calls.length, 0);

    const prefix = makeLongBody("已写好的上半章前缀", 30);
    await saveChapter(workPath, { chapterId: "C001", title: "半章开篇", body: prefix }, lock);
    const tail = makeLongBody("无缝续写的下半章反转", 35);
    const okPort = createFakeModelPort([
      { text: FAKE_BEATS_JSON },
      { text: `# 半章开篇\n\n${tail}\n<<<END>>>` },
      { text: JSON.stringify({ issues: [] }) },
      { text: JSON.stringify({ verdict: "pass", issues: [], summary: "通过" }) },
    ]);
    const okCtx = await chapterPipeline.context(
      target,
      { chapterId: "C001", continueFromExisting: true, grade: "economy" },
      { clock, lock },
    );
    const okRec = makeRunRecord(
      okCtx.runId,
      chapterPipeline.kind,
      target,
      okCtx.request,
      clock.iso(),
    );
    const done = await executePipeline(
      chapterPipeline,
      okRec,
      okCtx,
      makeGateway(okPort, clock),
      clock,
      new AbortController().signal,
    );
    assert.equal(done.state, "awaiting-author");
    assert.ok(okPort.calls[1].user.includes("半章断点续写"), "应注入半章断点续写锚点指令");

    const candMd = await fs.readFile(
      path.join(workPath, "candidates", "C001", `${okCtx.runId}.md`),
      "utf8",
    );
    assert.ok(candMd.includes("已写好的上半章前缀"), "候选稿必须保留原有前缀");
    assert.ok(candMd.includes("无缝续写的下半章反转"), "候选稿必须包含续写后半段");

    const tamperedBody = makeLongBody("被修订模型篡改后的整章", 65);
    const guardPort = createFakeModelPort([
      { text: FAKE_BEATS_JSON },
      { text: `# 半章开篇\n\n${tail}\n<<<END>>>` },
      { text: JSON.stringify({ issues: [] }) },
      {
        text: JSON.stringify({
          verdict: "revise",
          issues: [{ kind: "reader", quote: "反转", issue: "节奏偏慢", fix: "加快节奏" }],
          summary: "需要修订",
        }),
      },
      { text: `# 半章开篇\n\n${tamperedBody}\n<<<END>>>` },
    ]);
    clock.advance(1000);
    const guardCtx = await chapterPipeline.context(
      target,
      { chapterId: "C001", continueFromExisting: true, grade: "economy" },
      { clock, lock },
    );
    const guardRec = makeRunRecord(
      guardCtx.runId,
      chapterPipeline.kind,
      target,
      guardCtx.request,
      clock.iso(),
    );
    const guardDone = await executePipeline(
      chapterPipeline,
      guardRec,
      guardCtx,
      makeGateway(guardPort, clock),
      clock,
      new AbortController().signal,
    );
    assert.equal(guardDone.state, "awaiting-author");
    const guardCand = await fs.readFile(
      path.join(workPath, "candidates", "C001", `${guardCtx.runId}.md`),
      "utf8",
    );
    assert.ok(guardCand.includes("已写好的上半章前缀"), "修订篡改前缀后应回退保留原前缀");
    assert.ok(!guardCand.includes("被修订模型篡改后的整章"), "篡改前缀的修订稿不得落盘");
    const guardMeta = JSON.parse(
      await fs.readFile(
        path.join(workPath, "candidates", "C001", `${guardCtx.runId}.meta.json`),
        "utf8",
      ),
    );
    assert.equal(guardMeta.editorPass, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("多分支衍生 derivedFrom、下游过时告警与设定集三分类沉淀", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-lineage-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const workPath = path.join(root, "book-lineage");
    await createWork(
      workPath,
      { id: "book-lineage", title: "多分支与沉淀测试", grade: "economy" },
      lock,
    );
    const target = { mode: "fanqie", path: workPath };

    await saveChapter(workPath, { chapterId: "C001", title: "第一章", body: "正式初稿" }, lock);
    const bodyA = makeLongBody("分支A独有剧情走向", 60);
    const bodyB = makeLongBody("分支B独有密室暗号", 60);
    const candDir1 = path.join(workPath, "candidates", "C001");
    await fs.mkdir(candDir1, { recursive: true });
    await fs.writeFile(path.join(candDir1, "cand-A.md"), `# 第一章A\n\n${bodyA}`, "utf8");
    await fs.writeFile(path.join(candDir1, "cand-B.md"), `# 第一章B\n\n${bodyB}`, "utf8");

    const c2Body = makeLongBody("承接分支B的第二章正文", 60);
    const port = createFakeModelPort([
      { text: FAKE_BEATS_JSON },
      { text: `# 第二章\n\n${c2Body}\n<<<END>>>` },
      { text: JSON.stringify({ issues: [] }) },
      { text: JSON.stringify({ verdict: "pass", issues: [], summary: "通过" }) },
    ]);
    const ctx = await chapterPipeline.context(
      target,
      { chapterId: "C002", previousCandidateId: "cand-B", grade: "economy" },
      { clock, lock },
    );
    const rec = makeRunRecord(ctx.runId, chapterPipeline.kind, target, ctx.request, clock.iso());
    const done = await executePipeline(
      chapterPipeline,
      rec,
      ctx,
      makeGateway(port, clock),
      clock,
      new AbortController().signal,
    );
    assert.equal(done.state, "awaiting-author");
    assert.ok(
      port.calls[1].system.includes("分支B独有密室暗号"),
      "L1 前文前缀（system）应读入 cand-B 正文",
    );

    const c2Cands = await listCandidates(workPath, "C002");
    assert.equal(c2Cands.length, 1);
    assert.deepEqual(c2Cands[0].derivedFrom, {
      kind: "candidate",
      chapterId: "C001",
      candidateId: "cand-B",
      sourceHash: sha256(bodyB),
    });

    const acceptA = await acceptCandidate(
      workPath,
      { chapterId: "C001", candidateId: "cand-A" },
      lock,
    );
    assert.equal(acceptA.staleDownstreamCandidates.length, 1);
    assert.equal(acceptA.staleDownstreamCandidates[0].chapterId, "C002");
    assert.equal(acceptA.staleDownstreamCandidates[0].derivedFromCandidateId, "cand-B");

    const acceptB = await acceptCandidate(
      workPath,
      { chapterId: "C001", candidateId: "cand-B" },
      lock,
    );
    assert.equal(acceptB.staleDownstreamCandidates.length, 0);
    const c2CandsAfter = await listCandidates(workPath, "C002");
    assert.deepEqual(c2CandsAfter[0].derivedFrom, {
      kind: "drafted",
      chapterId: "C001",
      sourceHash: sha256(bodyB),
    });

    const store = createBibleStore(lock, clock);
    const prov = { source: "author", at: clock.iso() };
    const seedPending = await store.propose(
      workPath,
      [
        {
          type: "entity.upsert",
          entity: {
            id: "ent-hero",
            kind: "character",
            name: "顾渊",
            aliases: ["阿渊"],
            summary: "初出茅庐",
            locked: ["左耳缺口"],
            provenance: prov,
          },
        },
        {
          type: "state.add",
          entry: {
            id: "st-old",
            entity: "ent-hero",
            field: "当前困境",
            value: "身陷地牢",
            since: 1,
            mode: "replace",
            status: "planned",
            provenance: prov,
          },
        },
      ],
      prov,
    );
    for (const item of seedPending) {
      await store.decide(workPath, item.id, "accept");
    }

    const triPending = await store.propose(
      workPath,
      [
        {
          type: "state.add",
          entry: {
            id: "st-resolved",
            entity: "ent-hero",
            field: "当前困境",
            value: "成功越狱",
            since: 3,
            mode: "replace",
            status: "planned",
            provenance: prov,
          },
        },
        {
          type: "state.add",
          entry: {
            id: "st-longterm",
            entity: "ent-hero",
            field: "境界",
            value: "金丹初期",
            since: 3,
            mode: "replace",
            status: "planned",
            provenance: prov,
          },
        },
        {
          type: "entity.upsert",
          entity: {
            id: "ent-hero",
            kind: "character",
            name: "顾渊",
            aliases: ["顾剑首"],
            summary: "越狱后执掌青冥剑",
            locked: ["青冥剑主"],
            provenance: prov,
          },
        },
      ],
      prov,
      [
        { settlement: "resolve_short_term" },
        { settlement: "settle_long_term" },
        { settlement: "update_profile" },
      ],
    );

    assert.equal(triPending[0].settlement, "resolve_short_term");
    assert.equal(triPending[1].settlement, "settle_long_term");
    assert.equal(triPending[2].settlement, "update_profile");

    for (const item of triPending) {
      await store.decide(workPath, item.id, "accept");
    }

    const finalBible = await store.read(workPath);
    const oldState = finalBible.states.find((s) => s.id === "st-old");
    assert.equal(oldState?.until, 3, "resolve_short_term 应为旧状态封口 until=3");
    const longState = finalBible.states.find((s) => s.id === "st-longterm");
    assert.equal(longState?.status, "confirmed", "settle_long_term 应确认为 confirmed");
    const hero = finalBible.entities.find((e) => e.id === "ent-hero");
    assert.deepEqual(hero?.aliases, ["阿渊", "顾剑首"], "update_profile 应合并别名而非覆盖丢失");
    assert.deepEqual(hero?.locked, ["左耳缺口", "青冥剑主"], "update_profile 应合并锁定事实");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("ledgerPipeline 在设定集空白时按章节号 C100 解析真实 position=100", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-ledger-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const workPath = path.join(root, "book-ledger");
    await createWork(workPath, { id: "book-ledger", title: "记账章号测试" }, lock);
    await saveChapter(
      workPath,
      { chapterId: "C100", title: "第一百章 决战", body: "林默登上孤峰，剑指苍穹。" },
      lock,
    );
    const target = { mode: "fanqie", path: workPath };
    const port = createFakeModelPort([
      {
        text: JSON.stringify({
          deltas: [
            {
              quote: "林默登上孤峰，剑指苍穹。",
              kind: "state",
              targetId: "ent-lin",
              name: "林默",
              detail: "登上孤峰迎战",
              field: "位置",
              value: "孤峰",
            },
          ],
        }),
      },
    ]);
    const ctx = await ledgerPipeline.context(target, { chapterId: "C100" }, { clock, lock });
    const rec = makeRunRecord(ctx.runId, ledgerPipeline.kind, target, ctx.request, clock.iso());
    const done = await executePipeline(
      ledgerPipeline,
      rec,
      ctx,
      makeGateway(port, clock),
      clock,
      new AbortController().signal,
    );
    assert.equal(done.state, "awaiting-author");
    const bible = await createBibleStore(lock, clock).read(workPath);
    const stOp = bible.pending.find((p) => p.op.type === "state.add")?.op;
    assert.equal(stOp?.type, "state.add");
    assert.equal(stOp?.entry.since, 100);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
