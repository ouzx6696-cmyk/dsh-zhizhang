import { BOOK, setup, id, cardInput } from "./workflow-fixture.mjs";
import { createToolHarness } from "../helpers.mjs";
import { createPanel, jget } from "./helpers.mjs";
import { formatToolError } from "../../build/fanqie/src/engine/errors.js";
import { allTools } from "../../build/fanqie/src/engine/tools/index.js";
import { parseFanqieConfig } from "../../build/fanqie/src/config.js";
/** The writing product's main path and author-controlled decisions. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LibraryPort,
  InspirationPort,
  MultiDraftPort,
  FoundationPort,
} from "../../build/fanqie/src/engine/ports/index.js";
import { ensureStorage } from "../../build/fanqie/src/engine/storage/paths.js";
import {
  createWork,
  resolveWorkDir,
  setFoundation,
} from "../../build/fanqie/src/engine/work-store.js";
import {
  setOutline,
  readChapter,
  updateChapter,
} from "../../build/fanqie/src/engine/storage/chapters.js";
import { stageCandidate, readCandidate } from "../../build/fanqie/src/engine/storage/candidates.js";
import { buildPanelSnapshot } from "../../build/fanqie/src/engine/panel-query.js";
import { readWorkMeta } from "../../build/fanqie/src/engine/storage/work-meta.js";
import { methodsTools } from "../../build/fanqie/src/engine/tools/methods.js";
import { inspirationTools } from "../../build/fanqie/src/engine/tools/inspiration.js";
import { latestReview } from "../../build/fanqie/src/review.js";
import { VERSION } from "../../build/core/src/version.js";
import { patrolRhythm } from "../../build/fanqie/src/engine/rhythm-patrol.js";
import { withPortConfig } from "../../build/fanqie/src/engine/ports/config.js";
test("全量阅读须明确同意且确认参数不能变化，原计划保持可用", async () => {
  const f = await setup();
  try {
    const { sourceId } = await LibraryPort.importSource(f.paths, { title: "参考", text: BOOK });
    await f.run("fanqie_library_plan", { source: sourceId });
    const planPath = path.join(f.paths.library, "analyses", sourceId, "plan.json");
    const before = await readFile(planPath, "utf8");
    const cost = await f.run("fanqie_library_plan", {
      source: sourceId,
      mode: "full",
      reset: true,
      batch_chars: 4000,
    });
    const token = id(cost, /confirm_token：(fp-[a-z0-9-]+)/);
    assert.equal(await readFile(planPath, "utf8"), before);
    const refused = await f.run("fanqie_library_plan", {
      source: sourceId,
      mode: "full",
      confirm_full: true,
      confirm_token: token,
      batch_chars: 8000,
    });
    assert.match(refused, /bad_confirm_token/);
    assert.equal(await readFile(planPath, "utf8"), before);
    await f.run("fanqie_library_plan", {
      source: sourceId,
      mode: "full",
      confirm_full: true,
      confirm_token: token,
      batch_chars: 4000,
    });
    assert.equal(JSON.parse(await readFile(planPath, "utf8")).mode, "full");
  } finally {
    await f.close();
  }
});
test("A-02 Full 拆书：模型拿到 confirm_token 也要经作者门禁；作者拒绝时不替换计划", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "writer-full-gate-"));
  try {
    const paths = await ensureStorage(null, { storageRoot: root });
    const harness = await createToolHarness({
      mode: "fanqie",
      cwd: root,
      config: { storageRoot: root },
    });
    const run = async (name, args) => {
      try {
        return (await harness.execute(name, args)).value;
      } catch (error) {
        return formatToolError(error);
      }
    };
    const { sourceId } = await LibraryPort.importSource(paths, { title: "参考", text: BOOK });
    await run("fanqie_library_plan", { source: sourceId });
    const planPath = path.join(paths.library, "analyses", sourceId, "plan.json");
    const before = await readFile(planPath, "utf8");
    const cost = await run("fanqie_library_plan", { source: sourceId, mode: "full", reset: true });
    const token = id(cost, /confirm_token：(fp-[a-z0-9-]+)/);
    assert.equal(harness.approvals.length, 0, "成本回执本身不需要确认");
    harness.approved = false;
    const denied = await run("fanqie_library_plan", {
      source: sourceId,
      mode: "full",
      confirm_full: true,
      confirm_token: token,
    });
    assert.match(denied, /GATE_DENIED|作者/);
    assert.match(harness.approvals.at(-1).reason, /Full 全量拆书/);
    assert.equal(await readFile(planPath, "utf8"), before);
    harness.approved = true;
    await run("fanqie_library_plan", {
      source: sourceId,
      mode: "full",
      confirm_full: true,
      confirm_token: token,
    });
    assert.equal(JSON.parse(await readFile(planPath, "utf8")).mode, "full");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Auto 实际全量阅读须走成本回执和作者确认", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "writer-auto-full-"));
  try {
    const paths = await ensureStorage(null, { storageRoot: root });
    const harness = await createToolHarness({
      mode: "fanqie",
      cwd: root,
      config: { storageRoot: root },
    });
    const run = async (args) => {
      try {
        return (await harness.execute("fanqie_library_plan", args)).value;
      } catch (error) {
        return formatToolError(error);
      }
    };
    const book = Array.from(
      { length: 40 },
      (_, n) => `第${n + 1}章 故事\n${"人物在雨夜走进车站。".repeat(320)}`,
    ).join("\n");
    const { sourceId } = await LibraryPort.importSource(paths, { title: "参考", text: book });
    const defaultCost = await run({ source: sourceId, mode: "auto" });
    assert.match(defaultCost, /Full 成本回执/);
    const cost = await run({ source: sourceId, mode: "auto", ratio: 1 });
    const token = id(cost, /confirm_token：(fp-[a-z0-9-]+)/);
    harness.approved = false;
    assert.match(
      await run({
        source: sourceId,
        mode: "auto",
        ratio: 1,
        confirm_full: true,
        confirm_token: token,
      }),
      /GATE_DENIED|作者/,
    );
    await assert.rejects(readFile(path.join(paths.library, "analyses", sourceId, "plan.json")), {
      code: "ENOENT",
    });
    assert.match(
      await run({ source: sourceId, ratio: 1, confirm_full: true, confirm_token: token }),
      /GATE_DENIED|作者/,
    );
    harness.approved = true;
    await run({
      source: sourceId,
      mode: "auto",
      ratio: 1,
      confirm_full: true,
      confirm_token: token,
    });
    assert.equal(
      JSON.parse(
        await readFile(path.join(paths.library, "analyses", sourceId, "plan.json"), "utf8"),
      ).mode,
      "full",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("暂存后的书源变化须重新核对，未声明的阅读程度不推断为已读", async () => {
  const f = await setup();
  try {
    const { sourceId } = await LibraryPort.importSource(f.paths, { title: "参考", text: BOOK });
    const staged = await LibraryPort.stageCard(f.paths, cardInput(sourceId));
    const sourcePath = path.join(f.paths.library, "sources", `${sourceId}.txt`);
    await writeFile(sourcePath, BOOK + "\n作者修改。", "utf8");
    await assert.rejects(
      LibraryPort.acceptCard(f.paths, staged.candId),
      (e) => e.code === "source_changed",
    );
    const fresh = await LibraryPort.stageCard(f.paths, cardInput(sourceId));
    const { cardId } = await LibraryPort.acceptCard(f.paths, fresh.candId);
    assert.equal(
      (await LibraryPort.getCard(f.paths, cardId)).readingEvidence.chapters[0].readingLevel,
      "未声明",
    );
  } finally {
    await f.close();
  }
});
test("显式授权和定稿保护不接受字符串代替布尔值", async () => {
  const f = await setup();
  try {
    const { sessionId } = await InspirationPort.startSession(f.paths, { goal: "测试" });
    const staged = await InspirationPort.stageEmit(f.paths, sessionId, {
      kind: "foundation",
      payload: { planned: "计划" },
    });
    assert.equal(
      (await InspirationPort.acceptEmit(f.paths, staged.candId, { workKey: "作品", apply: "true" }))
        .applied,
      false,
    );
    await assert.rejects(resolveWorkDir(f.paths, "作品"), (e) => e.code === "work_not_found");
    await f.run("fanqie_project_create", { title: "作品" });
    await f.run("fanqie_outline_set", { work: "作品", chapter: "c001", ending: "结束" });
    assert.match(
      await f.run("fanqie_chapter_save", {
        work: "作品",
        chapter: "c001",
        content: "夜".repeat(300),
        confirm_bypass: "true",
      }),
      /bad_args.*confirm_bypass.*布尔值/,
    );
    await f.run("fanqie_chapter_save", {
      work: "作品",
      chapter: "c001",
      content: "已定稿正文",
      confirm_bypass: true,
    });
    const reviewedRevision = (await readChapter(await resolveWorkDir(f.paths, "作品"), "c001"))
      .revision;
    await f.run("fanqie_chapter_save", {
      work: "作品",
      chapter: "c001",
      status: "reviewed",
      expected_revision: reviewedRevision,
    });
    await f.run("fanqie_chapter_save", { work: "作品", chapter: "c001", status: "final" });
    const candId = id(
      await f.run("fanqie_candidate_stage", { work: "作品", chapter: "c001", content: "替换内容" }),
      /(cand-[a-z0-9]+)/,
    );
    await f.run("fanqie_style_lint", { work: "作品", candidate: candId });
    assert.match(
      await f.run("fanqie_candidate_accept", {
        work: "作品",
        candidate: candId,
        force: "false",
        skip_brief: true,
      }),
      /bad_args.*force.*布尔值/,
    );
    const dir = await resolveWorkDir(f.paths, "作品");
    assert.equal((await readChapter(dir, "c001")).body, "已定稿正文");
    assert.match(
      await f.run("fanqie_chapter_save", {
        work: "作品",
        chapter: "c001",
        content: "短稿覆盖",
        force: "true",
      }),
      /bad_args.*force.*布尔值/,
    );
    await f.run("fanqie_chapter_save", {
      work: "作品",
      chapter: "c001",
      content: "明确修订",
      force: true,
    });
    assert.equal((await readChapter(dir, "c001")).status, "drafted");
  } finally {
    await f.close();
  }
});
test("引擎工具工厂名称唯一，版本与桌面共享核心一致", async () => {
  const { engineTools } = await import("../../build/fanqie/src/engine/bootstrap.js");
  const tools = engineTools();
  assert.equal(tools.length, allTools().length);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
  const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  assert.equal(VERSION, pkg.version);
});

test("方法通道：forge_get 退役，method_get 方案优先、引擎兜底", async () => {
  const { engineTools } = await import("../../build/fanqie/src/engine/bootstrap.js");
  const { createFanqieTools } = await import("../../build/fanqie/src/tools.js");
  const { PLANNER_TOOLS } = await import("../../build/core/src/tool-roles.js");
  const engineNames = engineTools().map((t) => t.name);
  assert.ok(!engineNames.includes("fanqie_forge_get"));
  assert.ok(engineNames.includes("fanqie_method_get"));
  assert.ok(engineNames.includes("fanqie_method_list"));
  assert.ok(!PLANNER_TOOLS.has("fanqie_forge_get"));
  const writer = createFanqieTools({ config: {}, role: "writer" }).map((t) => t.name);
  assert.ok(!writer.includes("fanqie_forge_get"));
  const editor = createFanqieTools({ config: {}, role: "editor" }).map((t) => t.name);
  assert.ok(!editor.includes("fanqie_forge_get"));

  const f = await setup();
  try {
    // 方案方法优先：edit/revise 已退役出引擎资产，经当前方案（默认）返回人写长文档
    const edit = await f.run("fanqie_method_get", { id: "edit" });
    assert.match(edit, /## 方法 · edit（方案「默认」）/);
    assert.match(edit, /# 编辑审读：四类硬伤与 L1–L3/);
    assert.ok(!edit.includes("编辑过稿与修订层级"));
    const revise = await f.run("fanqie_method_get", { id: "revise" });
    assert.match(revise, /## 方法 · revise（方案「默认」）/);
    assert.match(revise, /# 受控修订/);
    // 引擎资产兜底：新合同 id 可取，旧 id 报未知方法
    const style = await f.run("fanqie_method_get", { id: "contract:style" });
    assert.match(style, /## 方法资产 · contract:style · 本书讲法与现场写作/);
    assert.match(
      await f.run("fanqie_method_get", { id: "style_contract" }),
      /未知方法：style_contract/,
    );
    // method_list 列两来源并集并标注来源
    const list = await f.run("fanqie_method_list");
    assert.match(list, /## 方案（profile）· 默认/);
    assert.match(list, /## 引擎资产（engine）/);
    assert.match(list, /- `edit` · 编辑审读：四类硬伤与 L1–L3/);
    assert.match(list, /- `contract:style` · 本书讲法与现场写作/);
  } finally {
    await f.close();
  }
});

test("chapter_brief：lean 只附 contract:style，full 四方法包不再注入 edit/revise", async () => {
  const f = await setup();
  try {
    const { dir, meta } = await createWork(f.paths, { title: "作品" });
    await setOutline(dir, "c001", { ending: "门开了" }, "第一章");
    const brief = methodsTools().find((t) => t.name === "fanqie_chapter_brief");
    const lean = await brief.execute(
      { chapter: "c001", work: meta.key, working_dir: f.root, skip_cards: true },
      { cwd: f.root },
    );
    assert.match(lean, /# 方法（lean · 仅 contract:style；其它用 fanqie_method_get）/);
    assert.match(lean, /## 方法资产 · contract:style · 本书讲法与现场写作/);
    const full = await brief.execute(
      {
        chapter: "c001",
        work: meta.key,
        working_dir: f.root,
        skip_cards: true,
        brief_mode: "full",
      },
      { cwd: f.root },
    );
    for (const asset of ["novel_sense", "contract:style", "draft", "tomato_four_q"])
      assert.match(full, new RegExp(`## 方法资产 · ${asset} · `), asset);
    assert.ok(!full.includes("## 方法资产 · edit"));
    assert.ok(!full.includes("## 方法资产 · revise"));
  } finally {
    await f.close();
  }
});

test("多草稿默认关闭，开启后统一稿仍只是候选", async () => {
  const f = await setup();
  try {
    const { dir, meta } = await createWork(f.paths, { title: "作品" });
    await setOutline(dir, "c001", { ending: "结束" }, "第一章");
    assert.match(
      await f.run("fanqie_candidate_unify_brief", { work: meta.key, chapter: "c001" }),
      new RegExp(MultiDraftPort.disabledCode),
    );
    const enabled = await createToolHarness({
      mode: "fanqie",
      cwd: f.root,
      config: { storageRoot: f.root, multiDraft: { enabled: true } },
    });
    const first = await stageCandidate(dir, { chapterId: "c001", body: "甲稿" });
    const second = await stageCandidate(dir, { chapterId: "c001", body: "乙稿" });
    const staged = (
      await enabled.execute("fanqie_candidate_unify_stage", {
        work: meta.key,
        content: "统一稿",
        candidate_ids: [first.id, second.id],
      })
    ).value;
    const candidate = await readCandidate(dir, id(staged, /(cand-[a-z0-9]+)/));
    assert.deepEqual(candidate.unifyOf, [first.id, second.id]);
    assert.equal((await readChapter(dir, "c001")).body, "");
  } finally {
    await f.close();
  }
});
test("全书、卷、幕规划仅在采纳后进入对应章节并保留来源", async () => {
  const f = await setup();
  try {
    const { dir, meta } = await createWork(f.paths, { title: "作品" });
    await setOutline(dir, "c001", { ending: "门开了" }, "第一章");
    const { sessionId } = await InspirationPort.startSession(f.paths, {
      goal: "悬疑慢燃",
      pace: "慢燃",
    });
    const book = await InspirationPort.stageEmit(f.paths, sessionId, {
      kind: "book_plan",
      payload: { content: "全书计划" },
    });
    assert.equal((await readWorkMeta(dir)).planning, undefined);
    await InspirationPort.acceptEmit(f.paths, book.candId, { workKey: meta.key, apply: true });
    const vol = await InspirationPort.stageEmit(f.paths, sessionId, {
      kind: "volume_plan",
      payload: { id: "v1", title: "一卷", content: "卷计划", chapters: ["c001"] },
    });
    await InspirationPort.acceptEmit(f.paths, vol.candId, { workKey: meta.key, apply: true });
    const act = await InspirationPort.stageEmit(f.paths, sessionId, {
      kind: "act_plan",
      payload: { id: "a1", title: "一幕", content: "幕计划", volumeId: "v1", chapters: ["c001"] },
    });
    await InspirationPort.acceptEmit(f.paths, act.candId, { workKey: meta.key, apply: true });
    const tool = methodsTools().find((t) => t.name === "fanqie_chapter_brief");
    const brief = await tool.execute(
      { chapter: "c001", work: meta.key, working_dir: f.root, skip_cards: true },
      { cwd: f.root },
    );
    for (const expected of ["全书计划", "卷计划", "幕计划", "悬疑慢燃", "不证明实际阅读"])
      assert.ok(brief.includes(expected), expected);
    const panel = await buildPanelSnapshot(dir, f.paths, { includeHtml: false });
    assert.equal(panel.inspiration.planning.volumes.length, 1);
    assert.equal(panel.inspiration.planning.acts.length, 1);
    const status = inspirationTools().find((t) => t.name === "fanqie_inspire_status");
    const history = await status.execute(
      { work: meta.key, history: true, working_dir: f.root },
      { cwd: f.root },
    );
    assert.ok(history.includes(book.candId));
    assert.ok(history.includes(vol.candId));
    const detail = await status.execute(
      { candidate: act.candId, working_dir: f.root },
      { cwd: f.root },
    );
    assert.ok(detail.includes("幕计划"));
  } finally {
    await f.close();
  }
});

test("片段分析不建公共索引，迁移包按显式选择进入规划", async () => {
  const f = await setup();
  try {
    const reference = JSON.parse(
      await f.run("fanqie_reference_analyze", {
        text: "她拿出旧收据。对方核对原簿后放行。",
        question: "依据怎样改变回应",
        report: "可核材料使交涉的回应发生变化。",
        quotes: ["对方核对原簿后放行"],
        transfer_json: JSON.stringify({
          experience: "回应有依据",
          steps: ["给出可接触材料", "让回应取决于核对"],
          recreate: ["人物所求与材料"],
          discard: ["原作事件链"],
          failWhen: "证据超出证明力",
        }),
        save: true,
      }),
    );
    await assert.rejects(
      stat(path.join(f.paths.library, "index.json")),
      (e) => e.code === "ENOENT",
    );
    const { sessionId } = await InspirationPort.startSession(f.paths, {
      goal: "原创一场交涉",
      referenceIds: [reference.id],
    });
    assert.match(await InspirationPort.forgeBrief(f.paths, sessionId), /回应有依据/);
    const staged = await InspirationPort.stageEmit(f.paths, sessionId, {
      kind: "outline",
      payload: {
        chapter: "c001",
        synopsis: "以本书材料推动交涉",
        beats: "提出材料、核对、决定",
        knowledge: "各自只知道已接触材料",
      },
    });
    await InspirationPort.acceptEmit(f.paths, staged.candId, { workKey: "原创", apply: true });
    assert.match(
      await f.run("fanqie_chapter_brief", { work: "原创", chapter: "c001" }),
      /提出材料、核对、决定/,
    );
    const changed = JSON.parse(
      await readFile(path.join(f.root, "analyses", reference.id + ".json"), "utf8"),
    );
    const next = await InspirationPort.stageEmit(f.paths, sessionId, {
      kind: "book_plan",
      payload: { content: "后续候选" },
    });
    changed.report = "来源成果已修订";
    await writeFile(path.join(f.root, "analyses", reference.id + ".json"), JSON.stringify(changed));
    await assert.rejects(
      InspirationPort.acceptEmit(f.paths, next.candId, { workKey: "原创", apply: true }),
      (e) => e.code === "reference_changed",
    );
  } finally {
    await f.close();
  }
});

test("多个工具实例并行使用各自配置与会话作品", async () => {
  const { createToolHarness, tempDir } = await import("../helpers.mjs");
  const roots = await Promise.all([tempDir(), tempDir()]);
  try {
    const instances = await Promise.all(
      roots.map((root, index) =>
        createToolHarness({
          mode: "fanqie",
          cwd: root,
          config: { storageRoot: root, multiDraft: { enabled: index === 0 } },
        }),
      ),
    );
    await Promise.all(
      instances.map((harness, index) =>
        harness.call("fanqie_project_create", { title: "作品" + index }),
      ),
    );
    const status = await Promise.all(instances.map((harness) => harness.call("fanqie_status")));
    assert.match(status[0], /作品0/);
    assert.doesNotMatch(status[0], /作品1/);
    assert.match(status[1], /作品1/);
    assert.doesNotMatch(status[1], /作品0/);
  } finally {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

test("前章变更和插入前章使候选与审读依据失效", async () => {
  const { currentContextBasis } = await import("../../build/fanqie/src/engine/storage/chapters.js");
  const { updateChapter, acceptCandidate } =
    await import("../../build/fanqie/src/engine/work-store.js");
  const f = await setup();
  try {
    for (const insert of [false, true]) {
      const { dir } = await createWork(f.paths, { title: insert ? "插入前章" : "前章改稿" });
      await updateChapter(dir, { id: "c001", title: "一", body: "旧前章。", position: 1 });
      await updateChapter(dir, { id: "c002", title: "二", body: "现行正文。", position: 3 });
      const target = insert ? "c001" : "c002";
      const basis = await currentContextBasis(dir, target);
      const candidate = await stageCandidate(dir, {
        chapterId: target,
        body: "新候选。",
        capturedBasis: basis,
        expectedRevision: basis.targetRevision,
      });
      await updateChapter(dir, {
        id: target,
        status: "reviewed",
        expectedRevision: basis.targetRevision,
      });
      if (insert)
        await updateChapter(dir, { id: "c000", title: "新增", body: "新增前章。", position: 0 });
      else await updateChapter(dir, { id: "c001", title: "一", body: "前章改稿。" });
      await assert.rejects(
        acceptCandidate(dir, candidate.id),
        (error) => error.code === "dependency_changed",
      );
      await assert.rejects(
        updateChapter(dir, { id: target, status: "final" }),
        (error) => error.code === "dependency_changed",
      );
      assert.equal((await readChapter(dir, target)).status, "reviewed");
    }
  } finally {
    await f.close();
  }
});

test("RC-04 删已绑定的卡同步解绑；历史悬空绑定报 craft_binding_dangling，repair 后恢复", async () => {
  const f = await setup();
  try {
    const { meta } = await createWork(f.paths, { title: "绑定作品" });
    const { sourceId } = await LibraryPort.importSource(f.paths, { title: "原文", text: BOOK });
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const staged = await LibraryPort.stageCard(f.paths, cardInput(sourceId));
      ids.push((await LibraryPort.acceptCard(f.paths, staged.candId)).cardId);
    }
    const { sessionId } = await InspirationPort.startSession(f.paths, { goal: "绑", cardIds: ids });
    const { candId } = await InspirationPort.stageEmit(f.paths, sessionId, {
      kind: "foundation",
      payload: { planned: "寻找证据" },
    });
    await InspirationPort.acceptEmit(f.paths, candId, { workKey: meta.key, apply: true });
    const file = path.join(f.paths.inspiration, "bindings.json");
    // 1. deleting through the port also removes the binding (same file shape)
    const removed = await LibraryPort.discardCard(f.paths, ids[0]);
    assert.deepEqual(removed.unboundWorks, [meta.key]);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8"))[meta.key], [ids[1]]);
    assert.deepEqual(
      (await InspirationPort.resolveCardsForBrief(f.paths, { workKey: meta.key })).cardIds,
      [ids[1]],
    );
    // 2. a dangling binding left by an older version is a clear error, not a raw card_not_found
    await writeFile(file, JSON.stringify({ [meta.key]: ["card-gone", ids[1]] }));
    await assert.rejects(
      InspirationPort.resolveCardsForBrief(f.paths, { workKey: meta.key }),
      (error) => error.code === "craft_binding_dangling" && /card-gone/.test(error.message),
    );
    const repaired = await f.run("fanqie_inspire_status", {
      work: meta.key,
      repair: "unbind_dangling",
    });
    assert.match(repaired, /已解除.*card-gone/);
    assert.deepEqual(
      (await InspirationPort.resolveCardsForBrief(f.paths, { workKey: meta.key })).cardIds,
      [ids[1]],
    );
  } finally {
    await f.close();
  }
});

test("A-01 灵感应用只以规划字段为依据：采纳章节后仍可应用，章纲真被改时拒绝", async () => {
  const f = await setup();
  try {
    const { meta, dir } = await createWork(f.paths, { title: "依据作品" });
    const { cardId } = await acceptedCard(f);
    await setOutline(dir, "c001", { ending: "交出钥匙" }, "第一章");
    const session = async () =>
      (
        await InspirationPort.startSession(f.paths, {
          goal: "依据",
          cardIds: [cardId],
          workKey: meta.key,
        })
      ).sessionId;
    const stage = async (sessionId) =>
      (
        await InspirationPort.stageEmit(f.paths, sessionId, {
          kind: "foundation",
          payload: { planned: "寻找证据" },
        })
      ).candId;
    // 1. writing and reviewing a chapter is not a planning change
    const first = await stage(await session());
    await updateChapter(dir, { id: "c001", body: "她交出了钥匙。" });
    await InspirationPort.acceptEmit(f.paths, first, { workKey: meta.key, apply: true });
    // 2. a real outline change is still refused
    const second = await stage(await session());
    await setOutline(dir, "c001", { ending: "拒绝交出钥匙" });
    await assert.rejects(
      InspirationPort.acceptEmit(f.paths, second, { workKey: meta.key, apply: true }),
      (error) => error.code === "planning_changed",
    );
  } finally {
    await f.close();
  }
});

async function acceptedCard(f) {
  const { sourceId } = await LibraryPort.importSource(f.paths, { title: "参考书", text: BOOK });
  const candidate = await LibraryPort.stageCard(f.paths, cardInput(sourceId));
  const { cardId } = await LibraryPort.acceptCard(f.paths, candidate.candId);
  return { sourceId, cardId };
}

test("拆书审计：书源正文被删时逐卡记为来源缺失，不让整次审计报错", async () => {
  const f = await setup();
  try {
    const { sourceId, cardId } = await acceptedCard(f);
    await rm(path.join(f.paths.library, "sources", `${sourceId}.txt`));
    const out = await f.run("fanqie_library_audit");
    assert.doesNotMatch(out, /^错误/, out);
    assert.match(out, new RegExp(`硬问题：差数引出疑问（${cardId}）`));
    assert.match(out, /来源缺失/);
  } finally {
    await f.close();
  }
});

test("拆书库索引 JSON 损坏时报 library_index_invalid，而不是裸语法错误", async () => {
  const f = await setup();
  try {
    await acceptedCard(f);
    await writeFile(path.join(f.paths.library, "index.json"), "{broken");
    const out = await f.run("fanqie_library_search", { query: "差数" });
    assert.match(out, /错误\[library_index_invalid\]/);
    assert.equal(await readFile(path.join(f.paths.library, "index.json"), "utf8"), "{broken");
  } finally {
    await f.close();
  }
});

test("暂存后书源元数据缺失：采纳报 source_not_found 且候选保持未采纳", async () => {
  const f = await setup();
  try {
    const { sourceId } = await LibraryPort.importSource(f.paths, { title: "参考书", text: BOOK });
    const { candId } = await LibraryPort.stageCard(f.paths, cardInput(sourceId));
    await rm(path.join(f.paths.library, "sources", `${sourceId}.json`));
    const out = await f.run("fanqie_library_card_accept", { candidate: candId });
    assert.match(out, /错误\[source_not_found\]/);
    assert.equal((await LibraryPort.getCandidate(f.paths, candId)).status, "drafted");
  } finally {
    await f.close();
  }
});

// —— T14 文风卡三段式 + 迁移试写 ——
/** 23 字 × 10 = 230 字：落在迁移试写 200–300 字区间内的原创演示片段。 */
const TRIAL_SAMPLE = "他把伞尖抵住门槛，先听雨声，再决定要不要开口。".repeat(10);
function styleCardInput(sourceId) {
  return {
    ...cardInput(sourceId),
    source: sourceId,
    title: "雨夜收束式开场",
    dimension: "prose",
    body: "短句起势，物件承接，抒情延后。",
    readerWant: "雨夜悬念怎么起",
    emotionArc: "压着到松一口气",
    dramaticUnit: "借物写雨夜",
    replaceables: ["雨夜", "物件"],
    mustNotCopy: ["原书桥段"],
    transfer: "把物件承接用于任何场景开场",
    styleMust: ["先给可核对的具体物，再给情绪"],
    styleForbidden: ["连用三句以上排比抒情"],
    styleSceneAdjust: ["对话场景短句可放宽到口语"],
    transferSample: TRIAL_SAMPLE,
  };
}

