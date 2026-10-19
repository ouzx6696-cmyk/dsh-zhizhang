/**
 * dsh-zhizhang smoke test — no DSH host, no bun.
 *
 *   npm run smoke        (or: node scripts/smoke.mjs)
 *
 * Covers: tool surface / apply wiring · default writing chain (brief → stage →
 * lint → accept) · accept hard gates · resource-id sandbox · panel HTTP
 * (health / snapshot JSON+HTML / chapter / candidate / bad id / confirm gate).
 */
import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPanelApiHandler, resolveHttpPaths } from "../dist/lib/http-api.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const root = await mkdtemp(path.join(tmpdir(), "zz-smoke-"));
delete process.env.DSH_ZHIZHANG_ROOT;
process.env.DSH_HOME = path.join(root, ".dsh");

try {
  const pkg = JSON.parse(await readFile(path.join(pkgRoot, "package.json"), "utf8"));
  const plugin = await import(pathToFileURL(path.join(pkgRoot, "dist/index.js")).href);

  // —— 1. tool surface ——
  const tools = plugin.__testing.tools;
  assert.equal(tools.length, 46, "expected 46 tools");
  assert.equal(new Set(tools.map((t) => t.name)).size, 46, "tool names must be unique");
  for (const tool of tools) {
    assert.match(tool.name, /^zhizhang_/, `${tool.name} must use the zhizhang_ prefix`);
    assert.equal(tool.parameters.type, "object");
    assert.equal(typeof tool.execute, "function");
  }

  // —— 2. on-demand mount ——
  const shell = [];
  const shellSections = [];
  plugin.apply({
    tools: { register: (t) => shell.push(t) },
    get: () => ({ section: (s) => { shellSections.push(s); return () => {}; } }),
  }, {});
  assert.equal(shell.length, 1, "profile mount must register only the trigger");
  assert.equal(shell[0].name, "zhizhang_enable");
  assert.match(shell[0].description, /按需启用/);
  assert.equal(shellSections.length, 0, "profile mount must not inject the hard-rules section");

  const applied = [];
  const sections = [];
  const agentCtx = {
    tools: { register: (t) => applied.push(t) },
    get: () => ({ section: (s) => { sections.push(s); return () => {}; } }),
  };
  const exec = { agent: { ctx: agentCtx, session: { id: "smoke", header: { cwd: root } } } };
  let enableOut = await shell[0].execute({}, exec);
  assert.match(enableOut, /已启用织章/);
  assert.equal(applied.length, tools.length, "trigger must mount every tool");
  assert.equal(sections.length, 1, "trigger must mount the hard-rules section");
  assert.equal(sections[0].name, "tool:zhizhang");
  assert.match(sections[0].text(), /织章/);

  enableOut = await shell[0].execute({}, exec);
  assert.match(enableOut, /已启用织章/);
  assert.equal(applied.length, tools.length, "second enable must not duplicate");

  const noCtx = await shell[0].execute({}, { agent: { session: { id: "x", header: { cwd: root } } } });
  assert.match(noCtx, /no_agent_ctx/);

  const byName = new Map(applied.map((t) => [t.name, t]));
  const run = (name, args = {}) => byName.get(name).execute(args, exec);

  // —— 2. default writing chain ——
  let out = await run("zhizhang_project_create", { title: "烟测小说", genre: "都市" });
  assert.match(out, /已创建作品/);
  const workKey = /key=([^）)]+)/.exec(out)?.[1];
  assert.ok(workKey, "project_create must return key=…");

  // Panel HTTP has no session: it must follow the root the Agent just used.
  const httpPaths = await resolveHttpPaths({});
  assert.equal(path.resolve(httpPaths.base), path.join(root, ".zhizhang"), "HTTP must follow last tool root");

  // …and the root marker must survive a host restart (persisted under DSH_HOME).
  let marker = null;
  for (let i = 0; i < 20 && !marker; i++) {
    try {
      const raw = JSON.parse(await readFile(path.join(root, ".dsh", "zhizhang-last-root.json"), "utf8"));
      if (raw.base) marker = raw;
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  assert.ok(marker, "last-root marker must be persisted");
  assert.equal(path.resolve(marker.base), path.join(root, ".zhizhang"));

  // A fresh process (empty in-memory state) must resolve from the marker alone.
  const freshStore = await import(
    pathToFileURL(path.join(pkgRoot, "dist/lib/store.js")).href + "?fresh=1"
  );
  const fromMarker = await freshStore.loadLastToolBase();
  assert.equal(path.resolve(fromMarker), path.join(root, ".zhizhang"), "marker must survive a restart");

  // —— 2b. cross-project index ——
  const indexFile = path.join(root, ".dsh", "zhizhang-projects.json");
  let index = null;
  for (let i = 0; i < 20 && !index; i++) {
    try {
      index = JSON.parse(await readFile(indexFile, "utf8"));
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  assert.ok(index, "project index must be written by tool calls");
  assert.equal(index.projects.length, 1, "index must keep one entry per workspace");
  assert.equal(path.resolve(index.projects[0].base), path.join(root, ".zhizhang"));

  await run("zhizhang_panel_snapshot", {});
  const index2 = JSON.parse(await readFile(indexFile, "utf8"));
  assert.equal(index2.projects.length, 1, "repeat tool call must not duplicate the index");

  const projectId = index2.projects[0].id;

  // A second workspace must stay separate: its own root, its own works.
  const ws2 = path.join(root, "ws2");
  const exec2 = { agent: { ctx: agentCtx, session: { id: "smoke-2", header: { cwd: ws2 } } } };
  const out2 = await byName.get("zhizhang_project_create").execute({ title: "第二本", genre: "悬疑" }, exec2);
  assert.match(out2, /已创建作品/);
  const ws2Base = path.join(ws2, ".zhizhang");
  const index3 = JSON.parse(await readFile(indexFile, "utf8"));
  assert.equal(index3.projects.length, 2, "second workspace must be indexed separately");
  const project2 = index3.projects.find((x) => path.resolve(x.base) === ws2Base);
  assert.ok(project2, "second workspace base recorded");

  // —— 2c. shared library root ——
  const sharedLib = path.join(root, "shared-lib");
  const projectLib = await freshStore.ensureStorage(null, { storageRoot: path.join(root, ".zhizhang") });
  assert.equal(projectLib.library, path.join(root, ".zhizhang", "library"), "default library is per-project");
  const sharedPaths = await freshStore.ensureStorage(null, { libraryRoot: sharedLib });
  assert.equal(sharedPaths.library, sharedLib, "libraryRoot overrides the library path");
  assert.ok((await stat(sharedLib)).isDirectory(), "shared library root is created");

  // —— 2d. local book shelf (sourceRoot) ——
  const shelfDir = path.join(root, "shelf");
  await mkdir(shelfDir, { recursive: true });
  await writeFile(path.join(shelfDir, "本地样书.txt"), "第一章 归途。雨停了他才出门。".repeat(20), "utf8");
  await writeFile(path.join(shelfDir, "ignore.pdf"), "x", "utf8");

  const shelfPaths = await freshStore.ensureStorage(null, {
    storageRoot: path.join(root, ".zhizhang"),
    sourceRoot: shelfDir,
  });
  assert.equal(shelfPaths.sourceRoot, shelfDir, "sourceRoot is resolved into paths");
  const shelfBooks = await freshStore.listLocalBooks(shelfDir, {});
  assert.equal(shelfBooks.length, 1, "only .txt/.md books are listed");
  assert.equal(shelfBooks[0].name, "本地样书.txt");

  const { setPluginConfig } = await import(pathToFileURL(path.join(pkgRoot, "dist/tools/index.js")).href);

  // Shared library root: cards/sources live outside the project.
  setPluginConfig({ libraryRoot: sharedLib });
  out = await run("zhizhang_library_import", {
    title: "拆书样本",
    text: "第一章 雨夜。他把伞收进桶里，没说话。".repeat(20),
  });
  assert.match(out, /已导入/);
  assert.ok((await stat(path.join(sharedLib, "index.json"))).isFile(), "library calls must use the shared root");
  let projectLibIndex = null;
  try {
    projectLibIndex = JSON.parse(await readFile(path.join(root, ".zhizhang", "library", "index.json"), "utf8"));
  } catch {
    projectLibIndex = null;
  }
  assert.equal(projectLibIndex?.sources?.length ?? 0, 0, "project library must not receive shared sources");

  // Local shelf: library_list shows the folder, import accepts a bare file name.
  setPluginConfig({ storageRoot: path.join(root, ".zhizhang"), sourceRoot: shelfDir });
  out = await run("zhizhang_library_list", { what: "sources" });
  assert.match(out, /本地书源/, "library_list must show the local shelf");
  assert.ok(out.includes("本地样书.txt"), "library_list must show shelf files");
  assert.match(out, /未导入/);

  out = await run("zhizhang_library_import", { title: "本地样书", file: "本地样书.txt" });
  assert.match(out, /已导入/);
  out = await run("zhizhang_library_list", { what: "sources" });
  assert.ok(out.includes("本地样书.txt") && out.includes("已导入"), "imported shelf book must be marked 已导入");
  setPluginConfig({});

  const twoProjects = await freshStore.listProjects({ refresh: true });
  assert.equal(twoProjects.length, 2);
  const p2 = twoProjects.find((x) => x.id === project2.id);
  assert.equal(p2.worksCount, 1, "second project has its own work");
  const key2 = /key=([^）)]+)/.exec(out2)[1];
  const firstWorks = twoProjects.find((x) => x.id === projectId).works.map((w) => w.key);
  assert.ok(!firstWorks.includes(key2), "first project must not see ws2 works");

  out = await run("zhizhang_outline_set", {
    chapter: "c001",
    title: "第一章 雨夜",
    situationLens: "雨夜收摊，欠债压顶",
    ending: "他把灯关了",
  });
  assert.match(out, /已写入章纲/);

  out = await run("zhizhang_chapter_brief", { chapter: "c001" });
  assert.match(out, /本章处境|内容/);

  const body =
    "雨声砸在铁皮上。他把伞收进桶里，没说话。\n\n" +
    "她抬头看了一眼，把钥匙推过来。".repeat(30);
  out = await run("zhizhang_candidate_stage", { chapter: "c001", content: body, draft_label: "v1" });
  assert.match(out, /候选已暂存/);
  const candId = /cand-[a-z0-9]+/.exec(out)?.[0];
  assert.ok(candId, "candidate_stage must return a cand-… id");

  out = await run("zhizhang_candidate_accept", { candidate: candId });
  assert.match(out, /错误\[lint_required\]/, "accept without lint must be hard-rejected");

  out = await run("zhizhang_style_lint", { candidate: candId });
  assert.match(out, /lintPassToken：lint-/);

  out = await run("zhizhang_candidate_accept", { candidate: candId });
  assert.match(out, /已采纳/);
  const chapterFile = path.join(root, ".zhizhang", "works", workKey, "chapters", "c001.md");
  assert.ok((await stat(chapterFile)).isFile(), "accepted candidate must land in chapters/");

  out = await run("zhizhang_candidate_accept", { candidate: candId });
  assert.match(out, /错误\[candidate_already_accepted\]/, "double accept must be refused");

  // —— 3. resource-id sandbox ——
  out = await run("zhizhang_chapter_read", { chapter: "../../escape" });
  assert.match(out, /错误\[bad_id\]/, "chapter traversal must be rejected");
  out = await run("zhizhang_candidate_stage", { chapter: "../escape", content: "x" });
  assert.match(out, /错误\[bad_id\]/, "candidate stage traversal must be rejected");

  // Chinese ids stay legal (single path segment), traversal does not.
  out = await run("zhizhang_chapter_save", { chapter: "第二章", content: "他把门带上。" });
  assert.match(out, /已保存/);
  out = await run("zhizhang_chapter_read", { chapter: "第二章" });
  assert.match(out, /他把门带上/);

  // Project summaries are derived live from each workspace (works/chapters/words).
  const projects = await freshStore.listProjects({ refresh: true });
  assert.equal(projects.length, 2, "both workspaces are listed");
  const mainProject = projects.find((x) => x.id === projectId);
  assert.equal(mainProject.exists, true);
  assert.equal(mainProject.worksCount, 1, "project summary must list works");
  assert.ok(mainProject.chapters >= 2, "project summary must count chapters");
  assert.ok(mainProject.words > 0, "project summary must count words");

  // —— 4. snapshot + persisted wordCount ——
  const snapRaw = await run("zhizhang_panel_snapshot", { format: "json" });
  const snapJson = JSON.parse(snapRaw);
  assert.equal(snapJson.workKey, workKey);
  assert.ok(snapJson.candidates.some((c) => c.id === candId && c.wordCount > 0), "candidate wordCount");
  const snapBoth = await run("zhizhang_panel_snapshot", {});
  assert.match(snapBoth, /## 面板 HTML/, "panel_snapshot tool still returns HTML by default");

  // —— 5. panel HTTP ——
  const server = http.createServer(
    createPanelApiHandler({
      storageRoot: path.join(root, ".zhizhang"),
      libraryRoot: sharedLib,
      sourceRoot: shelfDir,
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/dsh-zhizhang`;
  try {
    let res = await fetch(`${base}/health`);
    const health = await res.json();
    assert.equal(res.status, 200);
    assert.equal(health.version, pkg.version, "health version must match package.json");
    assert.equal(health.ok, true);

    res = await fetch(`${base}/projects`);
    const proj = await res.json();
    assert.equal(res.status, 200);
    assert.equal(proj.ok, true);
    assert.equal(proj.current, projectId, "current project is the resolved workspace");
    assert.ok(proj.projects.some((p) => p.id === projectId), "resolved workspace must be listed");

    res = await fetch(`${base}/snapshot?work=${encodeURIComponent(workKey)}`);
    const snap = await res.json();
    assert.equal(snap.ok, true);
    assert.equal(snap.projectId, projectId, "snapshot must name its project");
    assert.equal(path.resolve(snap.base), path.join(root, ".zhizhang"));
    assert.ok(snap.snapshot, "snapshot payload present");
    assert.ok(!("html" in snap), "HTML is opt-in by default");

    res = await fetch(`${base}/snapshot?work=${encodeURIComponent(workKey)}&html=1`);
    const withHtml = await res.json();
    assert.match(withHtml.html, /<article|<html|<!DOCTYPE/i, "?html=1 returns the panel HTML");

    // Explicit project selector: only indexed workspaces are readable.
    res = await fetch(`${base}/snapshot?base=${encodeURIComponent(projectId)}&work=${encodeURIComponent(workKey)}`);
    const picked = await res.json();
    assert.equal(picked.ok, true, "indexed ?base= must be readable");
    assert.equal(picked.projectId, projectId);

    res = await fetch(`${base}/projects?refresh=1`);
    const allProjects = await res.json();
    assert.equal(allProjects.projects.length, 2, "/projects must list every indexed workspace");
    assert.equal(allProjects.current, projectId, "current stays the server-configured root");

    res = await fetch(`${base}/snapshot?base=${encodeURIComponent(project2.id)}&work=${encodeURIComponent(key2)}`);
    const other = await res.json();
    assert.equal(other.ok, true, "switching project must read that project's works");
    assert.equal(other.projectId, project2.id);
    assert.equal(path.resolve(other.base), ws2Base);

    res = await fetch(`${base}/snapshot?base=${encodeURIComponent("C:/nope/.zhizhang")}`);
    const rejected = await res.json();
    assert.equal(res.status, 400, "unknown ?base= must be rejected");
    assert.equal(rejected.code, "bad_base");

    res = await fetch(`${base}/library`);
    const lib = await res.json();
    assert.equal(lib.ok, true);
    assert.equal(lib.library.sourcesCount, 1, "panel must read the shared library");
    assert.equal(lib.library.sourceRoot, shelfDir, "panel must expose the local shelf");
    assert.equal(lib.library.pendingCount, 1, "panel lists shelf books missing from this library");
    assert.equal(lib.library.pending[0].name, "本地样书.txt");
    assert.equal(lib.library.pending[0].bytes, shelfBooks[0].bytes);

    res = await fetch(`${base}/chapter?work=${encodeURIComponent(workKey)}&id=c001`);
    const chapter = await res.json();
    assert.equal(chapter.ok, true);
    assert.ok(chapter.body.length > 0);

    res = await fetch(`${base}/candidate?work=${encodeURIComponent(workKey)}&id=${candId}`);
    assert.equal((await res.json()).ok, true);

    res = await fetch(`${base}/candidate?work=${encodeURIComponent(workKey)}&id=${encodeURIComponent("../package")}`);
    const bad = await res.json();
    assert.equal(res.status, 400);
    assert.equal(bad.code, "bad_id");

    res = await fetch(`${base}/candidate/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ work: workKey, candidate: candId }),
    });
    const noConfirm = await res.json();
    assert.equal(res.status, 400);
    assert.equal(noConfirm.code, "confirm_required", "panel accept must require confirm");

    res = await fetch(`${base}/candidate/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ work: workKey, candidate: "../../escape", confirm: true }),
    });
    const badAccept = await res.json();
    assert.equal(res.status, 400);
    assert.equal(badAccept.code, "bad_id");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // —— 2e. visible novels folder (worksRoot) ——
  const novelsDir = path.join(root, "小说项目");
  const worksPaths = await freshStore.ensureStorage(null, {
    storageRoot: path.join(root, ".zhizhang"),
    worksRoot: novelsDir,
  });
  assert.equal(worksPaths.works, novelsDir, "worksRoot overrides the works path");
  assert.equal(path.resolve(worksPaths.base), path.join(root, ".zhizhang"), "base is untouched by worksRoot");

  setPluginConfig({ storageRoot: path.join(root, ".zhizhang"), worksRoot: novelsDir });
  out = await run("zhizhang_project_create", { title: "夜行记", genre: "悬疑" });
  assert.match(out, /已创建作品/);
  const novelDir = path.join(novelsDir, "夜行记");
  assert.ok((await stat(path.join(novelDir, "meta.json"))).isFile(), "novel folder is named by the book title");
  assert.ok((await stat(path.join(novelDir, "chapters"))).isDirectory(), "novel folder holds chapters/");
  setPluginConfig({});

  // The project index must remember the novels folder (panel summaries rely on it).
  let idxWorks = null;
  for (let i = 0; i < 20 && !idxWorks; i++) {
    try {
      const raw = JSON.parse(await readFile(indexFile, "utf8"));
      const hit = raw.projects.find((x) => path.resolve(x.base) === path.join(root, ".zhizhang"));
      if (hit?.works)
        idxWorks = hit.works;
    } catch {
      /* retry */
    }
    if (!idxWorks)
      await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(path.resolve(idxWorks ?? ""), novelsDir, "index records the novels folder");

  // Config paths often use forward slashes; assertInside must normalize them.
  const slashRoot = novelsDir.split(path.sep).join("/");
  const slashPaths = await freshStore.ensureStorage(null, {
    storageRoot: path.join(root, ".zhizhang"),
    worksRoot: slashRoot,
  });
  const slashWork = await freshStore.createWork(slashPaths, { title: "斜杠稿" });
  assert.ok(path.resolve(slashWork.dir).startsWith(path.resolve(novelsDir)), "forward-slash worksRoot must work");

  const listed = await freshStore.listProjects({ refresh: true });
  const rootProject = listed.find((x) => path.resolve(x.base) === path.join(root, ".zhizhang"));
  assert.ok(rootProject, "root project still listed");
  assert.ok(
    rootProject.works.some((w) => w.key === "夜行记"),
    "panel summary reads works from worksRoot",
  );

  console.log(`smoke OK · ${tools.length} tools · chain · gates · sandbox · panel API · projects`);
} finally {
  await rm(root, { recursive: true, force: true });
}
