import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildUrl, createToolHarness, tempDir, FIX } from "./helpers.mjs";

const store = await import(buildUrl("fanqie/src/engine/work-store.js"));
const { LibraryPort } = await import(buildUrl("fanqie/src/engine/ports/library.js"));
const childImport = `const store = await import(${JSON.stringify(buildUrl("fanqie/src/engine/work-store.js"))});`;
async function runChild(state, source) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    env: { ...process.env, WRITER_STATE_ROOT: state },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(status, 0, output);
  return output;
}

test("T3-01 损坏项目索引拒绝登记，不覆盖原件并写诊断", async (t) => {
  const state = await tempDir();
  t.after(() => rm(state, { recursive: true, force: true }));
  const original = "{broken projects";
  await writeFile(path.join(state, "writer-novel-projects.json"), original);
  await runChild(
    state,
    `${childImport}
    const assert = await import('node:assert/strict');
    await assert.rejects(store.rememberProject(${JSON.stringify(path.join(state, "project"))}, ''), error => error.code === 'index_corrupt');`,
  );
  assert.equal(await readFile(path.join(state, "writer-novel-projects.json"), "utf8"), original);
  const logs = await readdir(path.join(state, "logs"));
  assert.match(await readFile(path.join(state, "logs", logs[0]), "utf8"), /project_index_error/);
});

test("T3-01 多进程并发登记保留全部项目", async (t) => {
  const state = await tempDir();
  t.after(() => rm(state, { recursive: true, force: true }));
  const roots = Array.from({ length: 12 }, (_, index) => path.join(state, "project-" + index));
  await Promise.all(
    roots.map((base) =>
      runChild(state, `${childImport} await store.rememberProject(${JSON.stringify(base)}, '');`),
    ),
  );
  const saved = JSON.parse(await readFile(path.join(state, "writer-novel-projects.json"), "utf8"));
  assert.deepEqual(saved.projects.map((project) => project.base).sort(), roots.sort());
});

test("T3-02 最近工具根和本地书目录的读取错误不能变为空数据", async (t) => {
  const state = await tempDir();
  t.after(() => rm(state, { recursive: true, force: true }));
  await mkdir(path.join(state, "writer-novel-last-root.json"));
  await runChild(
    state,
    `${childImport}
    const assert = await import('node:assert/strict');
    await assert.rejects(store.loadLastToolBase(), error => error.code === 'EISDIR' || error.code === 'EPERM');`,
  );
  const file = path.join(state, "not-a-directory");
  await writeFile(file, "x");
  await assert.rejects(store.listLocalBooks(file), (error) => error.code === "ENOTDIR");
  assert.deepEqual(await store.listLocalBooks(path.join(state, "missing")), []);
});

test("T3-03 当前目录回退保留全部库、作品与书源配置", async (t) => {
  const state = await tempDir();
  t.after(() => rm(state, { recursive: true, force: true }));
  const cwd = path.join(state, "workspace");
  await mkdir(path.join(cwd, ".writer"), { recursive: true });
  await runChild(
    state,
    `process.chdir(${JSON.stringify(cwd)});
    const {resolvePanelPaths} = await import(${JSON.stringify(buildUrl("fanqie/src/workbench/paths.js"))});
    const assert = await import('node:assert/strict');
    const result = await resolvePanelPaths({worksRoot:'novels', libraryRoot:'shared-library', sourceRoot:'books'});
    assert.equal(result.works,${JSON.stringify(path.join(cwd, "novels"))});
    assert.equal(result.library,${JSON.stringify(path.join(cwd, "shared-library"))});
    assert.equal(result.sourceRoot,${JSON.stringify(path.join(cwd, "books"))});`,
  );
});

test("T3-04 库读取不创建目录或争用写锁", async (t) => {
  const root = await tempDir();
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = store.storagePaths(null, { storageRoot: root }, undefined);
  assert.deepEqual(await LibraryPort.listSources(paths), []);
  await assert.rejects(
    readFile(path.join(paths.library, "index.json")),
    (error) => error.code === "ENOENT",
  );
  await LibraryPort.ensureLibrary(paths);
  const lock = path.join(paths.library, ".writer-write-lock");
  await mkdir(lock);
  const pending = LibraryPort.listSources(paths);
  let completed;
  try {
    completed = await Promise.race([
      pending.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 300)),
    ]);
  } finally {
    await rm(lock, { recursive: true });
    await pending;
  }
  assert.equal(completed, true, "只读查询不能等待写锁");
});

