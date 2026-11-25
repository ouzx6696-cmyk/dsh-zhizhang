import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { createFakeModelPort } from "../support/fake-port.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { isAppError } = await importTs("packages/core/src/errors/index.ts");
const { createLockService } = await importTs("packages/core/src/lock/index.ts");
const { createModelGateway } = await importTs("packages/core/src/model/index.ts");
const { FORMAT_VERSION } = await importTs("packages/core/src/paths.ts");
const { emptyUsage, executePipeline } = await importTs("packages/core/src/pipeline/index.ts");
const { createBibleStore, traceEntityTimeline } = await importTs(
  "packages/fanqie/src/bible/index.ts",
);
const { chapterPipeline, commands, fanqieModule, revisePipeline } = await importTs(
  "packages/fanqie/src/index.ts",
);
const {
  acceptCandidate,
  createWork,
  importLegacyWork,
  listCandidates,
  listChapters,
  readChapter,
  saveChapter,
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

test("T2: revisePipeline(mode=deai) 无 issues 时单轮输出去 AI 腔候选且不改正式章节", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zz-v23-deai-"));
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

    // 正式章节保持原样（作者是裁判）
    const official = await readChapter(workPath, "C001");
    assert.equal(official.body, originalBody);

    // 候选稿与 .meta.json 落盘且标注 mode: "deai"
    const metaRaw = await fs.readFile(
      path.join(workPath, "candidates", "C001", `${ctx.runId}.meta.json`),
      "utf8",
    );
    const meta = JSON.parse(metaRaw);
    assert.equal(meta.mode, "deai");
    assert.equal(meta.editorPass, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("T2: chapterPipeline(continueFromExisting) 空章报错，半章保留前缀无缝续写", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zz-v23-cont-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const workPath = path.join(root, "book-cont");
    await createWork(workPath, { id: "book-cont", title: "续写测试", grade: "economy" }, lock);
    const target = { mode: "fanqie", path: workPath };

    // 1. 空章应报 input.invalid
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

    // 2. 半章已写正文时保留前缀并续写后半段
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
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("T3: traceEntityTimeline 按别名展开跨书串联并支持正文回查截断，工具保持 readonly", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zz-v23-trace-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const workPath = path.join(root, "book-trace");
    await createWork(workPath, { id: "book-trace", title: "回查测试" }, lock);
    const store = createBibleStore(lock, clock);
    const prov = { source: "author", at: clock.iso() };

    const pending = await store.propose(
      workPath,
      [
        {
          type: "entity.upsert",
          entity: {
            id: "ent-shen",
            kind: "character",
            name: "沈青蝉",
            aliases: ["青蝉", "沈师姐"],
            summary: "剑阁首徒",
            locked: [],
            provenance: prov,
          },
        },
        {
          type: "state.add",
          entry: {
            id: "st-shen-1",
            entity: "ent-shen",
            field: "伤势",
            value: "左肩中寒毒",
            since: 2,
            mode: "replace",
            status: "confirmed",
            provenance: prov,
          },
        },
        {
          type: "knowledge.set",
          row: {
            id: "kn-1",
            holder: "沈师姐",
            fact: "知晓黑市密道入口",
            level: "知情",
            since: 3,
          },
        },
        {
          type: "thread.upsert",
          thread: {
            id: "th-1",
            title: "寒毒解药",
            kind: "mystery",
            opened: 2,
            beats: [{ chapter: 4, kind: "push", note: "青蝉在药庐找到残方" }],
            status: "open",
          },
        },
        {
          type: "chapter.record",
          record: {
            chapter: "C001",
            position: 1,
            revision: "rev-001",
            summary: "沈青蝉雨夜出场救下主角",
            hook: "留下玉佩",
            emotion: "紧张",
            handoff: {
              ending: "离开客栈",
              openQuestions: [],
              positions: { 沈青蝉: "城北" },
              carried: [],
            },
          },
        },
      ],
      prov,
    );
    for (const item of pending) {
      await store.decide(workPath, item.id, "accept");
    }

    await saveChapter(
      workPath,
      {
        chapterId: "C001",
        title: "初逢",
        body: "雨水顺着檐角滴落，沈青蝉收剑入鞘，又听人喊了一声青蝉。",
      },
      lock,
    );
    await saveChapter(
      workPath,
      {
        chapterId: "C002",
        title: "寒毒",
        body: "药庐灯火微弱，沈师姐按住肩头伤处。",
      },
      lock,
    );

    // 查别名 "青蝉" 自动展开实体全部别名
    const traced = await traceEntityTimeline(
      workPath,
      "青蝉",
      { includeBody: true, maxBodyHits: 2 },
      lock,
    );
    assert.equal(traced.matchedEntity?.id, "ent-shen");
    assert.ok(traced.terms.includes("沈青蝉"));
    assert.ok(traced.terms.includes("沈师姐"));
    assert.equal(traced.events[0].chapter, null, "全局实体事件应排在最前");
    assert.equal(traced.events[0].source, "entity");

    const chapterNums = traced.events.filter((e) => e.chapter !== null).map((e) => e.chapter);
    const sortedNums = [...chapterNums].sort((a, b) => a - b);
    assert.deepEqual(chapterNums, sortedNums, "章节事件应按章节升序排列");

    const sources = new Set(traced.events.map((e) => e.source));
    for (const src of ["entity", "chapter", "state", "knowledge", "thread", "body"]) {
      assert.ok(sources.has(src), `时间线应包含 ${src} 来源`);
    }
    assert.equal(traced.bodyHitsTruncated, true, "超过 maxBodyHits=2 时应标记截断");

    // 确认助手工具存在且 readonly: true
    const tools = fanqieModule.tools("assistant", { mode: "fanqie", path: workPath });
    const traceTool = tools.find((t) => t.name === "fanqie_trace_entity");
    assert.ok(traceTool, "应注册 fanqie_trace_entity 工具");
    assert.equal(traceTool.readonly, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("T5: importLegacyWork 支持单 TXT 与多文件目录导入、原子落盘、原稿备份且零模型调用", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zz-v23-import-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const worksRoot = path.join(root, "works");
    await fs.mkdir(worksRoot, { recursive: true });

    // 1. 单 TXT 文件导入
    const txtPath = path.join(root, "old-book.txt");
    await fs.writeFile(
      txtPath,
      [
        "第一章 废材退婚",
        "苏家大厅气氛凝重，退婚书拍在案上。",
        "",
        "第2章 逆袭觉醒",
        "丹田深处亮起一道青光。",
      ].join("\n"),
      "utf8",
    );
    const resTxt = await importLegacyWork(
      {
        worksRoot,
        workId: "legacy-txt",
        title: "旧书单文件",
        sourcePath: txtPath,
        sourceKind: "single_txt",
        allowedRoot: root,
      },
      lock,
      clock,
    );
    assert.equal(resTxt.chapterCount, 2);
    assert.deepEqual(resTxt.chapterIds, ["C001", "C002"]);

    const txtChapters = await listChapters(resTxt.workPath);
    assert.equal(txtChapters.length, 2);
    assert.equal(txtChapters[0].status, "final");
    const c1 = await readChapter(resTxt.workPath, "C001");
    assert.ok(c1.body.includes("退婚书拍在案上"));
    const bible = await createBibleStore(lock, clock).read(resTxt.workPath);
    assert.deepEqual(bible.entities, []);
    const backupTxt = await fs.readFile(path.join(resTxt.backupDir, "old-book.txt"), "utf8");
    assert.ok(backupTxt.includes("第一章 废材退婚"));

    // 2. 文件夹自然序导入（10 排在 2 之后）
    const folderPath = path.join(root, "chapters-folder");
    await fs.mkdir(folderPath, { recursive: true });
    await fs.writeFile(path.join(folderPath, "第10章 终局.md"), "# 终局之战\n\n尘埃落定。", "utf8");
    await fs.writeFile(path.join(folderPath, "第2章 启程.txt"), "背起行囊走出山村。", "utf8");
    await fs.writeFile(
      path.join(folderPath, "第1章 初醒.md"),
      "# 初醒\n\n推开木窗见晨光。",
      "utf8",
    );

    const resFolder = await importLegacyWork(
      {
        worksRoot,
        workId: "legacy-folder",
        title: "旧书分章目录",
        sourcePath: folderPath,
        sourceKind: "folder",
        allowedRoot: root,
        chapterStatus: "drafted",
      },
      lock,
      clock,
    );
    assert.equal(resFolder.chapterCount, 3);
    const folderChapters = await listChapters(resFolder.workPath);
    assert.equal(folderChapters[0].title, "初醒");
    assert.equal(folderChapters[1].title, "第2章 启程");
    assert.equal(folderChapters[2].title, "终局之战");
    assert.equal(folderChapters[0].status, "drafted");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("T6: 多分支衍生 derivedFrom、下游过时告警与设定集三分类沉淀", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zz-v23-t6-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const workPath = path.join(root, "book-t6");
    await createWork(
      workPath,
      { id: "book-t6", title: "多分支与沉淀测试", grade: "economy" },
      lock,
    );
    const target = { mode: "fanqie", path: workPath };

    // 准备 C001 两个候选：cand-A 与 cand-B
    await saveChapter(workPath, { chapterId: "C001", title: "第一章", body: "正式初稿" }, lock);
    const bodyA = makeLongBody("分支A独有剧情走向", 60);
    const bodyB = makeLongBody("分支B独有密室暗号", 60);
    const candDir1 = path.join(workPath, "candidates", "C001");
    await fs.mkdir(candDir1, { recursive: true });
    await fs.writeFile(path.join(candDir1, "cand-A.md"), `# 第一章A\n\n${bodyA}`, "utf8");
    await fs.writeFile(path.join(candDir1, "cand-B.md"), `# 第一章B\n\n${bodyB}`, "utf8");

    // 写 C002 时指定 previousCandidateId = cand-B
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
    });

    // 采纳 C001 的 cand-A -> 应报告 C002 的候选为过时分支，且不修改 C002 文件
    const acceptA = await acceptCandidate(
      workPath,
      { chapterId: "C001", candidateId: "cand-A" },
      lock,
    );
    assert.equal(acceptA.staleDownstreamCandidates.length, 1);
    assert.equal(acceptA.staleDownstreamCandidates[0].chapterId, "C002");
    assert.equal(acceptA.staleDownstreamCandidates[0].derivedFromCandidateId, "cand-B");

    // 再采纳 C001 的 cand-B -> C002 的 derivedFrom 自动升级为 { kind: "final", chapterId: "C001" }
    const acceptB = await acceptCandidate(
      workPath,
      { chapterId: "C001", candidateId: "cand-B" },
      lock,
    );
    assert.equal(acceptB.staleDownstreamCandidates.length, 0);
    const c2CandsAfter = await listCandidates(workPath, "C002");
    assert.deepEqual(c2CandsAfter[0].derivedFrom, { kind: "final", chapterId: "C001" });

    // T6 设定集三分类沉淀：resolve_short_term / settle_long_term / update_profile
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

test("T3: traceEntityTimeline 对空白查询词抛出 input.invalid", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zz-v23-empty-"));
  try {
    let caught;
    try {
      await traceEntityTimeline(root, "   ");
    } catch (err) {
      caught = err;
    }
    assert.ok(isAppError(caught) && caught.code === "input.invalid");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