test("T14 文风卡：三段式缺段或迁移试写字数越界报错不静默，齐全则暂存入库", async () => {
  const f = await setup();
  try {
    const { sourceId } = await LibraryPort.importSource(f.paths, { title: "参考书", text: BOOK });
    const unsupported = await f.run("fanqie_library_card_stage", {
      ...styleCardInput(sourceId),
      human_feel: { writerCraft: "细节落纸", voice: "未支持的旧字段" },
    });
    assert.match(unsupported, /错误\[bad_args\].*voice/);
    const missing = await f.run("fanqie_library_card_stage", {
      ...styleCardInput(sourceId),
      styleMust: [],
      styleSceneAdjust: undefined,
    });
    assert.match(missing, /错误\[bad_module\]/);
    assert.match(missing, /文风卡 styleMust 不能为空（必须贯彻，至少 1 条）/);
    assert.match(missing, /文风卡 styleSceneAdjust 不能为空（按场景调节，至少 1 条）/);
    const short = await f.run("fanqie_library_card_stage", {
      ...styleCardInput(sourceId),
      transferSample: TRIAL_SAMPLE.slice(0, 69),
    });
    assert.match(short, /错误\[bad_module\]/);
    assert.match(short, /文风卡 transferSample 须 200–300 字（现 69 字）/);
    const long = await f.run("fanqie_library_card_stage", {
      ...styleCardInput(sourceId),
      transferSample: TRIAL_SAMPLE + "他又把伞收了回去。".repeat(10),
    });
    assert.match(long, /错误\[bad_module\]/);
    assert.match(long, /文风卡 transferSample 须 200–300 字（现 320 字）/);
    const staged = await f.run("fanqie_library_card_stage", {
      ...styleCardInput(sourceId),
      human_feel: cardInput(sourceId).humanFeel,
    });
    const candId = id(staged, /(lcand-[a-z0-9]+)/);
    const cand = await LibraryPort.getCandidate(f.paths, candId);
    assert.deepEqual(cand.styleMust, ["先给可核对的具体物，再给情绪"]);
    assert.equal(cand.transferSample.length, 230);
    // 普通卡（hook 维度）不要求三段式，原路径不受影响
    assert.match(
      await f.run("fanqie_library_card_stage", { ...cardInput(sourceId), source: sourceId }),
      /卡候选已暂存/,
    );
  } finally {
    await f.close();
  }
});