test("T3-06 头条损坏元数据导致门禁拒绝，不弹出采用确认", async (t) => {
  const cwd = await tempDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const harness = await createToolHarness({ mode: "toutiao", cwd });
  const result = await harness.call("toutiao_article_create", { slug: "broken" });
  const { ArticleStore } = await import(buildUrl("toutiao/src/store.js"));
  const articles = new ArticleStore(result.root);
  await writeFile(articles.metaPath(result.article.id), "{broken");
  const decision = await harness.gates.evaluate({
    cwd,
    name: "toutiao_status",
    arguments: { id: result.article.id, to: "已交稿" },
    token: Symbol(),
  });
  assert.equal(decision.kind, "deny");
  assert.match(decision.reason, /损坏/);
  assert.equal(harness.approvals.length, 0);
});

async function passingArticle(t) {
  const cwd = await tempDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const harness = await createToolHarness({ mode: "toutiao", cwd });
  const created = await harness.call("toutiao_article_create", { slug: "lost" });
  const id = created.article.id;
  await harness.call("toutiao_card_set", {
    id,
    card: JSON.parse(await readFile(path.join(FIX, "story_long_card.json"), "utf8")),
  });
  await harness.call("toutiao_draft_stage", {
    id,
    text: await readFile(path.join(FIX, "story_long_good.md"), "utf8"),
  });
  assert.equal((await harness.call("toutiao_qa_check", { id })).pass, true);
  const { ArticleStore } = await import(buildUrl("toutiao/src/store.js"));
  return { root: created.root, id, articles: new ArticleStore(created.root) };
}

test("T3-07 稿件丢失明确标错，不能显示质检有效或允许采用", async (t) => {
  const { root, id, articles } = await passingArticle(t);
  await rm(articles.draftPath(id, 1));
  const { articleDetail } = await import(buildUrl("toutiao/src/workbench/data.js"));
  const detail = await articleDetail(root, id);
  assert.match(detail.problem, /稿件文件缺失/);
  assert.equal(detail.qaValid, false);
  assert.equal(detail.adoptable, false);
  const { validPassingQa } = await import(buildUrl("toutiao/src/article-service.js"));
  assert.equal((await validPassingQa(articles, await articles.get(id))).ok, false);
});

test("T3-07 稿件真实 IO 故障向界面报错", async (t) => {
  const { root, id, articles } = await passingArticle(t);
  await rm(articles.draftPath(id, 1));
  await mkdir(articles.draftPath(id, 1));
  const { articleDetail } = await import(buildUrl("toutiao/src/workbench/data.js"));
  await assert.rejects(articleDetail(root, id), (error) =>
    ["EISDIR", "EPERM", "CONFLICT"].includes(error.code),
  );
});

test("T3-08 定稿检查保留章节读取错误，不伪造成空正文", async (t) => {
  const root = await tempDir();
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = await store.ensureStorage(null, { storageRoot: root });
  const work = await store.createWork(paths, { title: "读取失败" });
  await store.updateChapter(work.dir, { id: "c001", title: "第一章", body: "旧正文。" });
  const chapter = path.join(work.dir, "chapters/c001.md");
  await rm(chapter);
  await mkdir(chapter);
  const { createGateEngine } = await import(buildUrl("core/src/gates.js"));
  const { executeTool } = await import(buildUrl("core/src/execute.js"));
  const { engineTools } = await import(buildUrl("fanqie/src/engine/bootstrap.js"));
  const gates = createGateEngine([
    {
      id: "fanqie.finalize_requires_author",
      tool: "fanqie_chapter_save",
      locked: true,
      description: "作者确认",
      check: () => ({ kind: "ask", reason: "确认" }),
    },
  ]);
  const config = { storageRoot: root, requireEditorPass: true };
  const tool = engineTools(config, gates).find((tool) => tool.name === "fanqie_chapter_save");
  await assert.rejects(
    executeTool(
      tool,
      { work: work.meta.key, chapter: "c001", status: "final" },
      { cwd: root, name: tool.name, arguments: {}, token: Symbol() },
      { gates, bind: (run) => run(), confirm: async () => true },
    ),
    (error) => ["EISDIR", "EPERM", "CONFLICT"].includes(error.code),
  );
});

test("T3-09 拆书报告列明不可读卡片，不静默遗漏", async (t) => {
  const root = await tempDir();
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = await store.ensureStorage(null, { storageRoot: root });
  const source = await LibraryPort.importSource(paths, {
    title: "测试小说",
    text: "第1章 开始\n她推开门。\n",
  });
  const indexFile = path.join(paths.library, "index.json");
  const index = JSON.parse(await readFile(indexFile, "utf8"));
  index.cards.push({
    id: "unreadable",
    sourceId: source.sourceId,
    title: "不可读卡",
    axis: "craft",
    status: "accepted",
  });
  await writeFile(indexFile, JSON.stringify(index));
  await writeFile(path.join(paths.library, "cards/unreadable.json"), "{broken");
  const harness = await createToolHarness({
    mode: "fanqie",
    cwd: root,
    config: { storageRoot: root },
  });
  const result = await harness.call("fanqie_library_report", { source: source.sourceId });
  assert.equal(typeof result, "string", JSON.stringify(result));
  const report = await readFile(
    path.join(paths.library, "analyses", source.sourceId, "report.md"),
    "utf8",
  );
  assert.match(report, /1 张卡不可读/);
  assert.match(report, /unreadable/);
  // 只有 id 不够排障：报告须带上真实读取错误。
  assert.match(report, /unreadable：/);
});

