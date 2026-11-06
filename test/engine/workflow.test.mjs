import { createToolHarness } from "../helpers.mjs";
import { formatToolError } from "../../build/fanqie/src/engine/errors.js";
import { allTools } from "../../build/fanqie/src/engine/tools/index.js";
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
} from "../../build/fanqie/src/engine/ports/index.js";
import { ensureStorage } from "../../build/fanqie/src/engine/storage/paths.js";
import { createWork, resolveWorkDir } from "../../build/fanqie/src/engine/work-store.js";
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
import { VERSION } from "../../build/core/src/version.js";
const BOOK = [
  "第1章 差三罐",
  "凌晨两点，屏幕上的数字比昨天少了三罐咖啡。他把时间戳抄在纸条上。",
  "第2章 四秒",
  "他调出监控回放，侧窗的人影只用了四秒。",
].join("\n");
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "writer-novel-workflow-"));
  const paths = await ensureStorage(null, { storageRoot: root });
  const harness = await createToolHarness({
    mode: "fanqie",
    cwd: root,
    config: { storageRoot: root },
  });
  const run = async (name, args = {}) => {
    try {
      return (await harness.execute(name, args)).value;
    } catch (error) {
      return formatToolError(error);
    }
  };
  return { root, paths, run, close: () => rm(root, { recursive: true, force: true }) };
}
function id(text, expression) {
  const found = text.match(expression)?.[1];
  assert.ok(found, text);
  return found;
}
function cardInput(sourceId) {
  return {
    title: "差数引出疑问",
    sourceId,
    axis: "craft",
    layer: "scene",
    dimension: "hook",
    body: "用可核对的细节引出疑问。",
    mechanisms: [
      {
        name: "差数",
        experience: "三罐",
        rebuild: "换成其他差数",
        discard: "便利店",
        failWhen: "差数无后果",
      },
    ],
    humanFeel: {
      writerCraft: "重数后再开口",
      craftRange: "近景",
      characterState: "怀疑",
      stateOnPage: "停半拍",
      allowedEdges: "一句噪音",
      failAsTemplate: "句句解释",
    },
    readerWant: "差数缘由",
    emotionArc: "平静到起疑",
    dramaticUnit: "盘点差数",
    replaceables: ["数字"],
    mustNotCopy: ["人物"],
    evidence: [{ quote: "屏幕上的数字比昨天少了三罐咖啡", chapter: 1 }],
    transfer: "其他可核对的差异",
    failWhen: "差数无后果",
  };
}
test("拆书证据经明确采纳进入规划，正文经扫描采纳后供续章使用", async () => {
  const f = await setup();
  try {
    const originalFile = path.join(f.root, "original.txt");
    await writeFile(originalFile, BOOK);
    const { sourceId } = await LibraryPort.importSource(f.paths, {
      title: "参考书",
      file: originalFile,
    });
    await rm(originalFile);
    const fact = await f.run("fanqie_library_facts_stage", {
      source: sourceId,
      facts: {
        n: 1,
        events: [{ desc: "盘点少了三罐", quote: "屏幕上的数字比昨天少了三罐咖啡" }],
        readingLevel: "正文已读",
      },
    });
    assert.match(fact, /已记录 1 章/);
    const candidate = await LibraryPort.stageCard(f.paths, cardInput(sourceId));
    const { cardId } = await LibraryPort.acceptCard(f.paths, candidate.candId);
    const card = await LibraryPort.getCard(f.paths, cardId);
    assert.equal(card.readingEvidence.chapters[0].readingLevel, "正文已读");
    assert.match(card.readingEvidence.note, /不证明/);
    await assert.rejects(
      LibraryPort.acceptCard(f.paths, candidate.candId),
      (e) => e.code === "candidate_already_accepted",
    );
    const combo = await LibraryPort.suggestCombo(f.paths);
    assert.equal(combo.ok, true);
    assert.equal(combo.mind, null);
    assert.ok(combo.cardIds.includes(cardId));
    assert.match(await f.run("fanqie_library_combo_suggest"), new RegExp(cardId));
    const session = await InspirationPort.startSession(f.paths, {
      goal: "新故事",
      cardIds: [cardId],
      pace: "慢燃",
    });
    const foundation = await InspirationPort.stageEmit(f.paths, session.sessionId, {
      kind: "foundation",
      payload: { planned: "追查差数" },
    });
    await InspirationPort.acceptEmit(f.paths, foundation.candId, { workKey: "新作", apply: true });
    const outline = await InspirationPort.stageEmit(f.paths, session.sessionId, {
      kind: "outline",
      payload: { chapter: "c001", title: "第一章", ending: "她把门推开。" },
    });
    await InspirationPort.acceptEmit(f.paths, outline.candId, { workKey: "新作", apply: true });
    const dir = await resolveWorkDir(f.paths, "新作");
    assert.equal((await readWorkMeta(dir)).pace, "慢燃");
    const handoff = JSON.parse(
      await f.run("fanqie_chapter_brief", { work: "新作", chapter: "c001", handoff_only: true }),
    );
    assert.ok(handoff.references.assets.includes("card:" + cardId));
    assert.match(handoff.references.content, /其他可核对的差异/);
    assert.equal(handoff.requiresBodyRead, true);
    await f.run("fanqie_chapter_brief", { work: "新作", chapter: "c001" });
    const body = "夜班第七天，她查完账，把门推开。";
    const staged = await f.run("fanqie_candidate_stage", {
      work: "新作",
      chapter: "c001",
      content: body,
    });
    const candId = id(staged, /(cand-[a-z0-9]+)/);

    await f.run("fanqie_payoff_audit", {
      work: "新作",
      chapter: "c001",
      text: "另一版正文，他把门关上。",
    });
    assert.match(
      await f.run("fanqie_candidate_accept", {
        work: "新作",
        candidate: candId,
        require_payoff: true,
      }),
      /payoff_missing/,
    );
    assert.match(
      await f.run("fanqie_candidate_accept", { work: "新作", candidate: candId }),
      /已采纳/,
    );
    assert.equal((await readChapter(dir, "c001")).body, body);
    await f.run("fanqie_outline_set", { work: "新作", chapter: "c002", ending: "他翻开账本。" });
    assert.ok(
      (await f.run("fanqie_chapter_brief", { work: "新作", chapter: "c002" })).includes(body),
    );
  } finally {
    await f.close();
  }
});
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