test("T14 文风卡采纳：三段+试写带日期与卡号追加进 foundation.style，既有文风保留；普通卡不动根基", async () => {
  const f = await setup();
  try {
    const { sourceId } = await LibraryPort.importSource(f.paths, { title: "参考书", text: BOOK });
    const candId = id(
      await f.run("fanqie_library_card_stage", styleCardInput(sourceId)),
      /(lcand-[a-z0-9]+)/,
    );
    const { dir, meta } = await createWork(f.paths, { title: "文风作品" });
    await setFoundation(dir, { style: "既有约束：短句收束。" });
    const out = await f.run("fanqie_library_card_accept", { candidate: candId, work: meta.key });
    assert.match(out, /已采纳技法卡「雨夜收束式开场」/);
    assert.match(out, /文风三段\+迁移试写已追加进作品「文风作品」foundation\.style/);
    const after = await readWorkMeta(dir);
    assert.match(
      after.foundation.style,
      /^既有约束：短句收束。\n\n【文风卡 card-[a-z0-9]+ · \d{4}-\d{2}-\d{2}】雨夜收束式开场\n必须贯彻：\n- 先给可核对的具体物，再给情绪\n绝对禁止：\n- 连用三句以上排比抒情\n按场景调节：\n- 对话场景短句可放宽到口语\n迁移试写（原创演示，禁止复述原书句子）：\n/,
    );
    assert.ok(after.foundation.style.includes(TRIAL_SAMPLE));
    // 普通卡（hook 维度）采纳：不解析作品、不写根基
    const craftId = id(
      await f.run("fanqie_library_card_stage", { ...cardInput(sourceId), source: sourceId }),
      /(lcand-[a-z0-9]+)/,
    );
    assert.match(
      await f.run("fanqie_library_card_accept", { candidate: craftId }),
      /已采纳技法卡「差数引出疑问」/,
    );
    assert.equal((await readWorkMeta(dir)).foundation.style, after.foundation.style);
  } finally {
    await f.close();
  }
});

test("T14 文风卡采纳缺目标作品：报 no_work，不静默跳过根基写入", async () => {
  const f = await setup();
  try {
    const { sourceId } = await LibraryPort.importSource(f.paths, { title: "参考书", text: BOOK });
    const candId = id(
      await f.run("fanqie_library_card_stage", styleCardInput(sourceId)),
      /(lcand-[a-z0-9]+)/,
    );
    const out = await f.run("fanqie_library_card_accept", { candidate: candId });
    assert.match(out, /错误\[no_work\]：还没有作品/);
    assert.equal((await LibraryPort.getCandidate(f.paths, candId)).status, "drafted");
  } finally {
    await f.close();
  }
});

test("文风卡入库后写入失败可指定作品重试，重复重试不会重复追加", async () => {
  const f = await setup();
  const append = FoundationPort.appendStyle;
  try {
    const { sourceId } = await LibraryPort.importSource(f.paths, { title: "参考书", text: BOOK });
    const candId = id(
      await f.run("fanqie_library_card_stage", styleCardInput(sourceId)),
      /(lcand-[a-z0-9]+)/,
    );
    const { dir, meta } = await createWork(f.paths, { title: "文风作品" });
    await setFoundation(dir, { style: "既有约束" });
    FoundationPort.appendStyle = async () => {
      throw new Error("模拟写入失败");
    };
    const failure = await f.run("fanqie_library_card_accept", {
      candidate: candId,
      work: meta.key,
    });
    assert.match(failure, /已采纳.*模拟写入失败/);
    assert.match(failure, new RegExp(`work=${meta.key}`));
    const saved = await LibraryPort.getCandidate(f.paths, candId);
    assert.ok(saved.acceptedCardId);
    assert.equal((await readWorkMeta(dir)).foundation.style, "既有约束");
    FoundationPort.appendStyle = append;
    assert.match(
      await f.run("fanqie_library_card_accept", { candidate: candId }),
      /须明确指定目标 work/,
    );
    assert.match(
      await f.run("fanqie_library_card_accept", { candidate: candId, work: meta.key }),
      /已追加进作品/,
    );
    const style = (await readWorkMeta(dir)).foundation.style;
    assert.match(style, new RegExp(`文风卡 ${saved.acceptedCardId}`));
    assert.match(
      await f.run("fanqie_library_card_accept", { candidate: candId, work: meta.key }),
      /未重复追加/,
    );
    assert.equal((await readWorkMeta(dir)).foundation.style, style);
    assert.equal((await LibraryPort.listCards(f.paths)).length, 1);
  } finally {
    FoundationPort.appendStyle = append;
    await f.close();
  }
});

