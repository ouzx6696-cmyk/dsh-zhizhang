// 番茄长篇：生产工具执行路径、真实存储、Python 规则与桌面复用的路由。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, createToolHarness, createCommandHarness, tempDir, buildUrl } from "./helpers.mjs";

const { ensureStorage, createWork, setOutline, updateChapter, readChapter } = await import(
  buildUrl("fanqie/src/engine/work-store.js")
);
const EX = await readFile(
  path.join(ROOT, "packages/fanqie/skill/forge/novel-writer/assets/examples/两张车票.md"),
  "utf8",
);

const OUTLINE = {
  pov: "“我”第一人称",
  targetWords: 2500,
  locks: "两张车票，明天八点四十",
  knowledge: "迟川不知道剧团的事",
  synopsis: "我把车票推给迟川",
  conflict: "他发现我已答应剧团",
  beats: "推票—追问—摊牌",
  ending: "他问什么时候",
};
const T1 = "第一章 两张车票";

/** 用长篇引擎自己的存储层造一部作品（<cwd>/.writer，与 fanqie_project_create 同一布局） */
async function makeWork(cwd, { second = OUTLINE } = {}) {
  const paths = await ensureStorage(null, { storageRoot: path.join(cwd, ".writer") });
  const { dir, meta } = await createWork(paths, { title: "两张车票" });
  await setOutline(dir, "c001", OUTLINE, T1);
  await updateChapter(dir, { id: "c001", title: T1, body: EX.trim() });
  await setOutline(dir, "c002", second, "第二章 站台");
  return { dir, key: meta.key };
}

async function setup(config = {}) {
  const cwd = await tempDir();
  const work = await makeWork(cwd);
  const harness = await createToolHarness({ mode: "fanqie", cwd, config: config.fanqie });
  return { ...harness, harness, work };
}

