import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";
import { createFakeClock } from "../support/clock.mjs";

const ROOT = process.cwd();
const desk = await importBundle("test/support/desktop-entry.ts");
const SCRIPTS = path.join(ROOT, "packages/toutiao/skill/scripts");

async function setup() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "zz-cmd-"));
  const root = path.join(base, "ws");
  const roots = {
    fanqie: path.join(root, "长篇"),
    toutiao: path.join(root, "头条"),
    library: path.join(root, "拆书库"),
  };
  for (const dir of Object.values(roots)) await fs.mkdir(dir, { recursive: true });
  const clock = createFakeClock();
  const dissectCalls = [];
  const ctx = {
    clock,
    locks: desk.createLockService(clock),
    inside(target) {
      const resolved = path.resolve(target);
      const rel = path.relative(root, resolved);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new desk.AppError("input.invalid", "outside", { path: resolved });
      }
      return resolved;
    },
    roots: () => roots,
    profiles: {
      builtin: (mode) => path.join(ROOT, "packages", mode, "profiles"),
      userDir: path.join(base, "state", "profiles"),
    },
    scriptsDir: SCRIPTS,
    workflow: {
      async startAndWait(target, kind, request) {
        dissectCalls.push({ target, kind, request });
        return {
          id: "dissect-1",
          state: "failed",
          error: { code: "model.auth", message: "未配置模型" },
        };
      },
    },
  };
  return { base, root, roots, ctx, dissectCalls };
}

const run = (ctx, command, input) => desk.dispatchWorkbenchCommand({ command, input }, ctx);

async function expectCode(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(desk.isAppError(err), true, `expected AppError, got ${err}`);
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    return true;
  });
}

const covered = new Set();
function mark(command) {
  covered.add(command);
  return command;
}