test("T14 lean 简报：foundation.style 全文带入，超 1500 字软上限截断并注明；full 不截断", async () => {
  const f = await setup();
  try {
    const { dir, meta } = await createWork(f.paths, { title: "截断作品" });
    await setOutline(dir, "c001", { ending: "门开了" }, "第一章");
    await setFoundation(dir, { style: "短".repeat(1600) });
    const lean = await f.run("fanqie_chapter_brief", { work: meta.key, chapter: "c001" });
    assert.match(lean, /## 本书有效讲法/);
    assert.ok(lean.includes("短".repeat(1500)));
    assert.ok(!lean.includes("短".repeat(1501)));
    assert.match(lean, /（超过 1500 字软上限，已截断；完整文风约束用 fanqie_foundation_get 查看）/);
    const full = await f.run("fanqie_chapter_brief", {
      work: meta.key,
      chapter: "c001",
      brief_mode: "full",
    });
    assert.ok(full.includes("短".repeat(1600)));
    assert.doesNotMatch(full, /超过 1500 字软上限/);
    await setFoundation(dir, { style: "短句收束，少用成语。" });
    const small = await f.run("fanqie_chapter_brief", { work: meta.key, chapter: "c001" });
    assert.match(small, /短句收束，少用成语。/);
    assert.doesNotMatch(small, /软上限/);
  } finally {
    await f.close();
  }
});

// —— T15 编辑审读读者标尺附表 ——
const RULER_ITEMS = [
  "期待清楚",
  "局面改变",
  "本章变化",
  "兑现在场",
  "对手",
  "章末",
  "接续",
  "人味",
  "追读意愿",
];
const RULER9 = RULER_ITEMS.map((item, index) => ({
  item,
  score: (index % 5) + 1,
  evidence: `${item}的一句证据。`,
}));
function rulerReviewBase(meta) {
  return {
    work: meta.key,
    chapter: "c001",
    verdict: "通过",
    hard_issues: [],
    levels: [],
    reread_full: true,
    changed_scope: "未改",
  };
}

test("T15 review_report：readers_ruler 可选附表——九项齐全才收，缺省不附，附上则落盘并在回执渲染", async () => {
  const f = await setup();
  try {
    const { dir, meta } = await createWork(f.paths, { title: "标尺作品" });
    await setOutline(dir, "c001", { ending: "门开了" }, "第一章");
    await updateChapter(dir, { id: "c001", title: "站台", body: "林川把票递到窗口，售票员没接。" });
    const base = rulerReviewBase(meta);
    const incomplete = await f.run("fanqie_review_report", {
      ...base,
      readers_ruler: [RULER9[0]],
    });
    assert.match(incomplete, /readers_ruler 须正好 9 项（九项齐全，不重复）/);
    const unknown = await f.run("fanqie_review_report", {
      ...base,
      readers_ruler: RULER9.map((r, i) => (i === 0 ? { ...r, item: "文笔华丽" } : r)),
    });
    assert.match(unknown, /读者标尺项只能是/);
    const badScore = await f.run("fanqie_review_report", {
      ...base,
      readers_ruler: RULER9.map((r, i) => (i === 1 ? { ...r, score: 6 } : r)),
    });
    assert.match(badScore, /读者标尺 局面改变 的分数须为 1–5 整数/);
    const noEvidence = await f.run("fanqie_review_report", {
      ...base,
      readers_ruler: RULER9.map((r, i) => (i === 2 ? { ...r, evidence: "  " } : r)),
    });
    assert.match(noEvidence, /读者标尺 本章变化 须附一句证据/);
    const attached = await f.run("fanqie_review_report", { ...base, readers_ruler: RULER9 });
    assert.match(
      attached.markdown,
      /读者标尺附表（仅作版本排序参考；不改变四类硬伤与 L1–L3 判定）/,
    );
    assert.match(attached.markdown, /期待清楚：1\/5 — 期待清楚的一句证据。/);
    assert.deepEqual(attached.readers_ruler, RULER9);
    const saved = await latestReview(dir, "c001");
    assert.deepEqual(saved.readers_ruler, RULER9);
    const plain = await f.run("fanqie_review_report", base);
    assert.doesNotMatch(plain.markdown, /读者标尺附表/);
    const plainSaved = await latestReview(dir, "c001");
    assert.equal("readers_ruler" in plainSaved, false);
  } finally {
    await f.close();
  }
});

test("拆书简报：批次模式给逐章原文与事实模板，整书模式给原文摘录", async () => {
  const f = await setup();
  try {
    const { sourceId } = await LibraryPort.importSource(f.paths, { title: "参考书", text: BOOK });
    const batch = await f.run("fanqie_library_dissect_brief", {
      source: sourceId,
      mode: "opening",
    });
    assert.match(batch, /### 第1章 差三罐\n<<<SOURCE\n[^]*少了三罐咖啡[^]*SOURCE>>>/);
    assert.match(batch, /### 第2章 四秒/);
    assert.match(batch, /"readingLevel": "正文已读"/);
    assert.match(batch, /下一步 4\/9：按批调用 fanqie_library_facts_stage/);
    const full = await f.run("fanqie_library_dissect_brief", {
      source: sourceId,
      mode: "full",
      from: 2,
      count: 1,
    });
    assert.match(full, /无 plan 的 mode=full 只取 from 起数章/);
    assert.match(full, /### 第2章 四秒/);
    assert.doesNotMatch(full, /### 第1章/);
    const whole = await f.run("fanqie_library_dissect_brief", { source: sourceId });
    assert.match(whole, /## 原文摘录\n<<<SOURCE\n第1章 差三罐/);
    assert.match(whole, /card_stage → card_accept/);
  } finally {
    await f.close();
  }
});

test("拆书检索：标题浅命中与卡内深命中都能找到，无关词不命中", async () => {
  const f = await setup();
  try {
    const { cardId } = await acceptedCard(f);
    assert.match(await f.run("fanqie_library_search", { query: "差数" }), new RegExp(cardId));
    // 「换成其他差数」只在机制 rebuild 里，需深读卡全文。
    assert.match(
      await f.run("fanqie_library_search", { query: "换成其他差数" }),
      new RegExp(cardId),
    );
    assert.doesNotMatch(
      await f.run("fanqie_library_search", { query: "飞船" }),
      new RegExp(cardId),
    );
  } finally {
    await f.close();
  }
});

test("章节不存在时读章与审计报 chapter_not_found，不泄露裸文件错误；缺文件的已登记章仍可补建", async () => {
  const f = await setup();
  try {
    const { dir, meta } = await createWork(f.paths, { title: "作品" });
    for (const tool of ["fanqie_chapter_read", "fanqie_style_lint"]) {
      const out = await f.run(tool, { work: meta.key, chapter: "c404" });
      assert.match(out, /错误\[chapter_not_found\]：章节不存在：c404/, `${tool}: ${out}`);
      assert.doesNotMatch(out, /ENOENT|\.md/, `${tool}: ${out}`);
    }
    await setOutline(dir, "c001", { synopsis: "旧梗概" }, "第一章");
    await rm(path.join(dir, "chapters", "c001.md"));
    await setOutline(dir, "c001", { synopsis: "补建" });
    const rebuilt = await readChapter(dir, "c001");
    assert.equal(rebuilt.outline.synopsis, "补建");
    await writeFile(path.join(dir, "chapters", "c001.md"), "---\n{broken\n---\n正文");
    await assert.rejects(
      setOutline(dir, "c001", { synopsis: "不能盖掉坏稿" }),
      (e) => e.code === "bad_chapter",
    );
  } finally {
    await f.close();
  }
});

test("改动前章时修订影响列出直接与间接依赖它的后章", async () => {
  const f = await setup();
  try {
    const { dir } = await createWork(f.paths, { title: "依赖链" });
    await updateChapter(dir, { id: "c001", title: "一", body: "门开了。" });
    for (const id of ["c002", "c003"]) {
      await updateChapter(dir, { id, title: id, body: `${id} 的正文。` });
      await updateChapter(dir, {
        id,
        status: "reviewed",
        expectedRevision: (await readChapter(dir, id)).revision,
      });
    }
    assert.deepEqual(
      (await readChapter(dir, "c003")).dependencies.map((d) => d.chapterId),
      ["c002"],
    );
    await updateChapter(dir, {
      id: "c001",
      body: "门没开。",
      expectedRevision: (await readChapter(dir, "c001")).revision,
    });
    const impact = (await readWorkMeta(dir)).revisionImpacts.at(-1);
    assert.equal(impact.chapterId, "c001");
    assert.deepEqual(impact.dependents, ["c002", "c003"]);
  } finally {
    await f.close();
  }
});

// ---------------------------------------------------------------------------
// T7 写手工具面收窄（toolset.narrowed，默认关）
const NARROWED_EXCLUDED = [
  "fanqie_payoff_audit",
  "fanqie_human_feel_audit",
  "fanqie_novel_sense_audit",
  "fanqie_style_lint",
  "fanqie_review_ledger",
  "fanqie_library_audit",
  "fanqie_library_import",
  "fanqie_library_plan",
  "fanqie_library_dissect_brief",
  "fanqie_library_facts_stage",
  "fanqie_library_structure_stage",
  "fanqie_library_card_stage",
  "fanqie_library_card_accept",
  "fanqie_library_card_discard",
  "fanqie_library_report",
];

test("T7 收窄开关默认关：写手工具面与现状逐项一致", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "writer-narrow-off-"));
  const plain = await createToolHarness({ mode: "fanqie", cwd: root, config: {} });
  const off = await createToolHarness({
    mode: "fanqie",
    cwd: root,
    config: { toolset: { narrowed: false } },
  });
  try {
    const names = [...plain.tools.keys()].sort();
    assert.deepEqual([...off.tools.keys()].sort(), names);
    // 59 基数 + T10 的 5 个连续性工具（foreshadow_set / knowledge_set / continuity_commit /
    // continuity_get / continuity_migrate）+ 本工作树已有的 fanqie_opening_audit
    assert.equal(names.length, 65);
    for (const excluded of NARROWED_EXCLUDED) assert.ok(names.includes(excluded), excluded);
    assert.ok(names.includes("fanqie_product_map"));
    for (const continuity of [
      "fanqie_foreshadow_set",
      "fanqie_knowledge_set",
      "fanqie_continuity_commit",
      "fanqie_continuity_get",
      "fanqie_continuity_migrate",
    ])
      assert.ok(names.includes(continuity), continuity);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T7 收窄开关开启：写手默认集去掉诊断旁路与拆书写入工具，导航保留", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "writer-narrow-on-"));
  const harness = await createToolHarness({
    mode: "fanqie",
    cwd: root,
    config: { toolset: { narrowed: true } },
  });
  try {
    const names = [...harness.tools.keys()].sort();
    // 44 基数 + T10 连续性 5 工具；fanqie_opening_audit 属诊断旁路已进收窄排除名单
    assert.equal(names.length, 49);
    for (const excluded of NARROWED_EXCLUDED)
      assert.ok(!names.includes(excluded), `不应出现 ${excluded}`);
    for (const kept of [
      "fanqie_product_map",
      "fanqie_library_list",
      "fanqie_library_search",
      "fanqie_library_card_get",
      "fanqie_library_combo_suggest",
      "fanqie_chapter_brief",
      "fanqie_candidate_stage",
      "fanqie_candidate_accept",
    ])
      assert.ok(names.includes(kept), kept);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T7 收窄写手：采纳旁路开关被门禁拒绝，无参调用不受影响，编辑与规划角色不收窄", async () => {
  const f = await setup({ toolset: { narrowed: true } });
  try {
    const { dir, meta } = await createWork(f.paths, { title: "收窄作品" });
    await setOutline(dir, "c001", { ending: "门开了" }, "第一章");
    await f.run("fanqie_chapter_brief", { work: meta.key, chapter: "c001" });
    const candId = id(
      await f.run("fanqie_candidate_stage", {
        work: meta.key,
        chapter: "c001",
        content: "第一版正文。",
      }),
      /(cand-[a-z0-9]+)/,
    );
    const denied = await f.run("fanqie_candidate_accept", {
      work: meta.key,
      candidate: candId,
      strict_lint: true,
    });
    assert.match(denied, /【门禁 fanqie\.writer_narrowed_accept_flags】/);
    assert.match(denied, /写手默认工具集不开放 strict_lint 参数/);
    assert.match(denied, /该旁路属规划\/诊断用途，请在任务说明里说明需求或由作者在规划角色执行/);
    assert.equal((await readChapter(dir, "c001")).body, "");

    assert.match(
      await f.run("fanqie_candidate_accept", { work: meta.key, candidate: candId }),
      /已采纳/,
    );

    const candId2 = id(
      await f.run("fanqie_candidate_stage", {
        work: meta.key,
        chapter: "c001",
        content: "第二版正文。",
      }),
      /(cand-[a-z0-9]+)/,
    );
    assert.match(
      await f.run("fanqie_candidate_edit_decide", {
        work: meta.key,
        candidate: candId2,
        choice: "A",
        confirm_accept_after_edit: true,
        require_payoff: true,
      }),
      /【门禁 fanqie\.writer_narrowed_edit_flags】.*require_payoff/,
    );
    assert.match(
      await f.run("fanqie_candidate_edit_decide", {
        work: meta.key,
        candidate: candId2,
        choice: "C",
      }),
      /edit_accept_not_an_edit/,
    );

    const editor = await createToolHarness({
      mode: "fanqie",
      cwd: f.root,
      role: "editor",
      config: { toolset: { narrowed: true } },
    });
    const editorNames = [...editor.tools.keys()];
    assert.ok(editorNames.includes("fanqie_style_lint"));
    assert.ok(editorNames.includes("fanqie_payoff_audit"));
    const planner = await createToolHarness({
      mode: "fanqie",
      cwd: f.root,
      role: "planner",
      config: { toolset: { narrowed: true } },
    });
    assert.ok([...planner.tools.keys()].includes("fanqie_library_import"));
    for (const other of [editor, planner])
      assert.ok(!other.gates.rules.some((rule) => rule.id.startsWith("fanqie.writer_narrowed")));
  } finally {
    await f.close();
  }
});

test("T7 toolset 配置解析：narrowed 缺省关，非布尔报 issue", async () => {
  assert.equal(parseFanqieConfig({}).value?.toolset, undefined);
  assert.equal(parseFanqieConfig({ toolset: { narrowed: true } }).value?.toolset?.narrowed, true);
  assert.equal(parseFanqieConfig({ toolset: { narrowed: false } }).value?.toolset?.narrowed, false);
  for (const bad of [{ narrowed: "yes" }, { narrowed: 1 }, "x", 3]) {
    const parsed = parseFanqieConfig({ toolset: bad });
    assert.equal(parsed.value, undefined);
    assert.match(parsed.issues[0].message, /fanqie\.toolset 应为 \{ narrowed: 布尔值 \}/);
    assert.deepEqual(parsed.issues[0].path, ["fanqie", "toolset"]);
  }
});

// —— T10 结构化连续性（开关 continuity.enabled，默认关）——

const CONTINUITY_ON = { continuity: { enabled: true } };

async function continuityWork(f, title) {
  const { dir, meta } = await createWork(f.paths, { title });
  return { dir, key: meta.key };
}

test("T10 开关默认关：连续性工具报 continuity_disabled，不建 continuity/ 目录，配置同构解析", async () => {
  const f = await setup();
  try {
    const { dir, key } = await continuityWork(f, "关闭矩阵");
    for (const [name, args] of [
      [
        "fanqie_foreshadow_set",
        { work: key, line: "L1", title: "t", seed: "s", planned_plant: 1, planned_payoff: 2 },
      ],
      [
        "fanqie_knowledge_set",
        { work: key, id: "k1", fact: "f", holders: [{ who: "甲", level: "知情", since: 1 }] },
      ],
      ["fanqie_continuity_commit", { work: key, chapter: "c001" }],
      ["fanqie_continuity_get", { work: key }],
      ["fanqie_continuity_migrate", { work: key }],
    ]) {
      assert.match(await f.run(name, args), /错误\[continuity_disabled\]：连续性未开启/, name);
    }
    await assert.rejects(stat(path.join(dir, "continuity")), (e) => e.code === "ENOENT");
    assert.equal(parseFanqieConfig({}).value?.continuity, undefined);
    assert.equal(
      parseFanqieConfig({ continuity: { enabled: true } }).value?.continuity?.enabled,
      true,
    );
    assert.equal(parseFanqieConfig({ continuity: {} }).value?.continuity?.enabled, false);
    for (const bad of [{ enabled: "yes" }, { enabled: 1 }, "x", 3]) {
      const parsed = parseFanqieConfig({ continuity: bad });
      assert.equal(parsed.value, undefined);
      assert.match(parsed.issues[0].message, /fanqie\.continuity 应为 \{ enabled: 布尔值 \}/);
      assert.deepEqual(parsed.issues[0].path, ["fanqie", "continuity"]);
    }
  } finally {
    await f.close();
  }
});

test("T10 commit：confirmed 推进线状态并写 handoff，missing/conflict 如实列出，unplanned 只列候选", async () => {
  const f = await setup(CONTINUITY_ON);
  try {
    const { dir, key } = await continuityWork(f, "核验作品");
    await setOutline(dir, "c001", { pov: "林晚第三人称", knowledge: "林晚不知哥哥到站" }, "第一章");
    await updateChapter(dir, {
      id: "c001",
      title: "第一章",
      body: "哥哥的到站短信亮着。林晚把铜钥匙塞进兜里，偏偏说出了「地窖里有暗门」。红木匣还在桌上。",
    });
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "L1",
      title: "钥匙线",
      seed: "铜钥匙能开门",
      planned_plant: 1,
      planned_payoff: 3,
      beats: [{ chapter: 1, kind: "埋设", note: "钥匙入兜", evidence: ["铜钥匙"] }],
    });
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "L2",
      title: "缺证线",
      seed: "s",
      planned_plant: 1,
      planned_payoff: 4,
      beats: [{ chapter: 1, kind: "埋设", note: "缺证的一笔", evidence: ["从来没有这句"] }],
    });
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "L3",
      title: "冲突线",
      seed: "s",
      planned_plant: 1,
      planned_payoff: 1,
      beats: [
        { chapter: 1, kind: "埋设", note: "部分命中", evidence: ["红木匣", "绝对不在的句子"] },
      ],
    });
    await f.run("fanqie_knowledge_set", {
      work: key,
      id: "k1",
      fact: "哥哥已到站",
      holders: [
        { who: "哥哥", level: "知情", since: 1, evidence: "到站短信" },
        { who: "林晚", level: "不知", since: 1 },
      ],
    });
    await f.run("fanqie_knowledge_set", {
      work: key,
      id: "k2",
      fact: "地窖里有暗门",
      holders: [{ who: "林晚", level: "不知", since: 1 }],
    });

    const result = JSON.parse(
      await f.run("fanqie_continuity_commit", { work: key, chapter: "c001" }),
    );
    const statusByLine = Object.fromEntries(result.beats.map((b) => [b.line, b.status]));
    assert.equal(statusByLine.L1, "confirmed");
    assert.equal(statusByLine.L2, "missing");
    assert.equal(statusByLine.L3, "conflict");
    assert.match(result.beats.find((b) => b.line === "L1").quote, /铜钥匙/);
    assert.match(result.beats.find((b) => b.line === "L3").detail, /部分命中/);
    assert.equal(result.knowledge.find((k) => k.id === "k1")?.status, "confirmed");
    assert.ok(result.unplanned.some((u) => u.knowledgeId === "k2" && u.who === "林晚"));
    assert.deepEqual(result.linesAdvanced, [
      { id: "L1", from: "planned", to: "written" },
      { id: "L3", from: "planned", to: "missed" },
    ]);

    const handoff = JSON.parse(
      await readFile(path.join(dir, "continuity", "handoff", "c001.json"), "utf8"),
    );
    assert.ok(handoff.mustCarry.some((m) => m.includes("钥匙入兜")));
    assert.ok(handoff.mustCarry.some((m) => m.includes("哥哥已到站")));
    assert.ok(handoff.openLoops.some((m) => m.includes("L2")));
    assert.ok(handoff.openLoops.some((m) => m.includes("L3")));
    const commits = JSON.parse(
      await readFile(path.join(dir, "continuity", "commits.json"), "utf8"),
    );
    assert.equal(commits.commits.length, 1);
    assert.deepEqual(commits.commits[0].beats, ["L1:1"]);
    assert.deepEqual(commits.commits[0].knowledge, ["k1"]);
    const foreshadow = JSON.parse(
      await readFile(path.join(dir, "continuity", "foreshadow.json"), "utf8"),
    );
    assert.equal(foreshadow.lines.find((l) => l.id === "L1").status, "written");
    assert.equal(foreshadow.lines.find((l) => l.id === "L2").status, "planned");
    assert.equal(foreshadow.lines.find((l) => l.id === "L3").status, "missed");

    // revision 绑定：显式给错 revision 如实报冲突
    assert.match(
      await f.run("fanqie_continuity_commit", { work: key, chapter: "c001", revision: "deadbeef" }),
      /revision_conflict/,
    );
    // 幂等：同 revision 重复 commit 不重复写
    assert.match(
      await f.run("fanqie_continuity_commit", { work: key, chapter: "c001" }),
      /本章已在 revision \w{12,} 核验过/,
    );
    assert.equal(commits.commits.length, 1);
  } finally {
    await f.close();
  }
});