test("T3-09 章节文件损坏报 bad_chapter，不被误诊为「章节不存在」", async (t) => {
  const root = await tempDir();
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = await store.ensureStorage(null, { storageRoot: root });
  const work = await store.createWork(paths, { title: "损坏章节" });
  await store.updateChapter(work.dir, { id: "c001", title: "第一章", body: "正文。" });
  await writeFile(path.join(work.dir, "chapters/c001.md"), "---\n{broken json\n---\n\n正文。\n");
  const harness = await createToolHarness({
    mode: "fanqie",
    cwd: root,
    config: { storageRoot: root },
  });
  for (const [tool, args] of [
    ["fanqie_payoff_audit", { work: work.meta.key, chapter: "c001" }],
    [
      "fanqie_review_ledger",
      { work: work.meta.key, action: "append", chapter: "c001", summary: "定稿" },
    ],
  ]) {
    const result = await harness.call(tool, args);
    assert.equal(result.ok, false, `${tool} 应失败：${JSON.stringify(result)}`);
    assert.match(
      result.message,
      /front matter/,
      `${tool} 必须报告文件损坏：${JSON.stringify(result)}`,
    );
    assert.notEqual(result.code, "not_found", `${tool} 不能把损坏报成不存在`);
  }
});

test("T3-12 方案与资产目录 IO 故障不能显示为没有数据", async (t) => {
  const root = await tempDir();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "fanqie"), "not a directory");
  const { setProfilesRoot, listProfiles } = await import(buildUrl("core/src/profiles.js"));
  const { fanqieLibrary } = await import(buildUrl("fanqie/src/forge.js"));
  const { readMethodFolder } = await import(buildUrl("core/src/profile-tool.js"));
  const { listUserAssets } = await import(buildUrl("core/src/user-assets.js"));
  setProfilesRoot(root);
  try {
    await assert.rejects(listProfiles(fanqieLibrary), (error) => error.code === "ENOTDIR");
    await assert.rejects(
      readMethodFolder(path.join(root, "fanqie")),
      (error) => error.code === "ENOTDIR",
    );
    await assert.rejects(
      listUserAssets({ dirs: [path.join(root, "fanqie", "nested")] }, root),
      (error) => error.code === "ENOTDIR",
    );
  } finally {
    setProfilesRoot(undefined);
  }
});

test("T3-01 索引 IO 故障向上抛出，同进程修复后可以重新登记", async (t) => {
  const state = await tempDir();
  t.after(() => rm(state, { recursive: true, force: true }));
  const file = path.join(state, "writer-novel-projects.json"),
    base = path.join(state, "book");
  await mkdir(file);
  await runChild(
    state,
    `${childImport}
    const fs=await import('node:fs/promises'),assert=await import('node:assert/strict');
    await assert.rejects(store.rememberProject(${JSON.stringify(base)},''), error=>['EISDIR','EPERM'].includes(error.code));
    await fs.rm(${JSON.stringify(file)},{recursive:true});
    await store.rememberProject(${JSON.stringify(base)},'');
    assert.equal(JSON.parse(await fs.readFile(${JSON.stringify(file)},'utf8')).projects.length,1);`,
  );
});

test("T10 头条目录索引损坏阻止工具写入，修复后同进程可重试且保留旧目录", async (t) => {
  const state = await tempDir();
  t.after(() => rm(state, { recursive: true, force: true }));
  const index = path.join(state, "writer-toutiao-roots.json");
  await writeFile(index, "{broken");
  const cwd = path.join(state, "workspace");
  await mkdir(cwd);
  await runChild(
    state,
    `
    const assert=await import('node:assert/strict');
    const fs=await import('node:fs/promises');
    const {createToolHarness}=await import(${JSON.stringify(new URL("./helpers.mjs", import.meta.url).href)});
    const harness=await createToolHarness({mode:'toutiao',cwd:${JSON.stringify(cwd)}});
    const failed=await harness.call('toutiao_article_create',{slug:'retry'});
    assert.equal(failed.ok,false);
    assert.match(failed.message,/损坏/);
    assert.equal(await fs.readFile(${JSON.stringify(index)},'utf8'),'{broken');
    await fs.writeFile(${JSON.stringify(index)},JSON.stringify(['/existing/articles']));
    const created=await harness.call('toutiao_article_create',{slug:'retry'});
    const roots=JSON.parse(await fs.readFile(${JSON.stringify(index)},'utf8'));
    assert.deepEqual(roots,['/existing/articles',created.root]);
  `,
  );
});