test("长篇工具集包含引擎与写作层，方法原文带对照表", async () => {
  const { tools, call, gates } = await setup();
  assert.ok(tools.has("fanqie_outline_check") && tools.has("fanqie_review_report"));
  assert.ok(
    tools.has("fanqie_chapter_save") &&
      tools.has("fanqie_method_list") &&
      tools.has("fanqie_method_get"),
  );
  assert.ok(![...tools.keys()].some((name) => name.startsWith("toutiao_")));
  assert.ok(!tools.has("fanqie_manuscript_lint"));
  assert.ok(gates.rules.length > 0);
  const { buildFanqieBrief } = await import(buildUrl("fanqie/src/brief.js"));
  const brief = buildFanqieBrief();
  assert.match(brief, /番茄长篇/);
  assert.match(brief, /【写作台】/);
  const list = await call("fanqie_method_list", {});
  const profileIds = [...list.split("## 引擎资产")[0].matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
  assert.ok(profileIds.includes("edit"), "默认方案目录");
  const m = await call("fanqie_method_get", { id: "novel-writer/references/editor_method" });
  assert.ok(
    m.startsWith("## 方法 · edit（方案「默认」）"),
    `原版 id 对到默认方案里的同类方法：${m.slice(0, 80)}`,
  );
  assert.match(m, /四类/);
  const o = await call("fanqie_method_get", { id: "原版:novel-writer/references/editor_method" });
  assert.match(o, /写作 Agent 适配/);
  assert.match(o, /四类内容硬伤/);
  const { fanqieLibrary } = await import(buildUrl("fanqie/src/forge.js"));
  assert.ok((await fanqieLibrary.originalIds()).length > 60, "原版 forge 方法 id 全部登记");
  const miss = await call("fanqie_method_get", { id: "../../../etc/passwd" });
  assert.equal(miss.code, "bad_args");
  assert.match(miss.message, /未知方法/);
});

test("章纲检查：读长篇章纲，8 字段齐全通过；缺字段与占位报错", async () => {
  const cwd = await tempDir();
  await makeWork(cwd, {
    second: { ...OUTLINE, synopsis: "", conflict: "【本章主要经历】", targetWords: 9000 },
  });
  const harness = await createToolHarness({ mode: "fanqie", cwd });
  const ok = await harness.call("fanqie_outline_check", { chapters: "1" });
  assert.equal(ok.pass, true, JSON.stringify(ok));
  const bad = await harness.call("fanqie_outline_check", {});
  assert.equal(bad.pass, false);
  const f = bad.issues.filter((i) => i.chapter === "c002").map((i) => i.field);
  assert.ok(
    f.includes("剧情梗概") && f.includes("核心冲突与看点") && f.includes("目标篇幅"),
    JSON.stringify(bad.issues),
  );
  assert.equal(bad.field_map.synopsis, "剧情梗概");
  const nf = await harness.call("fanqie_outline_check", { work: "不存在" });
  assert.equal(nf.code, "NOT_FOUND");
});

test("旧账对照：从长篇引擎正文取材；正文体检并入 fanqie_style_lint 并去重", async () => {
  const { call } = await setup();
  const led = await call("fanqie_ledger_check", { chapters: "2" });
  assert.equal(led.ok, true);
  assert.ok(
    led.files.some((n) => n.startsWith("第001章-正文")),
    "默认连带上一章",
  );
  assert.ok(led.items.length > 0);
  assert.ok(
    led.items.every((i) => !i.file.includes("/")),
    "来源只给文件名",
  );
  const lint = await call("fanqie_style_lint", { chapter: "c001" });
  assert.match(lint, /### forge 正文体检（\d+ 处，仅提示回看位置）/);
  assert.match(lint, /\d+ 字 · \d+ 段/);
  const txt = await call("fanqie_style_lint", {
    text: "他眼中闪过一丝寒光，嘴角勾起一抹冷笑。" + "长".repeat(200),
  });
  assert.match(txt, /超长段/);
  assert.match(txt, /forge 正文体检/);
});

test("拆书测绘与引文核对：只读会话目录内的文件", async () => {
  const { call, cwd } = await setup();
  await writeFile(
    path.join(cwd, "book.txt"),
    "第一章 开始\n迟川上了车。\n第二章 中途\n迟川下车。\n",
  );
  const sc = await call("fanqie_library_scan", { file: "book.txt", keywords: "迟川" });
  assert.equal(sc.chapter_count, 2);
  assert.equal(sc.keyword_frequencies["迟川"], 2);
  assert.equal(
    (await call("fanqie_library_scan", { file: "../../etc/hosts" })).code,
    "OUT_OF_ROOT",
  );
  const q = await call("fanqie_quote_check", {
    source: "book.txt",
    analysis_text: "原文写“迟川上了车”，又写“迟川一夜没睡着觉”。",
    min_chars: 4,
  });
  assert.equal(q.checked, 2);
  assert.equal(q.not_verbatim, 1);
});

test("审读回报：固定格式、有硬伤不能判通过、绑定正文版本、跟着书存、正文一改就过期", async () => {
  const { call, work } = await setup();
  const hard = [
    { category: "正文接续", location: "第 3 段", basis: "与上一章时间矛盾", fix: "改成次日" },
  ];
  assert.equal(
    (
      await call("fanqie_review_report", {
        chapter: "c001",
        verdict: "通过",
        hard_issues: hard,
        levels: [],
        reread_full: true,
      })
    ).code,
    "INVALID_ARGS",
  );
  assert.equal(
    (
      await call("fanqie_review_report", {
        chapter: "c001",
        verdict: "未通过",
        hard_issues: [{ ...hard[0], category: "文笔" }],
        levels: [],
        reread_full: true,
      })
    ).code,
    "INVALID_ARGS",
  );
  const r = await call("fanqie_review_report", {
    chapter: "c001",
    verdict: "通过",
    hard_issues: [],
    levels: [{ level: "L3", location: "末段", symptom: "略长", fix: "切段" }],
    reread_full: true,
    changed_scope: "未改",
    strengths: "对白有来回",
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.markdown, /结论：\*\*通过\*\*/);
  const { readdir } = await import("node:fs/promises");
  assert.equal(
    (await readdir(path.join(work.dir, "writer-reviews", "c001"))).length,
    1,
    "回报存在作品目录里",
  );
  assert.equal((await call("fanqie_review_get", { chapter: "c001" })).fresh, true);
  await updateChapter(work.dir, {
    id: "c001",
    title: T1,
    body: EX.trim().replace("迟川的手停了。", "迟川的手停住了。"),
  });
  const g2 = await call("fanqie_review_get", { chapter: "c001" });
  assert.equal(g2.fresh, false);
  assert.match(g2.markdown, /回报过期/);
});

test("长篇门禁：定稿与 force 须作者确认；requireEditorPass 时无通过回报不许定稿（门禁先拦，长篇引擎内部再兜底）", async () => {
  const { harness, call, work } = await setup({ fanqie: { requireEditorPass: true } });
  const n0 = harness.approvals.length;
  // 定稿：先被"须审读"拒绝，且不打扰作者
  const d = await call("fanqie_chapter_save", { chapter: "c001", status: "final" });
  assert.equal(d.denied, true);
  assert.match(d.reason, /还没有编辑审读回报/);
  assert.equal(harness.approvals.length, n0);
  await call("fanqie_review_report", {
    chapter: "c001",
    verdict: "未通过",
    hard_issues: [{ category: "人物认知", location: "第 5 段", basis: "他不可能知道", fix: "删" }],
    levels: [],
    reread_full: true,
  });
  assert.match(
    (await call("fanqie_chapter_save", { chapter: "c001", status: "final" })).reason,
    /未通过/,
  );
  await call("fanqie_review_report", {
    chapter: "c001",
    verdict: "通过",
    hard_issues: [],
    levels: [],
    reread_full: true,
  });
  // 带新正文定稿：回报对应旧正文 → 拒绝
  assert.match(
    (await call("fanqie_chapter_save", { chapter: "c001", status: "final", content: "全新正文" }))
      .reason,
    /旧正文/,
  );
  // 作者审读声明（长篇引擎自己的规矩：定稿前须声明当前版本已审读）
  const rev = (await readChapter(work.dir, "c001")).revision;
  assert.match(
    await call("fanqie_chapter_save", {
      chapter: "c001",
      status: "reviewed",
      expected_revision: rev,
      review_summary: "编辑回报通过",
    }),
    /已保存/,
  );
  // 版本匹配 → 进入作者确认（ask）→ 真定稿
  const before = harness.approvals.length;
  assert.match(
    await call("fanqie_chapter_save", { chapter: "c001", status: "final" }),
    /状态 final/,
  );
  assert.equal(harness.approvals.length, before + 1);
  assert.match(harness.approvals.at(-1).reason, /定稿/);
  assert.equal((await readChapter(work.dir, "c001")).status, "final");
  // force 覆盖须确认；作者拒绝 → 不执行
  harness.approved = false;
  const rej = await call("fanqie_chapter_save", {
    chapter: "c001",
    content: "改一句",
    force: true,
  });
  assert.equal(rej.denied, true);
  assert.match(harness.approvals.at(-1).reason, /force=true/);
  assert.equal((await readChapter(work.dir, "c001")).status, "final");
});

test("长篇编辑只能审读与出编辑候选，敏感写入不能执行", async () => {
  const { cwd, call, work } = await setup();
  const editor = await createToolHarness({ mode: "fanqie", cwd, role: "editor" });
  const { FANQIE_EDITOR_BRIEF } = await import(buildUrl("fanqie/src/brief.js"));
  assert.match(FANQIE_EDITOR_BRIEF, /只审不定稿/);
  assert.ok(editor.tools.has("fanqie_review_report"));
  assert.match(await editor.call("fanqie_chapter_read", { chapter: "c001" }), /两张车票|迟川/);
  const original = await readChapter(work.dir, "c001");
  for (const name of ["fanqie_candidate_accept", "fanqie_chapter_save"]) {
    assert.equal(editor.tools.has(name), false);
    await assert.rejects(editor.call(name, { chapter: "c001" }), /unknown tool/);
  }
  assert.equal(
    (
      await editor.call("fanqie_review_report", {
        chapter: "c001",
        verdict: "通过",
        hard_issues: [],
        levels: [],
        reread_full: true,
      })
    ).ok,
    true,
  );
  assert.equal((await call("fanqie_review_get", { chapter: "c001" })).fresh, true);
  assert.equal((await readChapter(work.dir, "c001")).revision, original.revision);
});

test("两种模式配置从真实边界校验，未知旧配置不会静默生效", async () => {
  const { parseFanqieConfig } = await import(buildUrl("fanqie/src/config.js"));
  const { parseToutiaoConfig } = await import(buildUrl("toutiao/src/config.js"));
  const parsed = parseFanqieConfig({ requireEditorPass: true, storageRoot: "/data/novel" });
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.value.rootDir, ".writer");
  assert.equal(parsed.value.requireEditorPass, true);
  assert.equal(parseToutiaoConfig({ rootDir: "x" }).value.rootDir, "x");
  for (const input of [{ autoMount: true }, { novel: {} }, { requireEditorPass: "yes" }])
    assert.ok(parseFanqieConfig(input).issues.length > 0);
  assert.ok(parseToutiaoConfig(1).issues.length > 0);
  assert.equal(parseFanqieConfig({ brief: { creationFirst: true } }).issues.length, 0);
  assert.equal(parseToutiaoConfig({ brief: { creationFirst: true } }).issues.length, 0);
  assert.ok(parseFanqieConfig({ brief: { creationFirst: "yes" } }).issues.length > 0);
  assert.ok(parseToutiaoConfig({ brief: { creationFirst: 1 } }).issues.length > 0);
});

test("常驻规则重排：creationFirst 开时创作定向在前、工程约束整段压后且条目不丢", async () => {
  const { buildFanqieBrief, buildFanqieEditorBrief } = await import(
    buildUrl("fanqie/src/brief.js")
  );
  const { systemBrief } = await import(buildUrl("fanqie/src/engine/tools/brief.js"));
  const on = buildFanqieBrief("使用 writer_review 派独立编辑。", { creationFirst: true });
  assert.ok(on.includes("你的目标是在番茄小说平台"), "创作定向存在");
  assert.ok(on.indexOf("你的目标是在番茄小说平台") < on.indexOf("## 规矩"), "定向在路线与规矩前");
  assert.ok(on.indexOf("工程归代码") > on.indexOf("## 规矩"), "工程约束压后");
  assert.match(on, /## 工程约束/);
  for (let item = 1; item <= 11; item += 1)
    assert.ok(on.includes(String(item) + "."), `工程条目 ${item} 不丢`);
  const editorOn = buildFanqieEditorBrief({ creationFirst: true });
  assert.ok(editorOn.includes("你的目标是用读者的眼光"), "编辑创作定向存在");
  assert.ok(editorOn.indexOf("工程归代码") > editorOn.indexOf("只审不定稿"));
  assert.equal(systemBrief().includes("工程归代码"), true, "无参 systemBrief 保持工程段完整");
});

test("写作台路由：审读信息、定稿条件、状态转换与投递指令", async () => {
  const { call, work, cwd } = await setup({ fanqie: { requireEditorPass: true } });
  const config = { fanqie: { storageRoot: path.join(cwd, ".writer"), requireEditorPass: true } };
  const request = await createCommandHarness(config);
  const { buildDeliveryPrompt } = await import(buildUrl("fanqie/src/workbench/delivery.js"));
  await call("fanqie_chapter_list", {});
  const projects = await request("/projects", { input: { refresh: 1 } });
  const project = projects.projects.find((project) => project.base === path.join(cwd, ".writer"));
  assert.ok(project);
  const getChapter = async () =>
    await request("/chapter", { input: { base: project.id, work: work.key, id: "c001" } });
  const input = async () => ({
    base: project.id,
    work: work.key,
    chapter: "c001",
    expectedRevision: (await readChapter(work.dir, "c001")).revision,
    confirm: true,
  });
  const post = (route, body) => request(route, { kind: "write", input: body });
  let chapter = await getChapter();
  assert.equal(chapter.writer.editorReview, null);
  assert.equal(chapter.writer.requireEditorPass, true);
  assert.match(chapter.writer.finalizeBlocked, /还没有编辑审读回报/);
  assert.equal((await post("/chapter/review", await input())).ok, true);
  const blocked = await post("/chapter/finalize", await input());
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /还没有编辑审读回报/);
  await call("fanqie_review_report", {
    chapter: "c001",
    verdict: "未通过",
    hard_issues: [
      {
        category: "本书硬约束",
        location: "第 2 段",
        basis: "车票时间写成九点",
        fix: "改回八点四十",
      },
    ],
    levels: [],
    reread_full: true,
  });
  chapter = await getChapter();
  assert.equal(chapter.writer.editorReview.verdict, "未通过");
  assert.equal(chapter.writer.editorReview.stale, false);
  assert.equal(chapter.writer.editorReview.hardIssues, 1);
  assert.match(chapter.writer.editorReview.summary, /本书硬约束/);
  const revision = await buildDeliveryPrompt(work.dir, { chapter: "c001", action: "revise" });
  assert.match(revision.text, /^【写作台】按最新编辑审读回报修改《两张车票》第 1 章/);
  const next = await buildDeliveryPrompt(work.dir, { action: "continue" });
  assert.match(next.text, /续写《两张车票》第 2 章「第二章 站台」/);
  await call("fanqie_review_report", {
    chapter: "c001",
    verdict: "通过",
    hard_issues: [],
    levels: [],
    reread_full: true,
  });
  chapter = await getChapter();
  assert.equal(chapter.writer.finalizeBlocked, undefined);
  assert.equal((await post("/chapter/finalize", await input())).ok, true);
  assert.equal((await readChapter(work.dir, "c001")).status, "final");
  const toutiao = await createToolHarness({ mode: "toutiao", cwd });
  const article = (await toutiao.call("toutiao_article_create", { slug: "wb" })).article;
  await toutiao.call("toutiao_draft_stage", { id: article.id, text: "第一段。\n\n第二段。" });
  const list = await request("/toutiao/articles");
  const row = list.articles.find((row) => row.id === article.id);
  assert.ok(row);
  const detail = await request("/toutiao/article", { input: { root: row.root, id: row.id } });
  assert.equal(detail.article.draft.rev, 1);
  const { buildToutiaoDelivery } = await import(buildUrl("toutiao/src/workbench/data.js"));
  assert.match(
    (await buildToutiaoDelivery(row.root, { id: row.id, action: "review" })).text,
    /^【写作台】派编辑子代理给《2\d{3}-\d\d-\d\d-wb》（/,
  );
  assert.equal(
    (
      await post("/toutiao/adopt", {
        root: row.root,
        id: row.id,
        expectedRev: detail.article.draft.rev,
        expectedSha256: detail.article.draft.sha256,
        confirm: true,
      })
    ).ok,
    false,
  );
});

test("敏感工具不能跳过确认入口，拒绝确认不残留授权", async () => {
  const { engineTools } = await import(buildUrl("fanqie/src/engine/bootstrap.js"));
  const tool = engineTools().find((t) => t.name === "fanqie_chapter_save");
  for (const args of [
    { chapter: "c001", status: "final" },
    { chapter: "c001", force: true },
  ])
    await assert.rejects(
      tool.execute(args, { cwd: await tempDir(), name: tool.name, arguments: args }),
      /确认/,
    );
  const { createGateEngine } = await import(buildUrl("core/src/gates.js"));
  const { executeTool } = await import(buildUrl("core/src/execute.js"));
  const gates = createGateEngine([
    { id: "proof", tool: "proof", locked: true, check: () => ({ kind: "ask", reason: "确认" }) },
  ]);
  let writes = 0;
  const definition = {
    name: "proof",
    execute: async (_args, exec) => {
      assert.equal(gates.consumeConfirmation(exec, "proof"), true);
      assert.equal(gates.consumeConfirmation(exec, "proof"), false);
      writes++;
      return "saved";
    },
    output: { render: () => [] },
  };
  const exec = { cwd: await tempDir(), name: "proof", arguments: {}, token: Symbol("proof") };
  await assert.rejects(
    executeTool(definition, {}, exec, { gates, bind: (fn) => fn(), confirm: async () => false }),
    /取消/,
  );
  assert.equal(gates.consumeConfirmation(exec, "proof"), false);
  await executeTool(
    definition,
    {},
    { ...exec, token: Symbol("approved") },
    { gates, bind: (fn) => fn(), confirm: async () => true },
  );
  assert.equal(writes, 1);
  const { call, cwd, work } = await setup();
  const chapter = await readChapter(work.dir, "c001");
  await call("fanqie_chapter_save", {
    chapter: "c001",
    status: "reviewed",
    expected_revision: chapter.revision,
  });
  const { fanqieGateRules } = await import(buildUrl("fanqie/src/gates.js"));
  const config = { storageRoot: path.join(cwd, ".writer") };
  const boundGates = createGateEngine(fanqieGateRules(config, "writer"));
  const boundTool = engineTools(config, boundGates).find((t) => t.name === "fanqie_chapter_save");
  const { withPluginConfig } = await import(buildUrl("fanqie/src/engine/tools/context.js"));
  const input = { work: work.key, chapter: "c001", status: "final" };
  await assert.rejects(
    executeTool(
      boundTool,
      input,
      { cwd, name: boundTool.name, token: Symbol("stale") },
      {
        gates: boundGates,
        bind: (fn) => withPluginConfig(config, fn),
        confirm: async () => {
          await updateChapter(work.dir, {
            id: "c001",
            title: "新稿",
            body: "作者在确认前改了正文。",
          });
          return true;
        },
      },
    ),
    /变化|revision|审读/,
  );
  assert.notEqual((await readChapter(work.dir, "c001")).status, "final");
});

test("T4 审读回报混合时区与 UTC 格式时按实际时间取最新", async () => {
  const { call, work } = await setup();
  const saved = await call("fanqie_review_report", {
    chapter: "c001",
    verdict: "通过",
    hard_issues: [],
    levels: [],
    reread_full: true,
  });
  const dir = path.join(work.dir, "writer-reviews", "c001");
  const file = path.join(dir, saved.saved);
  const report = JSON.parse(await readFile(file, "utf8"));
  const { unlink } = await import("node:fs/promises");
  await unlink(file);
  for (const [at, verdict] of [
    ["2026-11-02T09:00:00+08:00", "未通过"],
    ["2026-11-02T02:00:00.000Z", "通过"],
  ]) {
    await writeFile(
      path.join(dir, `${at.replace(/[:.+]/g, "-")}.json`),
      JSON.stringify({ ...report, at, verdict }),
    );
  }
  const latest = await call("fanqie_review_get", { chapter: "c001" });
  assert.equal(latest.at, "2026-11-02T02:00:00.000Z");
  assert.equal(latest.verdict, "通过");
});

test("T4 旧时区候选在 UTC 扫描后凭据仍有效", async () => {
  const { call, work } = await setup();
  const { stageCandidate, candidateHasLintPass, readCandidate } = await import(
    buildUrl("fanqie/src/engine/work-store.js")
  );
  const candidate = await stageCandidate(work.dir, {
    chapterId: "c001",
    body: "她把车票折好，放进口袋。",
  });
  const file = path.join(work.dir, "candidates", `${candidate.id}.json`);
  const meta = JSON.parse(await readFile(file, "utf8"));
  meta.stagedAt = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
  await writeFile(file, JSON.stringify(meta));
  assert.match(await call("fanqie_style_lint", { candidate: candidate.id }), /token|凭据/);
  assert.equal(candidateHasLintPass(await readCandidate(work.dir, candidate.id)), true);
});

test("T5 工具边界拒绝非对象和错误数组元素类型", async () => {
  const { execute } = await setup();
  for (const input of [null, [], 42, "work"])
    await assert.rejects(execute("fanqie_project_list", input), (e) => e.code === "bad_args");
  await assert.rejects(
    execute("fanqie_library_list", { source_ids: [42] }),
    (e) => e.code === "bad_args",
  );
});