test("番茄命令：建书 → 写章 → 候选 → 导出 → 设定集，读写结果与门禁错误码都正确", async () => {
  const { roots, ctx, base } = await setup();
  const created = await run(ctx, mark("fanqie.work.create"), {
    root: roots.fanqie,
    title: "夜航",
    premise: "雨夜",
    grade: "economy",
  });
  const work = created.workPath;
  assert.equal(path.basename(work), "夜航");
  await expectCode(
    run(ctx, "fanqie.work.create", {
      root: roots.fanqie,
      title: "夜航",
      premise: "",
      grade: "economy",
    }),
    "input.invalid",
  );
  await expectCode(
    run(ctx, "fanqie.work.create", {
      root: path.join(base, "elsewhere"),
      title: "外面",
      premise: "",
      grade: "economy",
    }),
    "input.invalid",
  );

  assert.equal((await run(ctx, mark("fanqie.work.list"), { root: roots.fanqie })).works.length, 1);
  assert.equal((await run(ctx, mark("fanqie.work.get"), { work })).title, "夜航");
  assert.equal(
    (await run(ctx, mark("fanqie.work.settings"), { work, targetWords: 1000 })).settings
      .targetWords,
    1000,
  );

  const saved = await run(ctx, mark("fanqie.chapter.save"), {
    work,
    chapter: "ch-001",
    base: "",
    body: "林川推开门。\n\n他说道：走吧。",
    title: "雨夜",
  });
  assert.equal(saved.row.status, "drafted");
  assert.equal(saved.row.title, "雨夜");
  await expectCode(
    run(ctx, "fanqie.chapter.save", { work, chapter: "ch-001", base: "rev-stale", body: "x" }),
    "storage.conflict",
  );
  const resaved = await run(ctx, "fanqie.chapter.save", {
    work,
    chapter: "ch-001",
    base: saved.revision,
    body: "林川推开门。\n\n他攥紧拳头。",
  });
  assert.notEqual(resaved.revision, saved.revision);

  assert.equal((await run(ctx, mark("fanqie.chapter.list"), { work })).rows.length, 1);
  const chapter = await run(ctx, mark("fanqie.chapter.get"), { work, chapter: "ch-001" });
  assert.match(chapter.body, /攥紧拳头/);

  const snap = await run(ctx, mark("fanqie.snapshot"), { work });
  assert.equal(snap.full, true);
  const same = await run(ctx, "fanqie.snapshot", { work, since: snap.revision });
  assert.equal(same.full, false);

  await expectCode(
    run(ctx, mark("fanqie.chapter.finalize"), { work, chapter: "ch-001" }),
    "gate.denied",
  );

  const candDir = path.join(work, "candidates", "ch-001");
  await fs.mkdir(candDir, { recursive: true });
  await fs.writeFile(path.join(candDir, "c1.md"), "# 第一章 夜雨\n\n候选正文一。");
  await fs.writeFile(path.join(candDir, "c2.md"), "# 第一章 夜雨\n\n候选正文二。");
  assert.equal(
    (await run(ctx, mark("fanqie.candidate.list"), { work, chapter: "ch-001" })).candidates.length,
    2,
  );
  assert.match(
    (await run(ctx, mark("fanqie.candidate.get"), { work, chapter: "ch-001", candidateId: "c1" }))
      .body,
    /候选正文一/,
  );
  await expectCode(
    run(ctx, mark("fanqie.candidate.accept"), {
      work,
      chapter: "ch-001",
      candidateId: "c1",
      base: "rev-stale",
    }),
    "storage.conflict",
  );
  const accepted = await run(ctx, "fanqie.candidate.accept", {
    work,
    chapter: "ch-001",
    candidateId: "c1",
    base: resaved.revision,
  });
  assert.ok(accepted.revision);
  assert.ok(
    (
      await run(ctx, mark("fanqie.candidate.reject"), {
        work,
        chapter: "ch-001",
        candidateId: "c2",
      })
    ).rejectedAt,
  );

  const outTxt = path.join(base, "out", "book.txt");
  const exported = await run(ctx, mark("fanqie.book.export"), {
    work,
    format: "txt",
    finalOnly: false,
    outPath: outTxt,
  });
  assert.equal(exported.chapterCount, 1);
  assert.match(await fs.readFile(outTxt, "utf8"), /候选正文一/);
  const outDocx = path.join(base, "out", "book.docx");
  await run(ctx, "fanqie.book.export", {
    work,
    format: "docx",
    finalOnly: false,
    outPath: outDocx,
  });
  assert.ok((await fs.stat(outDocx)).size > 0);
  await expectCode(
    run(ctx, "fanqie.book.export", {
      work,
      format: "txt",
      finalOnly: false,
      outPath: "relative.txt",
    }),
    "input.invalid",
  );

  const bible = await run(ctx, mark("fanqie.bible.get"), { work });
  assert.deepEqual(bible.entities, []);
  const view = await run(ctx, mark("fanqie.bible.view"), { work, position: 1 });
  assert.equal(view.position, 1);
  const at = "2026-11-15T00:00:00.000Z";
  const proposed = await run(ctx, mark("fanqie.bible.propose"), {
    work,
    ops: [
      {
        type: "entity.upsert",
        entity: {
          id: "e-linchuan",
          kind: "character",
          name: "林川",
          aliases: ["川哥"],
          summary: "主角",
          locked: [],
          provenance: { source: "author", at },
          rev: 0,
        },
      },
    ],
    from: { source: "author", at },
  });
  assert.equal(proposed.items.length, 1);
  await expectCode(
    run(ctx, "fanqie.bible.propose", {
      work,
      ops: [{ type: "entity.upsert" }],
      from: { source: "author", at },
    }),
    "input.invalid",
  );
  const pendingBatches = await run(ctx, mark("fanqie.pending.list"), { work, status: "open" });
  assert.equal(pendingBatches.batches.length, 1);
  const batch = pendingBatches.batches[0].id;
  const pendingPage = await run(ctx, mark("fanqie.pending.get"), {
    work,
    batch,
    page: { offset: 0, limit: 10 },
  });
  assert.equal(pendingPage.total, 1);
  assert.deepEqual(
    await run(ctx, mark("fanqie.pending.decide"), {
      work,
      batch,
      decisions: [{ id: proposed.items[0].id, decision: "accept" }],
    }),
    { decided: 1 },
  );
  assert.equal(
    (await run(ctx, "fanqie.bible.get", { work })).entities.length,
    0,
    "决定只落批次，不写真源",
  );
  const zeroRevs = {
    entities: { rev: 0, hash: "" },
    timeline: { rev: 0, hash: "" },
    states: { rev: 0, hash: "" },
    threads: { rev: 0, hash: "" },
    knowledge: { rev: 0, hash: "" },
    style: { rev: 0, hash: "" },
    outline: { rev: 0, hash: "" },
  };
  const committed = await run(ctx, mark("fanqie.pending.commit"), {
    work,
    batch,
    expectedRevs: zeroRevs,
  });
  assert.equal(committed.committed, 1);
  assert.equal((await run(ctx, "fanqie.bible.get", { work })).entities.length, 1);
  assert.ok(
    Array.isArray((await run(ctx, mark("fanqie.bible.audit"), { work, upTo: 1 })).findings),
  );

  await expectCode(
    run(ctx, mark("fanqie.reference.bind"), { work, sourceId: "s1" }),
    "input.not_found",
  );
  const analyses = path.join(roots.library, "analyses", "s1");
  await fs.mkdir(analyses, { recursive: true });
  await fs.writeFile(
    path.join(analyses, "cards.json"),
    JSON.stringify([
      { id: "k1", title: "钩子", category: "节奏", pattern: "p", example: "e", usage: "u" },
    ]),
  );
  const bound = await run(ctx, "fanqie.reference.bind", { work, sourceId: "s1" });
  assert.equal(bound.boundCount, 1);
  assert.match(await fs.readFile(path.join(work, "plan", "references.json"), "utf8"), /"k1"/);
});