test("随包 Python 准备失败保留现有运行目录，命中校验标记时可重复执行", async (t) => {
  const root = await tempDir();
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, "scripts");
  const runtime = path.join(root, "apps/desktop/resources/python");
  await mkdir(scripts, { recursive: true });
  await mkdir(runtime, { recursive: true });
  const script = path.join(scripts, "prepare-desktop-python.mjs");
  await writeFile(
    script,
    await readFile(new URL("../scripts/prepare-desktop-python.mjs", import.meta.url)),
  );
  const marker = path.join(runtime, "writer-runtime.json");
  const sentinel = path.join(runtime, "author-data.txt");
  await writeFile(sentinel, "keep");
  await mkdir(marker);
  const run = () =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, output }));
    });
  const failed = await run();
  assert.notEqual(failed.code, 0);
  assert.match(failed.output, /EISDIR|EPERM/);
  assert.equal(await readFile(sentinel, "utf8"), "keep");
  await rm(marker, { recursive: true });
  await mkdir(path.join(runtime, "DLLs"));
  await writeFile(
    marker,
    JSON.stringify({ sha256: "ebe90cc1dce2dd2d7afa1f0aa9b6c269c7c0174aeabdc6a801381602b7283424" }),
  );
  for (let i = 0; i < 2; i++) {
    const result = await run();
    assert.equal(result.code, 0, result.output);
  }
  assert.equal(await readFile(sentinel, "utf8"), "keep");
});

// 用例需要文件符号链接；Windows 普通账户不能建，目录 junction 的越界已由拆书导入用例覆盖。
test(
  "CORE-06 方案工具读文件按 realpath 收口在会话目录内，file 只收 .md",
  {
    skip: process.platform === "win32",
  },
  async (t) => {
    const { symlink, realpath } = await import("node:fs/promises");
    const cwd = await realpath(await tempDir());
    const outside = await realpath(await tempDir());
    const profiles = await tempDir("writer-profiles-");
    t.after(() =>
      Promise.all([cwd, outside, profiles].map((dir) => rm(dir, { recursive: true, force: true }))),
    );
    process.env.WRITER_PROFILES_DIR = profiles;
    t.after(() => delete process.env.WRITER_PROFILES_DIR);
    await writeFile(path.join(outside, "secret.txt"), "# 机密\n外部文件内容\n");
    await mkdir(path.join(outside, "dir"));
    await writeFile(path.join(outside, "dir", "s3-headline.md"), "# 外部\n外部方法\n");
    await symlink(path.join(outside, "secret.txt"), path.join(cwd, "note.md"));
    await symlink(path.join(outside, "dir"), path.join(cwd, "linked"), "dir");
    await mkdir(path.join(cwd, "mine"));
    await writeFile(path.join(cwd, "mine", "s3-headline.md"), "# 我的\n先写钱。\n");
    await symlink(path.join(outside, "secret.txt"), path.join(cwd, "mine", "leak.md"));
    await writeFile(path.join(cwd, "own.md"), "# 自己的\n作品内的方法。\n");
    await writeFile(path.join(cwd, "note.txt"), "# 文本\n");
    const { call } = await createToolHarness({ mode: "toutiao", cwd });
    const made = await call("toutiao_profile", { action: "create", from_dir: "mine" });
    // 文件夹里指向外部的链接不算方法文件。
    assert.deepEqual(made.imported, ["s3-headline"]);
    const methodsDir = path.join(profiles, "toutiao", made.profile.id, "methods");
    assert.deepEqual(await readdir(methodsDir), ["s3-headline.md"]);
    const save = (file) =>
      call("toutiao_profile", {
        action: "save",
        profile: made.profile.id,
        method: "s4-common",
        file,
      });
    const escaped = await save("note.md");
    assert.equal(escaped.code, "OUT_OF_ROOT", JSON.stringify(escaped));
    assert.equal((await save("note.txt")).code, "INVALID_ARGS");
    assert.equal(
      (await call("toutiao_profile", { action: "create", from_dir: "linked" })).code,
      "OUT_OF_ROOT",
    );
    assert.deepEqual(await readdir(methodsDir), ["s3-headline.md"], "越界内容没有落进方案");
    assert.equal((await save("own.md")).id, "s4-common");
    assert.match(await readFile(path.join(methodsDir, "s4-common.md"), "utf8"), /作品内的方法/);
  },
);
