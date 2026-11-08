/** 写作层与引擎的衔接：会话追踪与投递、定稿条件（requireEditorPass）、单章审读信息、forge 正文体检、写作台路由组合、浏览器端区块。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  updateChapter,
  setOutline,
  readChapter,
} from "../../build/fanqie/src/engine/storage/chapters.js";
import { buildDeliveryPrompt } from "../../build/fanqie/src/workbench/delivery.js";
import { fanqieApi } from "../../build/fanqie/src/workbench/api.js";
import { bodyFingerprint, saveReview } from "../../build/fanqie/src/review.js";
import { createToolHarness, tempDir } from "../helpers.mjs";
import { jpost, servePanel, withWork, loadComponents } from "./helpers.mjs";

const get = (api, route) => fetch(`${api}${route}`);

test("工具执行缺少 cwd 时在执行前拒绝，不回落进程目录", async () => {
  const { executeTool } = await import("../../build/core/src/execute.js");
  const { createGateEngine } = await import("../../build/core/src/gates.js");
  let writes = 0;
  const tool = {
    name: "proof",
    execute: async () => {
      writes++;
    },
    output: { render: () => [] },
  };
  await assert.rejects(
    executeTool(
      tool,
      {},
      { name: "proof", arguments: {} },
      {
        gates: createGateEngine([]),
        bind: (run) => run(),
        confirm: async () => true,
      },
    ),
    /缺少工作目录/,
  );
  assert.equal(writes, 0);
});

test("路由错误统一区分参数、缺失、冲突和基础设施故障", async () => {
  const { sendError } = await import("../../build/workbench/src/routes.js");
  const { WriterError } = await import("../../build/core/src/tool.js");
  for (const [error, status] of [
    [new WriterError("NOT_FOUND", "缺失"), 404],
    [new WriterError("INVALID_ARGS", "输入错误"), 400],
    [new WriterError("OUT_OF_ROOT", "越界"), 400],
    [new WriterError("CONFLICT", "冲突"), 409],
    [new Error("磁盘读取失败"), 500],
    [Object.assign(new Error("权限不足"), { code: "EACCES" }), 500],
  ]) {
    let response;
    sendError(
      {
        json: (status, data) => {
          response = { status, data };
        },
      },
      error,
    );
    assert.equal(response.status, status);
    assert.equal(response.data.error, error.message);
  }
});

test("下一章选择：第一章没正文的，否则新的一章", async () => {
  const work = await withWork("空书");
  try {
    const p = await buildDeliveryPrompt(work.dir, { action: "continue" });
    assert.match(p.text, /新的一章（第 1 章/);
    await assert.rejects(
      buildDeliveryPrompt(work.dir, { action: "continue", chapter: "nope" }),
      /没有这一章/,
    );
    const { readFile, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const metaPath = path.join(work.dir, "meta.json"),
      meta = JSON.parse(await readFile(metaPath, "utf8"));
    for (const [chapters, expected] of [
      [
        [
          { id: "a", position: 1, status: "final", wordCount: 100 },
          { id: "b", position: 2, status: "planned", wordCount: 0 },
        ],
        "b",
      ],
      [
        [
          { id: "a", position: 1, status: "planned", wordCount: 100 },
          { id: "b", position: 2, status: "planned", wordCount: 0 },
        ],
        "b",
      ],
      [[{ id: "a", position: 1, status: "drafted", wordCount: 100 }], undefined],
    ]) {
      await writeFile(
        metaPath,
        JSON.stringify({ ...meta, chapters: chapters.map((row) => ({ ...row, title: row.id })) }),
      );
      assert.equal(
        (await buildDeliveryPrompt(work.dir, { action: "continue" })).chapterId,
        expected,
      );
    }
  } finally {
    await work.cleanup();
  }
});

test("定稿条件：requireEditorPass 时写作台与工具两条路径都要当前正文的通过回报；单章读取带审读信息", async () => {
  const work = await withWork("门禁");
  const server = await servePanel({ storageRoot: work.base, requireEditorPass: true });
  try {
    await setOutline(work.dir, "c001", { ending: "门开了" }, "第一章");
    await updateChapter(work.dir, { id: "c001", title: "第一章", body: "她推开门。" });
    let chapter = await (
      await get(server.api, `/chapter?work=${encodeURIComponent(work.key)}&id=c001`)
    ).json();
    assert.equal(chapter.writer.editorReview, null);
    assert.equal(chapter.writer.requireEditorPass, true);
    assert.match(chapter.writer.finalizeBlocked, /还没有编辑审读回报/);
    const request = {
      work: work.key,
      chapter: "c001",
      expectedRevision: (await readChapter(work.dir, "c001")).revision,
      confirm: true,
    };
    assert.equal(
      (await jpost(server.api, "/chapter/review", request)).status,
      200,
      "作者审读声明不受定稿条件影响",
    );
    const after = { ...request, expectedRevision: (await readChapter(work.dir, "c001")).revision };
    const blocked = await jpost(server.api, "/chapter/finalize", after);
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).code, "writer_finalize_blocked");
    const harness = await createToolHarness({
      mode: "fanqie",
      cwd: work.base,
      config: { storageRoot: work.base, requireEditorPass: true },
    });
    await assert.rejects(
      harness.execute("fanqie_chapter_save", { work: work.key, chapter: "c001", status: "final" }),
      /还没有编辑审读回报/,
    );
    assert.notEqual((await readChapter(work.dir, "c001")).status, "final");
    const body = (await readChapter(work.dir, "c001")).body;
    const review = (verdict, sha) =>
      saveReview(work.dir, {
        work: work.key,
        work_title: "门禁",
        chapter: "c001",
        chapter_title: "第一章",
        body_sha256: sha,
        verdict,
        hard_issues: [],
        levels: [],
        optional: [],
        reread_full: true,
        changed_scope: "未改",
        strengths: "",
        by: "editor",
        at: new Date().toISOString(),
      });
    await review("通过", bodyFingerprint("旧正文"));
    chapter = await (
      await get(server.api, `/chapter?work=${encodeURIComponent(work.key)}&id=c001`)
    ).json();
    assert.equal(chapter.writer.editorReview.stale, true);
    assert.match(chapter.writer.finalizeBlocked, /旧正文/);
    await new Promise((r) => setTimeout(r, 5));
    await review("通过", bodyFingerprint(body));
    chapter = await (
      await get(server.api, `/chapter?work=${encodeURIComponent(work.key)}&id=c001`)
    ).json();
    assert.equal(chapter.writer.editorReview.verdict, "通过");
    assert.equal(chapter.writer.finalizeBlocked, undefined);
    assert.equal((await jpost(server.api, "/chapter/finalize", after)).status, 200);
  } finally {
    await server.close();
    await work.cleanup();
  }
});

test("forge 正文体检：章节与纯文本扫描后都追加在语感雷达之后", async () => {
  const work = await withWork("体检");
  try {
    const harness = await createToolHarness({
      mode: "fanqie",
      cwd: work.base,
      config: { storageRoot: work.base },
    });
    await setOutline(work.dir, "c001", { ending: "门开了" }, "第一章");
    await updateChapter(work.dir, {
      id: "c001",
      title: "第一章",
      body: "她推开门。他的嘴角勾起一抹弧度。",
    });
    const chapter = await harness.call("fanqie_style_lint", { work: work.key, chapter: "c001" });
    assert.match(chapter, /### forge 正文体检（\d+ 处，仅提示回看位置）/);
    assert.match(chapter, /\d+ 字 · \d+ 段/);
    const plain = await harness.call("fanqie_style_lint", { text: "他笑了笑。" });
    assert.match(plain, /### forge 正文体检/);
  } finally {
    await work.cleanup();
  }
});

test("拆书导入：模型给的 file 只能落在会话目录或本地书源目录内，作者选文件的导入不受限", async () => {
  const { mkdir, readFile, rm, symlink, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const { LibraryPort } = await import("../../build/fanqie/src/engine/ports/index.js");
  const { storagePaths } = await import("../../build/fanqie/src/engine/storage/paths.js");
  const root = await tempDir("fq05-");
  try {
    const cwd = path.join(root, "session");
    const books = path.join(root, "books");
    const outside = path.join(root, "outside");
    for (const dir of [cwd, books, outside]) await mkdir(dir);
    const secret = path.join(outside, "secret.txt");
    await writeFile(secret, "第一章 机密\n不该进拆书库的内容。\n");
    await writeFile(path.join(books, "书源.txt"), "第一章 书源\n书源里的原文。\n");
    await writeFile(path.join(cwd, "会话.txt"), "第一章 会话\n会话目录里的原文。\n");
    await symlink(outside, path.join(books, "linked"), "junction");
    const config = { storageRoot: path.join(cwd, ".writer"), sourceRoot: books };
    const harness = await createToolHarness({ mode: "fanqie", cwd, config });
    const paths = storagePaths(null, config);
    const sourceCount = async () => (await LibraryPort.listSources(paths)).length;
    const before = await sourceCount();

    for (const [file, code] of [
      [secret, "OUT_OF_ROOT"],
      ["../outside/secret.txt", "OUT_OF_ROOT"],
      ["linked/secret.txt", "OUT_OF_ROOT"],
      ["不存在.txt", "NOT_FOUND"],
    ]) {
      const result = await harness.call("fanqie_library_import", { title: "越界", file });
      assert.equal(result.code, code, `${file} → ${JSON.stringify(result)}`);
    }
    assert.equal(await sourceCount(), before, "被拒的导入不得新增书源");

    assert.match(
      await harness.call("fanqie_library_import", { title: "书源", file: "书源.txt" }),
      /已导入「书源」/,
    );
    assert.match(
      await harness.call("fanqie_library_import", { title: "会话", file: "会话.txt" }),
      /已导入「会话」/,
    );
    const sources = await LibraryPort.listSources(paths);
    assert.equal(sources.length, before + 2);
    for (const source of sources) {
      const body = await readFile(path.join(paths.library, "sources", `${source.id}.txt`), "utf8");
      assert.doesNotMatch(body, /机密/);
    }

    // “设置 › 导入”由作者在系统对话框里选文件，IPC 直接交给 LibraryPort，任意位置都照常导入。
    const picked = await LibraryPort.importSource(paths, { title: "作者选的", file: secret });
    assert.match(
      await readFile(path.join(paths.library, "sources", `${picked.sourceId}.txt`), "utf8"),
      /机密/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("写作台路由按真实路径处理，未知路径不接管", async () => {
  const api = fanqieApi({});
  assert.ok(api.routes.includes("/api/writer/projects"));
  let response;
  const url = new URL("app://writer/api/writer/nope");
  assert.equal(
    await api.handle({
      url,
      path: url.pathname,
      method: "GET",
      body: async () => ({}),
      json: (_, data) => {
        response = data;
      },
    }),
    false,
  );
  assert.equal(response, undefined);
});

test("写作台“写作 Agent”区块：按能力与回报渲染按钮", async () => {
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() });
  const react = {
    createElement: h,
    Component: class {},
    Fragment: "fragment",
    memo: (c) => c,
    useState: (v) => [typeof v === "function" ? v() : v, () => {}],
    useCallback: (f) => f,
    useMemo: (f) => f(),
    useEffect: () => {},
    useRef: (v) => ({ current: v }),
  };
  const { WriterAgent } = loadComponents(react);
  const texts = (node) =>
    node == null || typeof node === "boolean"
      ? []
      : typeof node === "string" || typeof node === "number"
        ? [String(node)]
        : Array.isArray(node)
          ? node.flatMap(texts)
          : typeof node.type === "function"
            ? texts(node.type({ ...node.props, children: node.children }))
            : texts(node.children ?? node.props?.children);
  const buttons = (node, out = []) => {
    if (!node || typeof node !== "object") return out;
    if (Array.isArray(node)) {
      node.forEach((n) => buttons(n, out));
      return out;
    }
    if (typeof node.type === "function")
      return buttons(node.type({ ...node.props, children: node.children }), out);
    if (node.type === "button") out.push(node);
    buttons(node.children, out);
    return out;
  };
  const off = WriterAgent({
    state: { deliver: { caps: { deliver: false, reason: "没有会话" } } },
    actions: {},
    chapterId: "c001",
    writer: null,
    bodyReady: true,
  });
  assert.ok(texts(off).join("").includes("暂时不能投递到对话：没有会话"));
  assert.ok(buttons(off).every((b) => b.props.disabled));
  const failed = WriterAgent({
    state: { deliver: { caps: { deliver: true } } },
    actions: {},
    chapterId: "c001",
    writer: {
      editorReview: {
        verdict: "未通过",
        stale: false,
        hardIssues: 2,
        levels: 1,
        at: "2026-10-28T12:00:00Z",
      },
      requireEditorPass: true,
    },
    bodyReady: true,
  });
  const text = texts(failed).join("");
  assert.ok(
    text.includes("未通过") &&
      text.includes("四类硬伤 2 处") &&
      text.includes("定稿前须有当前版本"),
  );
  assert.deepEqual(
    buttons(failed).map((b) => texts(b)[0]),
    ["续写下一章", "派编辑审读本章", "按回报修改", "抽卡本章开头", "抽卡本章章末"],
  );
  assert.ok(buttons(failed).every((b) => !b.props.disabled));
  const passed = WriterAgent({
    state: { deliver: { caps: { deliver: true } } },
    actions: {},
    chapterId: "c001",
    writer: { editorReview: { verdict: "通过", stale: false } },
    bodyReady: true,
  });
  assert.deepEqual(
    buttons(passed).map((b) => texts(b)[0]),
    ["续写下一章", "派编辑审读本章", "抽卡本章开头", "抽卡本章章末"],
  );
});

test("写作台今日头条模式：按状态与质检渲染采用和写作 Agent 按钮", async () => {
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() });
  const react = {
    createElement: h,
    Component: class {},
    Fragment: "fragment",
    memo: (c) => c,
    useState: (v) => [typeof v === "function" ? v() : v, () => {}],
    useCallback: (f) => f,
    useMemo: (f) => f(),
    useEffect: () => {},
    useRef: (v) => ({ current: v }),
    useId: () => "id",
  };
  const { ToutiaoSide } = loadComponents(react);
  const texts = (node) =>
    node == null || typeof node === "boolean"
      ? []
      : typeof node === "string" || typeof node === "number"
        ? [String(node)]
        : Array.isArray(node)
          ? node.flatMap(texts)
          : typeof node.type === "function"
            ? texts(node.type({ ...node.props, children: node.children }))
            : texts(node.children ?? node.props?.children);
  const buttons = (node, out = []) => {
    if (!node || typeof node !== "object") return out;
    if (Array.isArray(node)) {
      node.forEach((n) => buttons(n, out));
      return out;
    }
    if (typeof node.type === "function")
      return buttons(node.type({ ...node.props, children: node.children }), out);
    if (node.type === "button") out.push(node);
    buttons(node.children, out);
    return out;
  };
  const article = (over) => ({
    title: "秋柿",
    status: "初稿待改",
    line: "资讯线",
    genre: "长图文",
    returnRounds: 0,
    maxReturnRounds: 2,
    card: { present: true, 主问题: "柿子为什么涩" },
    headlines: { main: "秋柿", alts: [] },
    qa: [],
    qaValid: false,
    qaProblem: "当前版本还没跑质检",
    draft: { rev: 1 },
    history: [],
    adoptable: false,
    ...over,
  });
  const tt = (a, off = "") => ({
    adoptReady: true,
    detail: { status: "ready", article: a },
    busy: "",
    deliverOff: off,
    doneAt: {},
    actions: {},
  });
  const none = ToutiaoSide({
    tt: {
      detail: { status: "idle", article: null },
      busy: "",
      deliverOff: "",
      actions: {},
    },
  });
  const labels = (node) => buttons(node).map((b) => texts(b)[0]);
  assert.deepEqual(labels(none), ["新写一篇"]);
  const draft = ToutiaoSide({ tt: tt(article()) });
  assert.deepEqual(labels(draft), ["采用（标记为已交稿）", "继续推进", "派编辑红笔", "新写一篇"]);
  assert.equal(buttons(draft)[0].props.disabled, true, "未验收不能采用");
  const failed = ToutiaoSide({
    tt: tt(article({ qa: [{ rev: 1, score: 70, pass: false, hardGates: ["标点"] }] })),
  });
  assert.ok(
    texts(failed).join("").includes("70 分 · 未过线") &&
      texts(failed).join("").includes("硬闸：标点"),
  );
  assert.ok(labels(failed).includes("按质检修改"));
  const ready = ToutiaoSide({
    tt: tt(
      article({
        status: "已验收",
        qa: [{ rev: 1, score: 90, pass: true, hardGates: [] }],
        qaValid: true,
        adoptable: true,
      }),
    ),
  });
  assert.equal(buttons(ready)[0].props.disabled, false);
  assert.equal(
    buttons(ToutiaoSide({ tt: { ...tt(article({ adoptable: true })), adoptReady: false } }))[0]
      .props.disabled,
    true,
    "详情与选中对象不一致时不能采用",
  );
  assert.ok(!labels(ready).includes("按质检修改"));
  const off = ToutiaoSide({ tt: tt(article(), "暂时不能发到对话：没有会话") });
  assert.ok(
    buttons(off)
      .slice(1)
      .every((b) => b.props.disabled),
  );
  assert.ok(texts(off).join("").includes("没有会话"));
  const done = ToutiaoSide({ tt: tt(article({ status: "已交稿" })) });
  assert.deepEqual(labels(done), ["新写一篇"]);
});

test("T7 按周分组的标题没有文章状态点，行状态仍可见", () => {
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() });
  const react = {
    createElement: h,
    Component: class {},
    Fragment: "fragment",
    memo: (c) => c,
    useState: (v) => [v, () => {}],
  };
  const { ArticleList } = loadComponents(react);
  const tree = ArticleList({
    articles: [
      {
        root: "/book",
        id: "2026-11-02-one",
        title: "周一",
        status: "已交稿",
        updatedAt: "2026-11-02T10:00:00Z",
      },
    ],
    sel: {},
    onSelect: () => {},
  });
  let headings = 0,
    dots = 0;
  function visit(node, heading = false) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, heading));
      return;
    }
    if (typeof node.type === "function") {
      visit(node.type({ ...node.props, children: node.children }), heading);
      return;
    }
    heading = heading || node.props.className === "wb-tt-group-head";
    if (node.props.className === "wb-tt-group-head") headings++;
    if (String(node.props.className).includes("wb-state-dot")) {
      assert.equal(heading, false);
      dots++;
    }
    visit(node.children, heading);
  }
  visit(tree);
  assert.equal(headings, 1);
  assert.ok(dots > 0, "文章行保留真实状态点");
});