test("头条命令：建文章 → 登记来源 → 存稿 → 导出 → 状态流转 → 交稿，台账命令走真实规则脚本", async () => {
  const { roots, ctx, base } = await setup();
  await expectCode(
    run(ctx, mark("toutiao.article.create"), {
      root: roots.toutiao,
      genre: "不存在的体裁",
      driver: "账本型",
    }),
    "input.invalid",
  );
  const { articleDir } = await run(ctx, "toutiao.article.create", {
    root: roots.toutiao,
    genre: "短图文",
    driver: "账本型",
  });
  assert.equal((await run(ctx, mark("toutiao.articles"), { root: roots.toutiao })).rows.length, 1);

  assert.deepEqual(
    await run(ctx, mark("toutiao.source.register"), {
      articleDir,
      sourceId: "s1",
      kind: "paste",
      content: "养老金上调 2%。",
    }),
    { sourceId: "s1" },
  );
  await expectCode(
    run(ctx, "toutiao.source.register", {
      articleDir,
      sourceId: "../x",
      kind: "paste",
      content: "x",
    }),
    "input.invalid",
  );

  assert.deepEqual(await run(ctx, mark("toutiao.draft.get"), { articleDir }), {
    file: "",
    title: "",
    body: "",
    revision: "",
  });
  const draft1 = await run(ctx, mark("toutiao.draft.save"), {
    articleDir,
    title: "退休金到手多少",
    body: "第一版正文。",
  });
  assert.equal(path.basename(draft1.draftPath), "rev-001.md");
  assert.deepEqual(await run(ctx, "toutiao.draft.get", { articleDir }), {
    file: "rev-001.md",
    title: "退休金到手多少",
    body: "第一版正文。",
    revision: draft1.revision,
  });
  const draft2 = await run(ctx, "toutiao.draft.save", {
    articleDir,
    body: "第二版正文。",
    revision: draft1.revision,
  });
  assert.equal(path.basename(draft2.draftPath), "rev-002.md");
  await expectCode(
    run(ctx, "toutiao.draft.save", { articleDir, body: "过期", revision: draft1.revision }),
    "storage.conflict",
  );

  const outMd = path.join(base, "out", "article.md");
  const exported = await run(ctx, mark("toutiao.article.export"), {
    articleDir,
    outPath: outMd,
    format: "md",
  });
  assert.equal(exported.outPath, outMd);
  assert.match(await fs.readFile(outMd, "utf8"), /第二版正文/);

  await expectCode(
    run(ctx, mark("toutiao.article.transition"), { articleDir, to: "已交稿" }),
    "gate.denied",
  );
  assert.equal(
    (await run(ctx, "toutiao.article.transition", { articleDir, to: "待验收" })).status,
    "待验收",
  );
  await run(ctx, "toutiao.article.transition", { articleDir, to: "已验收" });
  await fs.writeFile(path.join(articleDir, "card.json"), "{}");
  await expectCode(
    run(ctx, "toutiao.article.deliver", {
      articleDir,
      title: "退休金到手多少",
      body: "终稿正文。",
    }),
    "input.invalid",
  );
  assert.equal(
    JSON.parse(await fs.readFile(path.join(articleDir, "meta.json"), "utf8")).status,
    "已验收",
  );
  await fs.rm(path.join(articleDir, "card.json"));
  const delivered = await run(ctx, mark("toutiao.article.deliver"), {
    articleDir,
    title: "退休金到手多少",
    body: "终稿正文。",
  });
  assert.match(
    await fs.readFile(delivered.deliveryPath, "utf8"),
    /——AI 到此止步。是否采用、何时发布由你决定。\n$/,
  );

  const ledgerPath = path.join(roots.toutiao, "ledger.csv");
  const empty = await run(ctx, mark("toutiao.ledger.show"), { ledgerPath });
  assert.equal(empty.total, 0);
  const cardPath = path.join(articleDir, "card.json");
  await expectCode(run(ctx, mark("toutiao.ledger.add"), { cardPath, ledgerPath }), "input.invalid");
  await fs.writeFile(
    cardPath,
    JSON.stringify({
      体裁: "短图文",
      主驱动: "账本型",
      内容线: "资讯线",
      垂类: "民生社保",
      主标题: "退休金到手多少",
      主问题: "到手多少",
      核心事实: ["上调2%"],
      读者: "职工",
    }),
  );
  const articleId = path.basename(articleDir);
  const added = await run(ctx, "toutiao.ledger.add", { cardPath, ledgerPath, articleId });
  assert.equal(added.row.主标题, "退休金到手多少");
  await expectCode(
    run(ctx, mark("toutiao.ledger.status"), { title: "不存在的标题", to: "已交稿", ledgerPath }),
    "input.not_found",
  );
  const moved = await run(ctx, "toutiao.ledger.status", {
    title: "退休金到手多少",
    to: "已交稿",
    ledgerPath,
    articleId,
  });
  assert.equal(moved.row.状态, "已交稿");
  await expectCode(
    run(ctx, mark("toutiao.metrics.import"), { articleId, metricsJson: "[]", ledgerPath }),
    "input.invalid",
  );
  const imported = await run(ctx, "toutiao.metrics.import", {
    articleId,
    metricsJson: JSON.stringify([{ 日期: "2026-11-15", 阅读: "100" }]),
    ledgerPath,
  });
  assert.equal(imported.row.阅读, "100");
  assert.equal((await run(ctx, "toutiao.ledger.show", { ledgerPath, last: 5 })).total, 1);
  await expectCode(
    run(ctx, "toutiao.ledger.show", { ledgerPath: path.join(base, "outside.csv") }),
    "input.invalid",
  );
});