test("T10 committed 线锁写：payoff 核验通过 → committed；再改动该线报错", async () => {
  const f = await setup(CONTINUITY_ON);
  try {
    const { dir, key } = await continuityWork(f, "锁写作品");
    await updateChapter(dir, { id: "c001", title: "一", body: "他捡到一把铜钥匙。" });
    await updateChapter(dir, { id: "c002", title: "二", body: "钥匙插进锁孔，门开了。" });
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "LK",
      title: "开锁线",
      seed: "s",
      planned_plant: 1,
      planned_payoff: 2,
      beats: [
        { chapter: 1, kind: "埋设", note: "得钥匙", evidence: ["铜钥匙"] },
        { chapter: 2, kind: "兑现", note: "开锁", evidence: ["钥匙插进锁孔"] },
      ],
    });
    await f.run("fanqie_continuity_commit", { work: key, chapter: "c001" });
    let foreshadow = JSON.parse(
      await readFile(path.join(dir, "continuity", "foreshadow.json"), "utf8"),
    );
    assert.equal(foreshadow.lines.find((l) => l.id === "LK").status, "written");
    const result = JSON.parse(
      await f.run("fanqie_continuity_commit", { work: key, chapter: "c002" }),
    );
    assert.deepEqual(result.linesAdvanced, [{ id: "LK", from: "written", to: "committed" }]);
    foreshadow = JSON.parse(
      await readFile(path.join(dir, "continuity", "foreshadow.json"), "utf8"),
    );
    assert.equal(foreshadow.lines.find((l) => l.id === "LK").status, "committed");
    assert.match(
      await f.run("fanqie_foreshadow_set", { work: key, line: "LK", title: "改名" }),
      /foreshadow_committed/,
    );
  } finally {
    await f.close();
  }
});

test("T10 commit 门禁：未作者确认被拦且不落盘；确认后钉定当前 revision", async () => {
  const f = await setup(CONTINUITY_ON);
  try {
    const { dir, key } = await continuityWork(f, "门禁作品");
    await updateChapter(dir, { id: "c001", title: "一", body: "铜钥匙在桌角。" });
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "L1",
      title: "钥匙",
      seed: "s",
      planned_plant: 1,
      planned_payoff: 2,
      beats: [{ chapter: 1, kind: "埋设", note: "n", evidence: ["铜钥匙"] }],
    });
    const denied = await createToolHarness({
      mode: "fanqie",
      cwd: f.root,
      config: { ...CONTINUITY_ON, storageRoot: f.root },
      confirm: async () => false,
    });
    await assert.rejects(
      denied.execute("fanqie_continuity_commit", { work: key, chapter: "c001" }),
      (e) => /作者取消了操作/.test(e.message),
    );
    assert.ok(denied.approvals.some((a) => a.name === "fanqie_continuity_commit"));
    await assert.rejects(
      stat(path.join(dir, "continuity", "commits.json")),
      (e) => e.code === "ENOENT",
    );
    // 默认确认链：ask → 放行 → revision 钉定为当前正文版本
    await f.run("fanqie_continuity_commit", { work: key, chapter: "c001" });
    const commits = JSON.parse(
      await readFile(path.join(dir, "continuity", "commits.json"), "utf8"),
    );
    assert.equal(commits.commits[0].revision, (await readChapter(dir, "c001")).revision);
  } finally {
    await f.close();
  }
});

test("T10 召回：50 章模拟作品注入 10 处知情越界 + 5 条被遗忘伏笔，巡检召回 ≥12/15", async () => {
  const f = await setup(CONTINUITY_ON);
  try {
    const { dir, key } = await continuityWork(f, "召回作品");
    const KNOWER = "沈青梧";
    const UNKNOWER = "陆行舟";
    const facts = Array.from({ length: 10 }, (_, i) => `玄铁令${i + 1}号藏在井底的暗格`);
    // 50 章正文：中性填充 + 越界章（不知者与事实同句）+ 对照章（知情者与事实同句，不应召回）
    const violationChapters = [];
    const controlChapters = [];
    for (let i = 0; i < 10; i++) violationChapters.push(6 + i * 3);
    for (const c of violationChapters) controlChapters.push(c + 1);
    for (let c = 1; c <= 50; c++) {
      let body = `第${c}章：两人在长街上换了一次位置，风把灯吹得晃了晃，茶凉了一半。`;
      const vIndex = violationChapters.indexOf(c);
      if (vIndex >= 0 && vIndex < 9) body += `${UNKNOWER}忽然想起「${facts[vIndex]}」，径直照做。`;
      const cIndex = controlChapters.indexOf(c);
      if (cIndex >= 0) body += `${KNOWER}记着「${facts[cIndex]}」，没有说破。`;
      // 第 10 处越界用转述（无事实原文）→ 机械巡检召回不了，留在断言里体现非 100%
      if (c === 36) body = `第36章：${UNKNOWER}照着心里的念头，把井底那个暗格翻了出来。`;
      await updateChapter(dir, { id: `c${String(c).padStart(3, "0")}`, title: `第${c}章`, body });
    }
    for (let i = 0; i < 10; i++) {
      await f.run("fanqie_knowledge_set", {
        work: key,
        id: `k${i + 1}`,
        fact: facts[i],
        holders: [
          { who: KNOWER, level: "知情", since: 2, source: "规划" },
          { who: UNKNOWER, level: "不知", since: 2 },
        ],
      });
    }
    for (let j = 0; j < 5; j++) {
      await f.run("fanqie_foreshadow_set", {
        work: key,
        line: `F${j + 1}`,
        title: `被遗忘线${j + 1}`,
        seed: `伏笔${j + 1}`,
        planned_plant: 2 + j,
        planned_payoff: 11 + j,
        beats: [{ chapter: 2 + j, kind: "埋设", note: `埋设${j + 1}`, evidence: [`标记${j + 1}`] }],
      });
    }
    // 不应被召回的两条对照线：一条 payoff 未过，一条已 committed（经正文证据核验推进）
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "H1",
      title: "未来线",
      seed: "s",
      planned_plant: 40,
      planned_payoff: 55,
      beats: [{ chapter: 40, kind: "埋设", note: "n", evidence: ["标记H"] }],
    });
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "HC",
      title: "已兑现线",
      seed: "s",
      planned_plant: 3,
      planned_payoff: 3,
      beats: [{ chapter: 3, kind: "兑现", note: "n", evidence: ["井绳磨出了毛边"] }],
    });
    await updateChapter(dir, {
      id: "c003",
      title: "第3章",
      body: "第3章：井绳磨出了毛边，两人在长街上换了一次位置。",
    });
    await f.run("fanqie_continuity_commit", { work: key, chapter: "c003" });

    const report = JSON.parse(await f.run("fanqie_continuity_get", { work: key, inspect: true }));
    const breaches = report.inspect.knowledgeBreach;
    const breachChapters = [...new Set(breaches.map((b) => b.chapter))];
    // 9/10 处越界被召回（第 10 处转述无法逐字命中）；对照章零误报
    assert.equal(breachChapters.length, 9);
    for (const c of controlChapters) assert.ok(!breachChapters.includes(c), `对照章误报：${c}`);
    assert.ok(breaches.every((b) => b.who === UNKNOWER));
    const forgotten = report.inspect.forgottenForeshadow;
    assert.deepEqual(forgotten.map((l) => l.id).sort(), ["F1", "F2", "F3", "F4", "F5"]);
    const recalled = breachChapters.length + forgotten.length;
    assert.ok(recalled >= 12, `召回 ${recalled}/15 应 ≥80%`);
    // 不开巡检不附 inspect
    const plain = JSON.parse(await f.run("fanqie_continuity_get", { work: key }));
    assert.equal(plain.inspect, undefined);
    // 线过滤
    const one = JSON.parse(await f.run("fanqie_continuity_get", { work: key, line: "F1" }));
    assert.deepEqual(
      one.foreshadow.lines.map((l) => l.id),
      ["F1"],
    );
  } finally {
    await f.close();
  }
});