test("T5 灵感旧绑定只在项目初始化时迁移一次，坏来源报错且不覆盖索引", async () => {
  const f = await setup();
  const { migrateInspirationBindings } =
    await import("../../build/fanqie/src/engine/storage/inspiration-migration.js");
  try {
    const { meta } = await createWork(f.paths, { title: "迁移作品" });
    const { sourceId } = await LibraryPort.importSource(f.paths, { title: "原文", text: BOOK });
    const staged = await LibraryPort.stageCard(f.paths, cardInput(sourceId));
    const { cardId } = await LibraryPort.acceptCard(f.paths, staged.candId);
    const { sessionId } = await InspirationPort.startSession(f.paths, {
      goal: "迁移",
      cardIds: [cardId],
    });
    const { candId } = await InspirationPort.stageEmit(f.paths, sessionId, {
      kind: "foundation",
      payload: { planned: "寻找证据" },
    });
    await InspirationPort.acceptEmit(f.paths, candId, { workKey: meta.key, apply: true });
    const file = path.join(f.paths.inspiration, "bindings.json");
    await rm(file);
    await Promise.all([migrateInspirationBindings(f.paths), migrateInspirationBindings(f.paths)]);
    const before = await readFile(file, "utf8");
    assert.deepEqual(JSON.parse(before)[meta.key], [cardId]);
    assert.deepEqual(
      (await InspirationPort.resolveCardsForBrief(f.paths, { workKey: meta.key })).cardIds,
      [cardId],
    );
    await writeFile(path.join(f.paths.inspiration, "sessions", `${sessionId}.json`), "{broken");
    await rm(path.join(f.paths.inspiration, "candidates", `${candId}.json`));
    await migrateInspirationBindings(f.paths);
    assert.equal(await readFile(file, "utf8"), before);
    assert.deepEqual(
      (await InspirationPort.resolveCardsForBrief(f.paths, { workKey: meta.key })).cardIds,
      [cardId],
    );
  } finally {
    await f.close();
  }
  for (const failure of ["candidate", "session", "card"]) {
    const damaged = await setup();
    try {
      const root = damaged.paths.inspiration,
        file = path.join(root, "bindings.json"),
        at = new Date().toISOString();
      await (
        await import("node:fs/promises")
      ).mkdir(path.join(root, "candidates"), { recursive: true });
      await (
        await import("node:fs/promises")
      ).mkdir(path.join(root, "sessions"), { recursive: true });
      const candidate = {
        status: "accepted",
        appliedWorkKey: "legacy",
        sessionId: "insp-old",
        acceptedAt: at,
      };
      await writeFile(
        path.join(root, "candidates", "icand-old.json"),
        failure === "candidate" ? "{broken" : JSON.stringify(candidate),
      );
      if (failure !== "session")
        await writeFile(
          path.join(root, "sessions", "insp-old.json"),
          JSON.stringify({ cardIds: ["card-missing"] }),
        );
      await writeFile(file, "{}");
      await assert.rejects(migrateInspirationBindings(damaged.paths));
      assert.equal(await readFile(file, "utf8"), "{}");
      await assert.rejects(
        readFile(path.join(root, ".writer-bindings-migration.json")),
        (e) => e.code === "ENOENT",
      );
    } finally {
      await damaged.close();
    }
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