test("方案命令：内置只读、复制后可编辑/重置/改名/切换/删除，删除需确认", async () => {
  const { ctx } = await setup();
  const listed = await run(ctx, mark("profiles.list"), { mode: "fanqie" });
  assert.equal(listed.active, "default");
  assert.ok(listed.profiles.some((p) => p.id === "default" && p.builtin));
  const detail = await run(ctx, mark("profiles.detail"), { mode: "fanqie" });
  assert.ok(detail.files.some((f) => f.id === "write-chapter.md"));
  const method = await run(ctx, mark("profiles.method"), {
    mode: "fanqie",
    id: "write-chapter.md",
  });
  assert.equal(method.method.from, "builtin");
  await expectCode(
    run(ctx, mark("profiles.save"), {
      mode: "fanqie",
      profile: "default",
      id: "write-chapter.md",
      text: "x",
    }),
    "gate.denied",
  );

  const { profile } = await run(ctx, mark("profiles.create"), {
    mode: "fanqie",
    name: "我的方案",
    note: "试用",
  });
  assert.deepEqual(
    await run(ctx, "profiles.save", {
      mode: "fanqie",
      profile,
      id: "write-chapter.md",
      text: "改过的方法",
    }),
    { saved: true },
  );
  const changed = await run(ctx, "profiles.method", {
    mode: "fanqie",
    profile,
    id: "write-chapter.md",
  });
  assert.equal(changed.method.text, "改过的方法");
  assert.ok(changed.base_text);
  assert.deepEqual(
    await run(ctx, mark("profiles.reset"), { mode: "fanqie", profile, id: "write-chapter.md" }),
    { reset: true },
  );
  assert.equal(
    (await run(ctx, "profiles.method", { mode: "fanqie", profile, id: "write-chapter.md" })).method
      .text,
    method.method.text,
  );
  assert.deepEqual(
    await run(ctx, mark("profiles.rename"), { mode: "fanqie", profile, name: "新名字" }),
    { profile },
  );
  assert.deepEqual(await run(ctx, mark("profiles.use"), { mode: "fanqie", profile }), { profile });
  assert.equal((await run(ctx, "profiles.list", { mode: "fanqie" })).active, profile);
  await expectCode(
    run(ctx, mark("profiles.delete"), { mode: "fanqie", profile, confirm: false }),
    "gate.denied",
  );
  assert.deepEqual(await run(ctx, "profiles.delete", { mode: "fanqie", profile, confirm: true }), {
    deleted: true,
  });
  assert.equal((await run(ctx, "profiles.list", { mode: "fanqie" })).active, "default");
  await expectCode(
    run(ctx, "profiles.use", { mode: "toutiao", profile: "missing" }),
    "input.not_found",
  );
});