test("T10 简报投影：连续性段含 beats/handoff/knowledge；超限按 beats > handoff > knowledge 裁剪并注明", async () => {
  const { formatReaderContract } = await import("../../build/fanqie/src/engine/method-assets.js");
  const base = { premise: "p", planned: "", threads: "" };
  const continuity = {
    handoff: {
      chapter: "c001",
      summary: "钥匙到手",
      mustCarry: ["钥匙必须随身"],
      nextConstraints: ["不得提前开锁"],
      openLoops: ["L2 未闭环"],
    },
    plannedBeats: [
      { lineId: "L1", title: "钥匙线", beat: { chapter: 2, kind: "强化", note: "钥匙再压一拍" } },
    ],
    knowledge: [{ id: "k1", fact: "哥哥已到站", holders: [{ who: "林晚", level: "不知" }] }],
  };
  const withC = formatReaderContract({ ...base, continuity });
  assert.match(withC, /## 连续性（continuity · 结构化）/);
  assert.match(withC, /### 本章计划 beats/);
  assert.match(withC, /- 线 L1《钥匙线》第2章·强化：钥匙再压一拍/);
  assert.match(withC, /### 上章交接 handoff/);
  assert.match(withC, /必须带走：钥匙必须随身/);
  assert.match(withC, /### 相关知识边界 knowledge/);
  assert.match(withC, /哥哥已到站（林晚:不知）/);
  assert.doesNotMatch(formatReaderContract(base), /连续性（continuity/);

  const bigKnowledge = Array.from({ length: 200 }, (_, i) => ({
    id: `k${i}`,
    fact: `事实${i}：${"很长的背景描述".repeat(8)}`,
    holders: [{ who: "甲", level: "知情" }],
  }));
  const trimmed = formatReaderContract({
    ...base,
    continuity: { ...continuity, knowledge: bigKnowledge },
  });
  assert.match(trimmed, /已按「本章beats > 上章handoff > knowledge」裁剪/);
  assert.match(trimmed, /钥匙再压一拍/);
  assert.match(trimmed, /必须带走：钥匙必须随身/);
  assert.match(trimmed, /事实0：/);
  assert.doesNotMatch(trimmed, /事实199：/);
});

test("T10 章简报：开关开时注入连续性投影（beats/handoff/知识），关时不注入", async () => {
  const f = await setup(CONTINUITY_ON);
  try {
    const { dir, key } = await continuityWork(f, "简报作品");
    await setOutline(dir, "c001", { pov: "林晚第三人称", knowledge: "林晚不知哥哥到站" }, "第一章");
    await updateChapter(dir, { id: "c001", title: "第一章", body: "哥哥的到站短信亮着。" });
    await setOutline(dir, "c002", { pov: "林晚第三人称", knowledge: "林晚不知哥哥到站" }, "第二章");
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "L1",
      title: "钥匙线",
      seed: "s",
      planned_plant: 2,
      planned_payoff: 3,
      beats: [{ chapter: 2, kind: "埋设", note: "钥匙压一拍", evidence: ["铜钥匙"] }],
    });
    await f.run("fanqie_knowledge_set", {
      work: key,
      id: "k1",
      fact: "哥哥已到站",
      holders: [
        { who: "哥哥", level: "知情", since: 1, evidence: "到站短信" },
        { who: "林晚", level: "不知", since: 1 },
      ],
    });
    await f.run("fanqie_continuity_commit", { work: key, chapter: "c001" });
    const briefOn = await f.run("fanqie_chapter_brief", { work: key, chapter: "c002" });
    assert.match(briefOn, /连续性（continuity · 结构化）/);
    assert.match(briefOn, /- 线 L1《钥匙线》第2章·埋设：钥匙压一拍/);
    assert.match(briefOn, /上章 c001 交接：核验 beats/);
    assert.match(briefOn, /哥哥已到站（哥哥:知情、林晚:不知）/);
  } finally {
    await f.close();
  }
  const off = await setup({});
  try {
    const { dir, key } = await continuityWork(off, "简报关作品");
    await setOutline(dir, "c001", { pov: "林晚第三人称" }, "第一章");
    await updateChapter(dir, { id: "c001", title: "第一章", body: "哥哥的到站短信亮着。" });
    await setOutline(dir, "c002", { pov: "林晚第三人称" }, "第二章");
    const briefOff = await off.run("fanqie_chapter_brief", { work: key, chapter: "c002" });
    assert.doesNotMatch(briefOff, /连续性（continuity/);
  } finally {
    await off.close();
  }
});

test("T10 修订影响联动：改有 committed 条目的章 → dependents 并入线/知识 id；开关关行为不变", async () => {
  const f = await setup(CONTINUITY_ON);
  try {
    const { dir, key } = await continuityWork(f, "联动作品");
    await updateChapter(dir, { id: "c001", title: "一", body: "铜钥匙在桌角。" });
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "L1",
      title: "钥匙",
      seed: "s",
      planned_plant: 1,
      planned_payoff: 2,
      beats: [{ chapter: 1, kind: "埋设", note: "n", evidence: ["铜钥匙"] }],
    });
    await f.run("fanqie_knowledge_set", {
      work: key,
      id: "k1",
      fact: "钥匙在桌角",
      holders: [{ who: "林晚", level: "知情", since: 1, evidence: "铜钥匙在桌角" }],
    });
    await f.run("fanqie_continuity_commit", { work: key, chapter: "c001" });
    await f.run("fanqie_chapter_save", {
      work: key,
      chapter: "c001",
      content: "桌角空了，铜钥匙不见了。",
    });
    const meta = await readWorkMeta(dir);
    const impact = meta.revisionImpacts?.find((v) => v.chapterId === "c001");
    assert.ok(impact, "应有修订影响记录");
    assert.ok(impact.dependents.includes("L1"));
    assert.ok(impact.dependents.includes("k1"));
    assert.match(impact.reason, /线 L1/);
    assert.match(impact.reason, /知识 k1/);
    assert.match(impact.reason, /continuity_commit/);
  } finally {
    await f.close();
  }
  const off = await setup({});
  try {
    const { dir } = await continuityWork(off, "联动关作品");
    await updateChapter(dir, { id: "c001", title: "一", body: "铜钥匙在桌角。" });
    await off.run("fanqie_chapter_save", { chapter: "c001", content: "桌角空了。" });
    const meta = await readWorkMeta(dir);
    const impact = meta.revisionImpacts?.find((v) => v.chapterId === "c001");
    assert.ok(impact);
    assert.doesNotMatch(impact.reason, /连续性/);
  } finally {
    await off.close();
  }
});

test("T10 ledger_check：新增物件/伤势/知情候选抽取，原数字对照不回归", async () => {
  const f = await setup({});
  try {
    const { dir, key } = await continuityWork(f, "旧账作品");
    await updateChapter(dir, {
      id: "c001",
      title: "一",
      body: "他掏出一把铜钥匙递给小满。她左臂的伤口又裂开了。周衍装作不知道钥匙的事。他欠了三百块。",
    });
    const out = await f.run("fanqie_ledger_check", { work: key, chapters: "1" });
    const kinds = out.candidates.map((c) => c.kind);
    assert.ok(kinds.includes("物件"), JSON.stringify(out.candidates));
    assert.ok(kinds.includes("伤势"));
    assert.ok(kinds.includes("知情"));
    assert.ok(out.candidates.every((c) => typeof c.context === "string" && c.context));
    assert.ok(out.items.some((i) => i.kind === "数量" && i.value.includes("三百块")));
  } finally {
    await f.close();
  }
});

test("T10 migrate：legacy 字段与最近章正文出候选清单，不写盘", async () => {
  const f = await setup(CONTINUITY_ON);
  try {
    const { dir, key } = await continuityWork(f, "迁移作品");
    await setFoundation(dir, {
      threads: "井底暗格的玄铁令\n谁在监视邮局",
      happened: "[c001] 林晚拿到钥匙",
      readerKnowledge: "读者已知哥哥到站",
    });
    await updateChapter(dir, {
      id: "c001",
      title: "一",
      body: "他掏出一把铜钥匙递给小满。她左臂的伤口又裂开了。",
    });
    const out = JSON.parse(await f.run("fanqie_continuity_migrate", { work: key, recent: 1 }));
    assert.ok(out.candidates.lines.some((l) => l.seed.includes("玄铁令")));
    assert.ok(out.candidates.knowledge.some((k) => k.fact.includes("读者已知哥哥到站")));
    assert.ok(out.candidates.knowledge.some((k) => k.fact.includes("林晚拿到钥匙")));
    assert.ok(out.bodyCandidates.some((c) => c.kind === "物件" && c.chapter === "1"));
    assert.ok(out.bodyCandidates.some((c) => c.kind === "伤势"));
    assert.match(out.note, /不写盘/);
    await assert.rejects(stat(path.join(dir, "continuity")), (e) => e.code === "ENOENT");
    // recent=0 只看根基字段，不碰 python
    const roots = JSON.parse(await f.run("fanqie_continuity_migrate", { work: key, recent: 0 }));
    assert.ok(roots.candidates.lines.length >= 2);
    assert.equal(roots.bodyCandidates.length, 0);
  } finally {
    await f.close();
  }
});