test("拆书库命令：导入、列出、读卡；拆解经流水线发起，失败时带回流水线错误码", async () => {
  const { roots, ctx, dissectCalls } = await setup();
  const meta = await run(ctx, mark("library.import"), {
    libraryRoot: roots.library,
    id: "s1",
    title: "样书",
    content: "第一章 开端",
  });
  assert.equal(meta.id, "s1");
  assert.equal(
    (await run(ctx, mark("library.list"), { libraryRoot: roots.library })).sources.length,
    1,
  );
  assert.deepEqual(
    (await run(ctx, mark("library.cards"), { libraryRoot: roots.library, sourceId: "s1" })).cards,
    [],
  );
  await expectCode(
    run(ctx, mark("library.dissect"), {
      libraryRoot: roots.library,
      sourceId: "s1",
      title: "样书",
    }),
    "model.auth",
  );
  assert.equal(dissectCalls[0].kind, "library.dissect");
  assert.equal(dissectCalls[0].target.path, roots.library);
});

test("v1.4 新增命令已分派：未实现命令按负责卡返回 internal", async () => {
  const { roots, ctx } = await setup();
  const created = await run(ctx, "fanqie.work.create", {
    root: roots.fanqie,
    title: "契约占位",
    premise: "",
    grade: "economy",
  });
  const work = created.workPath;
  const stubs = [
    ["fanqie.outline.get", { work }, "D-01"],
    ["fanqie.outline.apply", { work, ops: [], expectedRev: 0 }, "D-01"],
    ["fanqie.outline.remapPreview", { work, ops: [] }, "D-03"],
    ["fanqie.outline.remapCommit", { work, token: "t", ops: [] }, "D-03"],
    ["fanqie.chapter.createFromPlan", { work, plan: "p-1" }, "D-03"],
    ["fanqie.import.stage", { work, token: "t" }, "I-01"],
    ["fanqie.import.resegment", { work, batch: "imp-1", rules: {} }, "I-01"],
    ["fanqie.import.select", { work, batch: "imp-1", sections: [] }, "I-01"],
    ["fanqie.import.proposal", { work, batch: "imp-1", page: { offset: 0, limit: 10 } }, "I-03"],
    ["fanqie.import.source", { work, batch: "imp-1", section: "S1" }, "I-03"],
    ["fanqie.import.list", { work }, "I-01"],
    ["fanqie.import.finish", { work, batch: "imp-1" }, "I-03"],
    ["fanqie.import.revert", { work, batch: "imp-1" }, "I-03"],
    ["fanqie.import.retryChunks", { work, batch: "imp-1", chunks: [] }, "I-04"],
    ["fanqie.check.run", { work, upTo: 1 }, "L-02"],
  ];
  for (const [command, input, card] of stubs) {
    mark(command);
    const err = await run(ctx, command, input).catch((error) => error);
    assert.equal(err.code, "internal", command);
    assert.match(err.message, new RegExp(card), command);
  }
  await expectCode(
    run(ctx, mark("fanqie.pending.get"), {
      work,
      batch: "imp-missing",
      page: { offset: 0, limit: 10 },
    }),
    "input.not_found",
  );
});