test("T10 角色可见性：规划角色可用登记/查询/迁移但不可 commit；编辑可读不可写", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "writer-continuity-roles-"));
  try {
    const planner = await createToolHarness({
      mode: "fanqie",
      cwd: root,
      role: "planner",
      config: CONTINUITY_ON,
    });
    const plannerNames = [...planner.tools.keys()];
    for (const name of [
      "fanqie_foreshadow_set",
      "fanqie_knowledge_set",
      "fanqie_continuity_get",
      "fanqie_continuity_migrate",
    ])
      assert.ok(plannerNames.includes(name), name);
    assert.ok(!plannerNames.includes("fanqie_continuity_commit"));
    const editor = await createToolHarness({
      mode: "fanqie",
      cwd: root,
      role: "editor",
      config: CONTINUITY_ON,
    });
    const editorNames = [...editor.tools.keys()];
    assert.ok(editorNames.includes("fanqie_continuity_get"));
    assert.ok(!editorNames.includes("fanqie_foreshadow_set"));
    assert.ok(!editorNames.includes("fanqie_continuity_commit"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T11 连续性面板接线：continuityView 快照段 + 巡检提示

test("T11 面板快照：开关开时输出 continuityView，巡检候选进 nextHints（证据句）与 panelHints（人话）且每类封顶 3 条", async () => {
  const f = await setup(CONTINUITY_ON);
  try {
    const { dir, key } = await continuityWork(f, "看板作品");
    // 四章：前三章同一冲突（同模式连跑命中），第 2 章正文含越界同段，第 4 章换冲突断开。
    await setOutline(
      dir,
      "c001",
      {
        conflict: "他尝试用假账本混过盘库，被刘朝奉当场识破",
        beats: "盘库查账",
        ending: "记下差数",
      },
      "第一章",
      { pace: "快爽" },
    );
    await updateChapter(dir, { id: "c001", title: "第一章", body: "第一夜的灯芯结了花。" });
    await setOutline(
      dir,
      "c002",
      {
        conflict: "他企图用假账本混过盘库，被刘朝奉当场识破",
        beats: "复点存银",
        ending: "发现短少",
      },
      "第二章",
    );
    await updateChapter(dir, {
      id: "c002",
      title: "第二章",
      body: "第二章：林晚忽然想起「哥哥已到站」，把门闩插上了。",
    });
    await setOutline(
      dir,
      "c003",
      {
        conflict: "他打算用假账本混过盘库，被刘朝奉当场识破",
        beats: "对总账",
        ending: "亏空现形",
      },
      "第三章",
    );
    await updateChapter(dir, { id: "c003", title: "第三章", body: "第三章：账房只剩他一人。" });
    await setOutline(
      dir,
      "c004",
      { conflict: "对手换了章程，改从总库下手", beats: "改道总库", ending: "拿到名册" },
      "第四章",
    );
    await updateChapter(dir, {
      id: "c004",
      title: "第四章",
      body: "第四章：总库的名册摊开在桌上。",
    });
    // 线：FF 未来（不逾期）、FG 逾期 planned、FM 核验失败 → missed；FA..FD 四条逾期 planned 用来验证封顶。
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "FF",
      title: "未来线",
      seed: "远期伏笔",
      planned_plant: 4,
      planned_payoff: 9,
    });
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "FG",
      title: "逾期线",
      seed: "逾期伏笔",
      planned_plant: 1,
      planned_payoff: 2,
    });
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "FM",
      title: "错过线",
      seed: "错过伏笔",
      planned_plant: 1,
      planned_payoff: 1,
      beats: [{ chapter: 1, kind: "兑现", note: "开锁", evidence: ["从来没有这句"] }],
    });
    for (const [line, payoff] of [
      ["FA", 2],
      ["FB", 3],
      ["FC", 4],
      ["FD", 4],
    ]) {
      await f.run("fanqie_foreshadow_set", {
        work: key,
        line,
        title: `积压线${line}`,
        seed: "s",
        planned_plant: 1,
        planned_payoff: payoff,
      });
    }
    await f.run("fanqie_knowledge_set", {
      work: key,
      id: "k1",
      fact: "哥哥已到站",
      holders: [
        { who: "哥哥", level: "知情", since: 1, evidence: "到站短信" },
        { who: "林晚", level: "不知", since: 1 },
      ],
    });
    await f.run("fanqie_continuity_commit", { work: key, chapter: "c001" });

    const snapshot = await withPortConfig({ continuity: { enabled: true } }, () =>
      buildPanelSnapshot(dir, f.paths, { scope: "work" }),
    );
    const view = snapshot.continuityView;
    assert.ok(view, "开关开应有 continuityView");
    assert.deepEqual(
      view.lines.map((l) => [l.id, l.status, l.plannedPlant, l.plannedPayoff, l.beats]),
      [
        ["FF", "planned", 4, 9, []],
        ["FG", "planned", 1, 2, []],
        ["FM", "missed", 1, 1, [1]],
        ["FA", "planned", 1, 2, []],
        ["FB", "planned", 1, 3, []],
        ["FC", "planned", 1, 4, []],
        ["FD", "planned", 1, 4, []],
      ],
    );
    assert.equal(view.lines.find((l) => l.id === "FG").title, "逾期线");
    assert.equal(view.lines.find((l) => l.id === "FG").seed, "逾期伏笔");
    assert.deepEqual(view.knowledge, [
      {
        id: "k1",
        fact: "哥哥已到站",
        holders: [
          { who: "哥哥", level: "知情", since: 1 },
          { who: "林晚", level: "不知", since: 1 },
        ],
      },
    ]);
    assert.equal(view.handoff.chapter, "c001");
    assert.equal(typeof view.handoff.summary, "string");
    assert.ok(Array.isArray(view.handoff.mustCarry));
    assert.ok(view.handoff.openLoops.length > 0);
    // 越界只在 c002（不知者与事实同段）；对照章与越界章之外零误报。
    assert.equal(view.breachCount, 1);

    // nextHints：证据句版，每类封顶 3 条
    assert.equal(snapshot.nextHints.filter((h) => h.includes("被遗忘伏笔")).length, 3);
    assert.ok(
      snapshot.nextHints.some((h) => h.startsWith("被遗忘伏笔：FG《逾期线》计划第 2 章回收")),
    );
    const breachHint = snapshot.nextHints.find((h) => h.includes("知情越界候选"));
    assert.match(breachHint, /知情越界候选：第 2 章「林晚」/);
    assert.match(breachHint, /「哥哥已到站」同段出现/);
    assert.match(breachHint, /林晚忽然想起/);
    const patrolHint = snapshot.nextHints.find((h) => h.includes("节奏巡检候选"));
    assert.match(patrolHint, /节奏巡检候选：c001、c002、c003；冲突字段连续近同/);
    // 旧章纲未记录受压，不推断为受压超限。
    assert.ok(snapshot.nextHints.every((h) => !h.includes("受压连跑")));
    assert.ok(!snapshot.panelHints.some((h) => h.includes("超过档位上限")));

    for (let n = 1; n <= 3; n++)
      await f.run("fanqie_outline_set", { work: key, chapter: `c00${n}`, pressure: n });
    const pressured = await withPortConfig({ continuity: { enabled: true } }, () =>
      buildPanelSnapshot(dir, f.paths, { scope: "work" }),
    );
    assert.ok(pressured.nextHints.some((h) => h.includes("受压连跑 3 章")));
    assert.ok(pressured.panelHints.some((h) => h.includes("超过档位上限")));

    // panelHints：人话版
    assert.equal(snapshot.panelHints.filter((h) => h.includes("还没核验到兑现")).length, 3);
    assert.ok(snapshot.panelHints.includes("伏笔《逾期线》计划第 2 章回收，还没核验到兑现"));
    assert.ok(snapshot.panelHints.includes("第 2 章「林晚」可能提前知道了「哥哥已到站」，请核对"));
    assert.ok(
      snapshot.panelHints.includes("连续多章（c001、c002、c003）用同一种冲突模式，建议回规划重排"),
    );
  } finally {
    await f.close();
  }
});

test("T11 面板快照：开关关时不输出 continuityView、不带巡检提示，其余字段与现在逐字段一致", async () => {
  const f = await setup(CONTINUITY_ON);
  try {
    const { dir, key } = await continuityWork(f, "黄金对照作品");
    await updateChapter(dir, { id: "c001", title: "一", body: "铜钥匙在桌角。" });
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "L1",
      title: "钥匙",
      seed: "s",
      planned_plant: 1,
      planned_payoff: 1,
      beats: [{ chapter: 1, kind: "埋设", note: "n", evidence: ["从来没有这句"] }],
    });
    await f.run("fanqie_continuity_commit", { work: key, chapter: "c001" });
    const off = await buildPanelSnapshot(dir, f.paths, { scope: "work" });
    const on = await withPortConfig({ continuity: { enabled: true } }, () =>
      buildPanelSnapshot(dir, f.paths, { scope: "work" }),
    );
    // golden：开关关的快照键集合与既有字段逐字段不变。
    assert.deepEqual(Object.keys(off).sort(), [
      "activity",
      "briefCrumbsRecent",
      "candidates",
      "chapters",
      "continuity",
      "dir",
      "foundation",
      "generatedAt",
      "genre",
      "lastPayoffByChapter",
      "ledgerRecent",
      "multiDraftEnabled",
      "nextHints",
      "panelHints",
      "product",
      "revisionImpacts",
      "schemaVersion",
      "storageBase",
      "title",
      "totals",
      "volumes",
      "workKey",
    ]);
    const patrolFree = (hints) =>
      hints.every((h) => !/被遗忘伏笔|知情越界候选|节奏巡检候选/.test(h));
    assert.ok(patrolFree(off.nextHints));
    assert.ok(patrolFree(off.panelHints));
    // 开关开只新增 continuityView 与巡检提示，不改既有字段。
    for (const field of Object.keys(off)) {
      if (field === "generatedAt" || field === "nextHints" || field === "panelHints") continue;
      assert.deepEqual(on[field], off[field], field);
    }
    const view = on.continuityView;
    assert.equal(view.lines.length, 1);
    assert.equal(view.lines[0].id, "L1");
    assert.equal(view.lines[0].status, "missed");
    assert.equal(view.breachCount, 0);
    assert.equal(view.handoff.chapter, "c001");
  } finally {
    await f.close();
  }
});

test("T11 写作台直连：api 组装点透传 continuity.enabled，快照路由带 continuityView", async () => {
  const f = await setup(CONTINUITY_ON);
  try {
    const { dir, key } = await continuityWork(f, "透传作品");
    await updateChapter(dir, { id: "c001", title: "一", body: "铜钥匙在桌角。" });
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "L1",
      title: "钥匙",
      seed: "s",
      planned_plant: 1,
      planned_payoff: 1,
      beats: [{ chapter: 1, kind: "埋设", note: "n", evidence: ["从来没有这句"] }],
    });
    await f.run("fanqie_continuity_commit", { work: key, chapter: "c001" });
    const panel = await createPanel({ storageRoot: f.root, continuity: { enabled: true } });
    const data = await jget(panel, "/snapshot", { work: key, scope: "work" });
    assert.equal(data.ok, true);
    assert.deepEqual(
      data.snapshot.continuityView.lines.map((l) => [l.id, l.status, l.plannedPayoff]),
      [["L1", "missed", 1]],
    );
    assert.equal(data.snapshot.continuityView.breachCount, 0);
    const plain = await createPanel({ storageRoot: f.root });
    const plainData = await jget(plain, "/snapshot", { work: key, scope: "work" });
    assert.equal("continuityView" in plainData.snapshot, false);
  } finally {
    await f.close();
  }
});

// ---------------------------------------------------------------------------
// T12 开篇三章专检 + payoff 题材词表 + 长线节奏巡检

async function seedChapters(f, meta, rows) {
  const dir = await resolveWorkDir(f.paths, meta.key);
  for (const [i, row] of rows.entries()) {
    const id = `c${String(i + 1).padStart(3, "0")}`;
    await setOutline(dir, id, row.outline ?? {}, `第${i + 1}章`);
    if (row.body) await updateChapter(dir, { id, title: `第${i + 1}章`, body: row.body });
  }
  return dir;
}

test("开篇三章专检：处境/亲自/在场兑现/钩子命中，空转与含糊开篇分别判无与 unclear", async () => {
  const f = await setup();
  try {
    // 好开篇：前三百字见处境；卖点由主角亲自改变局面；第二章兑现被当场使用；第三章章末新威胁。
    const good = await createWork(f.paths, { title: "好开篇" });
    await seedChapters(f, good.meta, [
      {
        outline: {
          pov: "沈砚（票号柜员）",
          conflict: "假账本混不过盘库，刘朝奉步步紧逼",
          beats: "沈砚识破假账本，盘库停住",
          livedScene: "沈砚用先窄后宽的旧伤辨炉底",
          synopsis: "盘库交锋",
          ending: "他把炉底翻给柜员看，盘库停住",
        },
        body: "沈砚到柜时，刘朝奉已经把假账本压在他面前，催他按手印。沈砚不碰印泥，托起铜炉刮底足，指腹摸到先窄后宽、带樟木油的旧伤。他把炉底翻给两名柜员看，指出这种油印只有在总库三号架压足半年才出得来。沈砚识破假账本，盘库当场停住。刘朝奉眼神一缩，拦人去搬樟木架核对，改口今日先挂账。",
      },
      {
        outline: { synopsis: "印钥到手", beats: "拿到查账差事", ending: "印钥开封" },
        body: "沈砚拿到查账的差事，当场用上总库的印钥，三号架开了封。核对的人点头放行，他把印钥收进袖袋。",
      },
      {
        outline: { synopsis: "夜半巡库" },
        body: "他清点完印钥，刚锁回暗格，门外忽然响起砸门声。来人自称总库巡库，点名要开三号架。",
      },
    ]);
    const goodReport = JSON.parse(await f.run("fanqie_opening_audit", { work: good.meta.key }));
    assert.equal(goodReport.chapters.length, 3);
    assert.equal(goodReport.chapters[0].situation.verdict, "有");
    assert.match(goodReport.chapters[0].situation.quote, /催/);
    assert.equal(goodReport.chapters[0].sellingPoint.verdict, "亲自");
    assert.equal(goodReport.payoffOnce.verdict, "有");
    assert.match(goodReport.payoffOnce.note, /第 2 章/);
    assert.equal(goodReport.hook.chapterId, "c003");
    assert.equal(goodReport.hook.verdict, "有");
    assert.match(goodReport.hook.infoGain, /新威胁/);

    // 空转开篇：开头背设定不见人；卖点词未落正文；兑现是播报式结算；章末零信息停顿。
    const idle = await createWork(f.paths, { title: "空转开篇" });
    await seedChapters(f, idle.meta, [
      {
        outline: {
          pov: "林晚（记账学徒）",
          conflict: "林晚要追回被顶替的名字",
          synopsis: "顶替的名字",
        },
        body: "票引之制，出自总库。凡柜面收票，皆须对照印鉴，印鉴出自三号架。三号架的锁，一年一换。换锁的日子，定在冬至。冬至之前，柜上不出远门，柜面照旧盘数。",
      },
      {
        outline: { conflict: "名次被顶替", beats: "公示贴出名次" },
        body: "他领到公示的名次，众人震惊，都说柜面出了能人。榜单贴了三天，没人来问缘由。",
      },
      {
        outline: { synopsis: "夜班收尾" },
        body: "他看了看窗外，夜色刚好漫过柜台。柜上的灯还亮着，账页停在本页。",
      },
    ]);
    const idleReport = JSON.parse(await f.run("fanqie_opening_audit", { work: idle.meta.key }));
    assert.equal(idleReport.chapters[0].situation.verdict, "无");
    assert.equal(idleReport.chapters[0].sellingPoint.verdict, "缺席");
    assert.equal(idleReport.payoffOnce.verdict, "无");
    assert.match(idleReport.payoffOnce.note, /播报式/);
    assert.equal(idleReport.hook.verdict, "无");

    // 含糊开篇：主角在场但压力源未显；卖点在场无改变拍；兑现拍判不了在场；章末类型不明。
    const vague = await createWork(f.paths, { title: "含糊开篇" });
    await seedChapters(f, vague.meta, [
      {
        outline: { pov: "阿禾（柜上帮工）", conflict: "印鉴真假之分", synopsis: "印鉴疑云" },
        body: "阿禾在柜面坐了一早，把印鉴擦了又擦。柜上的规矩他早背熟，只是今日无事可做。散工时他领到工牌，揣进怀里。",
      },
      { outline: { synopsis: "后山采买" }, body: "后山的路他走过一遍，此番带上了新地图。" },
      { outline: { synopsis: "后账未清" }, body: "他把名册放回架上，灯还亮着。" },
    ]);
    const vagueReport = JSON.parse(await f.run("fanqie_opening_audit", { work: vague.meta.key }));
    assert.equal(vagueReport.chapters[0].situation.verdict, "unclear");
    assert.equal(vagueReport.chapters[0].sellingPoint.verdict, "参与");
    assert.equal(vagueReport.payoffOnce.verdict, "unclear");
    assert.equal(vagueReport.hook.verdict, "unclear");
    assert.equal(vagueReport.rules.length, 4);

    // 指定章节子集时只核所选章，钩子挂最后一章。
    const picked = JSON.parse(
      await f.run("fanqie_opening_audit", { work: vague.meta.key, chapters: "c001, c003" }),
    );
    assert.deepEqual(
      picked.chapters.map((c) => c.chapterId),
      ["c001", "c003"],
    );
    assert.equal(picked.hook.chapterId, "c003");
  } finally {
    await f.close();
  }
});