test("D-02 设定集命令：查询/实体/应用/变更/撤销都读写真源", async () => {
  const { roots, ctx } = await setup();
  const created = await run(ctx, "fanqie.work.create", {
    root: roots.fanqie,
    title: "设定库",
    premise: "",
    grade: "economy",
  });
  const work = created.workPath;
  const at = "2026-11-17T00:00:00.000Z";
  const applied = await run(ctx, mark("fanqie.bible.apply"), {
    work,
    expectedRev: 0,
    ops: [
      {
        type: "entity.upsert",
        entity: {
          id: "e-lin",
          kind: "character",
          name: "林川",
          aliases: [],
          summary: "主角",
          locked: [],
          provenance: { source: "author", at },
          rev: 0,
        },
      },
      {
        type: "state.add",
        entry: {
          id: "st-lin",
          entity: "e-lin",
          facet: "condition",
          field: "境界",
          value: "炼气",
          since: 1,
          mode: "replace",
          status: "confirmed",
          provenance: { source: "author", at },
          rev: 0,
        },
      },
    ],
  });
  assert.ok(applied.changeId);

  const queried = await run(ctx, mark("fanqie.bible.query"), {
    work,
    filter: { q: "林", facet: "condition" },
    position: 1,
    page: { offset: 0, limit: 10 },
  });
  assert.equal(queried.total, 1);
  assert.equal(queried.items[0].entity.id, "e-lin");
  assert.equal(queried.items[0].states.length, 1);

  const view = await run(ctx, mark("fanqie.bible.entity"), {
    work,
    id: "e-lin",
    position: 1,
  });
  assert.equal(view.entity.name, "林川");
  assert.deepEqual(view.relations, []);
  await expectCode(run(ctx, "fanqie.bible.entity", { work, id: "e-missing" }), "input.not_found");

  const changes = await run(ctx, mark("fanqie.bible.changes"), { work, limit: 10 });
  assert.equal(changes.changes[0].id, applied.changeId);
  assert.equal("ops" in changes.changes[0], false);

  const reverted = await run(ctx, mark("fanqie.bible.revert"), {
    work,
    changeId: applied.changeId,
  });
  assert.equal(reverted.changeIds.length, 1);
  assert.deepEqual(reverted.skipped, []);
  const bible = await run(ctx, "fanqie.bible.get", { work });
  assert.deepEqual(bible.entities, []);
  assert.deepEqual(bible.states, []);

  await expectCode(
    run(ctx, "fanqie.pending.get", {
      work,
      batch: "../escape",
      page: { offset: 0, limit: 10 },
    }),
    "input.invalid",
  );
});

test("命令分派覆盖契约里的全部 68 条命令，读写策略齐全，未知命令被拒绝", async () => {
  const all = Object.keys(desk.COMMAND_POLICY);
  assert.equal(all.length, 68);
  for (const command of all) assert.equal(desk.isWorkbenchCommand(command), true, command);
  assert.deepEqual(
    all.filter((c) => !covered.has(c)),
    [],
  );
  const { ctx } = await setup();
  await expectCode(run(ctx, "fanqie.chapter.delete", {}), "input.invalid");
  await expectCode(run(ctx, "fanqie.chapter.get", { work: "x" }), "input.invalid");
});