test("payoff 题材词表：注入后触发三条题材检查，缺省只留 ending 兑付评分", async () => {
  const f = await setup();
  try {
    const { dir, meta } = await createWork(f.paths, { title: "兑付作品" });
    await setOutline(
      dir,
      "c001",
      {
        synopsis: "他确认轨上的人声。",
        beats: "等人声出现",
        conflict: "人声是关键",
        livedScene: "回放与侧窗",
        ending: "他记下时间戳。",
      },
      "第一章",
    );
    await updateChapter(dir, {
      id: "c001",
      title: "第一章",
      body: "他听见自己的呼吸，混响有三十毫米。",
    });
    // 缺省：旧硬编码正则不再产这三条 warning，只保留通用 ending 兑付评分。
    const base = await f.run("fanqie_payoff_audit", { work: meta.key, chapter: "c001" });
    assert.doesNotMatch(base, /speech_breath_drift|domain_unit_mismatch|lived_hooks_missing/);
    assert.match(base, /payoff-lexicon\.json 词表/);
    // 注入作品词表后三条按词表触发。
    await writeFile(
      path.join(dir, "payoff-lexicon.json"),
      JSON.stringify({
        speech: ["人声"],
        breath: ["呼吸"],
        units: [["混响", "毫米"]],
        hooks: ["回放", "侧窗"],
      }),
    );
    const injected = await f.run("fanqie_payoff_audit", { work: meta.key, chapter: "c001" });
    for (const code of ["speech_breath_drift", "domain_unit_mismatch", "lived_hooks_missing"])
      assert.match(injected, new RegExp(code), code);
    assert.match(injected, /说话类承诺：是 · 呼吸兑付：是/);
    // 词表文件损坏要报错，不静默当没配。
    await writeFile(path.join(dir, "payoff-lexicon.json"), JSON.stringify({ units: [["混响"]] }));
    assert.match(
      await f.run("fanqie_payoff_audit", { work: meta.key, chapter: "c001" }),
      /错误\[bad_args\].*units/,
    );
  } finally {
    await f.close();
  }
});

test("长线节奏巡检：三类候选命中与不命中", () => {
  const chapter = (id, over = {}) => ({
    chapterId: id,
    conflict: "",
    progression: "",
    pressureCount: 0,
    ...over,
  });
  // 同一冲突模式 ≥3 章命中（bigram 近同，非逐字相同；第 4 章换模式断开）。
  const conflictHit = patrolRhythm({
    pace: "快爽",
    chapters: [
      chapter("c1", { conflict: "他尝试用假账本混过盘库，被刘朝奉当场识破", progression: "甲" }),
      chapter("c2", { conflict: "他企图用假账本混过盘库，被刘朝奉当场识破", progression: "乙" }),
      chapter("c3", { conflict: "他打算用假账本混过盘库，被刘朝奉当场识破", progression: "丙" }),
      chapter("c4", { conflict: "对手换了章程，改从总库下手", progression: "丁" }),
    ],
  });
  const run = conflictHit.candidates.find((c) => c.kind === "same_conflict_run");
  assert.deepEqual(run?.chapters, ["c1", "c2", "c3"]);
  // 只有两章近同不命中。
  const twoRun = patrolRhythm({
    chapters: [
      chapter("c1", { conflict: "他尝试用假账本混过盘库，被刘朝奉当场识破", progression: "甲" }),
      chapter("c2", { conflict: "他企图用假账本混过盘库，被刘朝奉当场识破", progression: "乙" }),
    ],
  });
  assert.deepEqual(twoRun.candidates, []);
  // 无可感变化 ≥2 章命中：第 2 章与前章雷同、第 3 章章纲未写推进与落点。
  const noChange = patrolRhythm({
    chapters: [
      chapter("c1", { progression: "他拿到令牌，用令牌打开山门，山门在身后合拢" }),
      chapter("c2", { progression: "他拿到令牌，用令牌打开山门，山门在身后合拢" }),
      chapter("c3", {}),
      chapter("c4", { progression: "他改走水路，账目翻出新的缺口" }),
    ],
  });
  const change = noChange.candidates.find((c) => c.kind === "no_perceptible_change");
  assert.deepEqual(change?.chapters, ["c2", "c3"]);
  assert.match(change?.evidence ?? "", /雷同/);
  assert.match(change?.evidence ?? "", /未写推进与落点/);
  // 变化各不相同不命中。
  const distinct = patrolRhythm({
    chapters: [
      chapter("c1", { progression: "他拿到令牌，用令牌打开山门，山门在身后合拢" }),
      chapter("c2", { progression: "她把账目翻出新的缺口，总库派人上门核对" }),
      chapter("c3", { progression: "他在柜面认出旧伤的手艺，换到查账的差事" }),
    ],
  });
  assert.ok(!distinct.candidates.some((c) => c.kind === "no_perceptible_change"));
  // 受压超档位上限：快爽连压 4 章命中；2 章在档内；慢燃无数值上限不判；未定档不判。
  const pressureHit = patrolRhythm({
    pace: "快爽",
    chapters: [
      chapter("c1", { conflict: "甲", progression: "甲", pressureCount: 1 }),
      chapter("c2", { conflict: "乙", progression: "乙", pressureCount: 1 }),
      chapter("c3", { conflict: "丙", progression: "丙", pressureCount: 1 }),
      chapter("c4", { conflict: "丁", progression: "丁", pressureCount: 1 }),
    ],
  });
  const cap = pressureHit.candidates.find((c) => c.kind === "pressure_over_cap");
  assert.deepEqual(cap?.chapters, ["c1", "c2", "c3", "c4"]);
  assert.match(cap?.evidence ?? "", /快爽档受压连跑 4 章，超档位上限 2 章/);
  const within = patrolRhythm({
    pace: "快爽",
    chapters: [
      chapter("c1", { conflict: "甲", progression: "甲", pressureCount: 1 }),
      chapter("c2", { conflict: "乙", progression: "乙", pressureCount: 1 }),
      chapter("c3", { conflict: "丙", progression: "丙", pressureCount: 0 }),
      chapter("c4", { conflict: "丁", progression: "丁", pressureCount: 0 }),
    ],
  });
  assert.ok(!within.candidates.some((c) => c.kind === "pressure_over_cap"));
  const slowBurn = patrolRhythm({
    pace: "慢燃",
    chapters: ["c1", "c2", "c3", "c4", "c5"].map((id) => chapter(id, { pressureCount: 1 })),
  });
  assert.ok(!slowBurn.candidates.some((c) => c.kind === "pressure_over_cap"));
  const noPace = patrolRhythm({
    chapters: ["c1", "c2", "c3"].map((id) => chapter(id, { pressureCount: 1 })),
  });
  assert.ok(!noPace.candidates.some((c) => c.kind === "pressure_over_cap"));
  // 章数不足不产出候选。
  assert.deepEqual(
    patrolRhythm({ pace: "快爽", chapters: [chapter("c1", { pressureCount: 1 })] }).candidates,
    [],
  );
});

test("T115 交接写失败不发布完成标记，经事务恢复补齐交接与伏笔后可重试", async () => {
  const { default: fs } = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  const { inspectPendingChapterSave, resumePendingChapterSave } =
    await import("../../build/fanqie/src/engine/storage/chapter-journal.js");
  const f = await setup(CONTINUITY_ON),
    original = fs.rename;
  try {
    const { dir, key } = await continuityWork(f, "完成标记");
    await updateChapter(dir, { id: "c001", title: "一", body: "桌角摆着铜钥匙。" });
    await f.run("fanqie_foreshadow_set", {
      work: key,
      line: "L1",
      title: "钥匙",
      seed: "线索",
      planned_plant: 1,
      planned_payoff: 2,
      beats: [{ chapter: 1, kind: "埋设", note: "得到钥匙", evidence: ["铜钥匙"] }],
    });
    fs.rename = async (from, to) => {
      if (String(to).includes("handoff"))
        throw Object.assign(new Error("handoff disk fault"), { code: "EIO" });
      return original(from, to);
    };
    syncBuiltinESMExports();
    assert.match(
      await f.run("fanqie_continuity_commit", { work: key, chapter: "c001" }),
      /错误\[recovery_required\]/,
    );
    await assert.rejects(
      stat(path.join(dir, "continuity/commits.json")),
      (error) => error.code === "ENOENT",
    );
    fs.rename = original;
    syncBuiltinESMExports();
    assert.match(
      await f.run("fanqie_continuity_commit", { work: key, chapter: "c001" }),
      /错误\[GATE_ERROR\].*请先检查恢复记录/,
    );
    const pending = await inspectPendingChapterSave(dir);
    await resumePendingChapterSave(dir, { id: pending.id, fingerprint: pending.fingerprint });
    assert.match(
      await f.run("fanqie_continuity_commit", { work: key, chapter: "c001" }),
      /本章已在 revision \w{12,} 核验过/,
    );
    assert.equal(
      JSON.parse(await readFile(path.join(dir, "continuity/commits.json"), "utf8")).commits.length,
      1,
    );
    assert.equal(
      JSON.parse(await readFile(path.join(dir, "continuity/foreshadow.json"), "utf8")).lines[0]
        .status,
      "written",
    );
  } finally {
    fs.rename = original;
    syncBuiltinESMExports();
    await f.close();
  }
});

test("较早章节正文文件缺失时简报不因接续索引读章尾而整体失败", async () => {
  const f = await setup();
  try {
    const { dir, meta } = await createWork(f.paths, { title: "缺章作品" });
    for (const [id, body] of [
      ["c001", "她推开门，走廊尽头亮着一盏灯。"],
      ["c002", "灯下坐着一个陌生人。"],
    ]) {
      await setOutline(dir, id, { ending: "门开了" }, id);
      await updateChapter(dir, { id, body });
    }
    await setOutline(dir, "c003", { ending: "灯灭了" }, "第三章");
    assert.equal((await readWorkMeta(dir)).continuity.working.length, 2);
    await rm(path.join(dir, "chapters", "c001.md"));
    const brief = await f.run("fanqie_chapter_brief", { work: meta.key, chapter: "c003" });
    assert.match(brief, /## 相关接续索引/);
    assert.match(brief, /灯下坐着一个陌生人。/);
  } finally {
    await f.close();
  }
});
