import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";
import { createFakeClock } from "../support/clock.mjs";

const ROOT = process.cwd();
const desk = await importBundle("test/support/desktop-entry.ts");
const WRITE_VERBS = /(save|write|accept|reject|finalize|deliver|transition|create|delete|decide|propose|apply|edit|update|register|set|bind|import)/i;

async function treeHash(dir) {
  const hash = createHash("sha256");
  async function walk(current) {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else hash.update(`${path.relative(dir, full)}\n`).update(await fs.readFile(full));
    }
  }
  await walk(dir);
  return hash.digest("hex");
}

async function fanqieWork() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "zz-tools-"));
  const root = path.join(base, "长篇");
  await fs.mkdir(root, { recursive: true });
  const clock = createFakeClock();
  const ctx = {
    clock,
    locks: desk.createLockService(clock),
    inside: (p) => path.resolve(p),
    roots: () => ({ fanqie: root, toutiao: path.join(base, "头条"), library: path.join(base, "拆书库") }),
    profiles: { builtin: (m) => path.join(ROOT, "packages", m, "profiles"), userDir: path.join(base, "profiles") },
    workflow: { startAndWait: async () => assert.fail("not used") },
  };
  const run = (command, input) => desk.dispatchWorkbenchCommand({ command, input }, ctx);
  const { workPath } = await run("fanqie.work.create", { root, title: "夜航", premise: "", grade: "economy" });
  await run("fanqie.chapter.save", { work: workPath, chapter: "ch-001", base: "", body: "林川推开门。" });
  const candDir = path.join(workPath, "candidates", "ch-001");
  await fs.mkdir(candDir, { recursive: true });
  await fs.writeFile(path.join(candDir, "c1.md"), "# 夜雨\n\n候选正文。");
  return { base, workPath };
}

function hostRecorder() {
  const calls = { started: [], navigated: [] };
  return {
    calls,
    host: {
      async startPipeline(kind, request) {
        calls.started.push({ kind, request });
        return { runId: `run-${calls.started.length}`, kind };
      },
      navigate(focus) {
        calls.navigated.push(focus);
      },
    },
  };
}

const READ_ARGS = {
  fanqie_list_chapters: {},
  fanqie_work_info: {},
  fanqie_read_chapter: { chapterId: "ch-001" },
  fanqie_bible_view: { position: 1 },
  fanqie_bible_audit: { upTo: 1 },
  fanqie_list_candidates: { chapterId: "ch-001" },
  fanqie_read_candidate: { chapterId: "ch-001", candidateId: "c1" },
  fanqie_read_method: { stage: "fanqie.chapter.draft" },
};

test("助手工具只读或发起：番茄 10–14 个工具，没有任何写正文/写候选/写圣经的工具（AC-50）", async () => {
  const { workPath } = await fanqieWork();
  const tools = desk.fanqieModule.tools("assistant", { mode: "fanqie", path: workPath });
  assert.ok(tools.length >= 10 && tools.length <= 14, `tool count ${tools.length}`);
  const startOrOpen = tools.filter((t) => /_(start|open)_/.test(t.name));
  for (const tool of tools) {
    assert.deepEqual(tool.roles, ["assistant"]);
    if (!/_(start|open)_/.test(tool.name)) assert.doesNotMatch(tool.name, WRITE_VERBS, tool.name);
  }
  assert.ok(startOrOpen.length >= 4);
  assert.deepEqual(desk.fanqieModule.tools("writer", { mode: "fanqie", path: workPath }), []);

  const before = await treeHash(workPath);
  const { host, calls } = hostRecorder();
  const ctx = {
    workspaceRoot: path.dirname(workPath),
    readonly: false,
    profileRoots: { builtinDir: path.join(ROOT, "packages/fanqie/profiles") },
    host,
  };
  for (const [name, args] of Object.entries(READ_ARGS)) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, name);
    const result = await desk.executeTool(tool, args, ctx);
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
  }
  const chapter = await desk.executeTool(tools.find((t) => t.name === "fanqie_read_chapter"), { chapterId: "ch-001" }, ctx);
  assert.equal(chapter.body, "林川推开门。");
  const missing = await desk.executeTool(tools.find((t) => t.name === "fanqie_read_chapter"), { chapterId: "ch-404" }, ctx);
  assert.deepEqual([missing.ok, missing.code], [false, "input.not_found"]);

  const started = await desk.executeTool(tools.find((t) => t.name === "fanqie_start_revise"), { chapterId: "ch-001", note: "结尾改悬疑" }, ctx);
  assert.equal(started.ok, true);
  assert.deepEqual(calls.started[0], { kind: "fanqie.revise", request: { chapterId: "ch-001", note: "结尾改悬疑" } });
  await desk.executeTool(tools.find((t) => t.name === "fanqie_open_compare"), { chapterId: "ch-001", candidateId: "c1" }, ctx);
  assert.deepEqual(calls.navigated[0], { chapter: "ch-001", candidate: "c1", source: "split" });
  assert.equal(await treeHash(workPath), before, "工具执行后作品目录逐字节不变");

  const readonly = await desk.executeTool(
    tools.find((t) => t.name === "fanqie_start_chapter"),
    { chapterId: "ch-002" },
    { ...ctx, readonly: true },
  );
  assert.deepEqual([readonly.ok, readonly.code], [false, "storage.locked"]);
  assert.equal(calls.started.length, 1);
});

test("头条助手工具：读状态/草稿/来源，发起文章流水线时带上文章体裁与主驱动，不改任何文件", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "zz-tt-tools-"));
  const toutiaoRoot = path.join(base, "头条");
  const articleDir = path.join(toutiaoRoot, "tt-1");
  await fs.mkdir(path.join(articleDir, "drafts"), { recursive: true });
  await fs.mkdir(path.join(articleDir, "sources"), { recursive: true });
  await fs.writeFile(
    path.join(articleDir, "meta.json"),
    JSON.stringify({ format: "zhizhang/1.3", id: "tt-1", genre: "短图文", driver: "账本型", status: "初稿待改", rulesVersion: "4.0.0", history: [] }),
  );
  await fs.writeFile(path.join(articleDir, "drafts", "rev-001.md"), "# 标题\n\n正文");
  await fs.writeFile(path.join(articleDir, "sources", "s1.txt"), "来源正文");
  await fs.writeFile(path.join(articleDir, "sources", "s1.json"), JSON.stringify({ id: "s1", kind: "paste" }));

  const tools = desk.toutiaoModule.tools("assistant", { mode: "toutiao", path: articleDir });
  assert.ok(tools.length >= 10 && tools.length <= 14, `tool count ${tools.length}`);
  for (const tool of tools) {
    if (!/_(start|open)_/.test(tool.name)) assert.doesNotMatch(tool.name, WRITE_VERBS, tool.name);
  }
  const before = await treeHash(articleDir);
  const { host, calls } = hostRecorder();
  const ctx = { workspaceRoot: base, readonly: false, profileRoots: { builtinDir: path.join(ROOT, "packages/toutiao/profiles") }, host };
  const byName = (name) => tools.find((t) => t.name === name);
  assert.equal((await desk.executeTool(byName("toutiao_article_status"), {}, ctx)).status, "初稿待改");
  assert.equal((await desk.executeTool(byName("toutiao_read_draft"), {}, ctx)).file, "rev-001.md");
  assert.equal((await desk.executeTool(byName("toutiao_list_sources"), {}, ctx)).sources.length, 1);
  assert.equal((await desk.executeTool(byName("toutiao_read_source"), { sourceId: "s1" }, ctx)).text, "来源正文");
  assert.equal((await desk.executeTool(byName("toutiao_read_card"), {}, ctx)).code, "input.not_found");
  assert.equal((await desk.executeTool(byName("toutiao_read_method"), { stage: "toutiao.article.draft" }, ctx)).ok, true);
  await desk.executeTool(byName("toutiao_start_article"), { note: "更口语" }, ctx);
  assert.deepEqual(calls.started[0], {
    kind: "toutiao.article",
    request: { articleId: "tt-1", genre: "短图文", driver: "账本型", note: "更口语" },
  });
  assert.equal(await treeHash(articleDir), before);
});

test("助手会话：模型请求不存在的写正文工具时只得到错误回执，正文不变；工具调用折叠进回复（AC-50 / AC-N07）", async () => {
  const { base, workPath } = await fanqieWork();
  const clock = createFakeClock();
  const chapterFile = path.join(workPath, "chapters", "ch-001.md");
  const before = await fs.readFile(chapterFile, "utf8");
  const turns = [
    { text: "我先读一下。", toolCalls: [{ id: "t1", name: "fanqie_read_chapter", args: { chapterId: "ch-001" } }] },
    { text: "", toolCalls: [{ id: "t2", name: "fanqie_save_chapter", args: { chapterId: "ch-001", body: "改写" } }] },
    { text: "", toolCalls: [{ id: "t3", name: "fanqie_start_revise", args: { chapterId: "ch-001", note: "结尾改悬疑" } }] },
    { text: "已发起修订流水线，请在流水线面板查看候选稿。", toolCalls: [] },
  ];
  const requests = [];
  const port = {
    async turn(request, _signal, on) {
      requests.push(request);
      const next = turns.shift();
      if (next.text) on({ type: "text_delta", delta: next.text });
      return { text: next.text, toolCalls: next.toolCalls, usage: { input: 10, cachedInput: 0, output: 5 }, cost: null };
    },
  };
  const gateway = desk.createModelGateway(
    { stream: async () => assert.fail("pipeline port not used") },
    { globalConcurrency: 2, perRunConcurrency: 1, roles: {} },
    clock,
  );
  const events = [];
  const started = [];
  const target = { mode: "fanqie", path: workPath };
  const sessions = desk.createSessionManager({
    clock,
    store: desk.createConversationStore(path.join(base, "state", "sessions"), clock),
    gateway: () => gateway,
    port: () => port,
    binding: () => ({ connection: "c1", model: "m1", contextWindow: 64000, maxTokens: 4096 }),
    tools: (t) => desk.fanqieModule.tools("assistant", t),
    toolCtx: () => ({
      workspaceRoot: base,
      readonly: false,
      host: {
        async startPipeline(kind, request) {
          started.push({ kind, request });
          return { runId: "run-42", kind };
        },
        navigate() {},
      },
    }),
    context: () => desk.DEFAULT_SETTINGS.context,
    preferences: () => "对白少用“说道”",
    readonly: () => false,
    title: async () => "夜航",
    emit: (event) => events.push(event),
  });

  await sessions.send(target, { text: "把第 1 章结尾改悬疑", intent: "revise", focus: { chapter: "ch-001" } });
  await sessions.idle(target);

  assert.equal(await fs.readFile(chapterFile, "utf8"), before);
  assert.deepEqual(started, [{ kind: "fanqie.revise", request: { chapterId: "ch-001", note: "结尾改悬疑" } }]);
  assert.ok(requests[0].tools.every((t) => !/save|write/.test(t.name)));
  assert.match(requests[0].system, /对白少用“说道”/);
  assert.match(requests[0].messages[0].text, /【意图：修改】/);
  const toolEnds = events.filter((e) => e.kind === "session" && e.event.type === "tool" && e.event.phase === "end");
  assert.deepEqual(toolEnds.map((e) => [e.event.name, e.event.isError]), [
    ["fanqie_read_chapter", false],
    ["fanqie_save_chapter", true],
    ["fanqie_start_revise", false],
  ]);
  const end = events.filter((e) => e.kind === "session" && e.event.type === "end").at(-1);
  assert.equal(end.event.reason, "done");
  const task = events.filter((e) => e.kind === "session" && e.event.type === "task").at(-1).event.task;
  assert.deepEqual(task.completed, ["fanqie_read_chapter", "fanqie_start_revise"]);

  const view = await sessions.view(target);
  assert.equal(view.messages.length, 2);
  assert.equal(view.messages[1].role, "assistant");
  assert.equal(view.messages[1].tools.length, 3);
  assert.equal(view.messages[1].result.runId, "run-42");
  assert.equal(view.messages[1].result.target.path, workPath);

  const listed = await sessions.list(target);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].current, true);
  const usage = await sessions.usage(target);
  assert.ok(usage.tokens > 0 && usage.window === 64000);

  const restarted = desk.createSessionManager({
    clock,
    store: desk.createConversationStore(path.join(base, "state", "sessions"), clock),
    gateway: () => gateway,
    port: () => port,
    binding: () => ({ connection: "c1", model: "m1", contextWindow: 64000, maxTokens: 4096 }),
    tools: () => [],
    toolCtx: () => ({ workspaceRoot: base, readonly: false }),
    context: () => desk.DEFAULT_SETTINGS.context,
    preferences: () => "",
    readonly: () => false,
    title: async () => undefined,
    emit: () => {},
  });
  const reloaded = await restarted.view(target);
  assert.equal(reloaded.conversationId, view.conversationId);
  assert.equal(reloaded.messages.length, 2);
  const fresh = await restarted.newConversation(target);
  assert.notEqual(fresh.id, view.conversationId);
  assert.equal((await restarted.view(target)).messages.length, 0);
  assert.equal((await restarted.view(target, { conversationId: view.conversationId })).messages.length, 2);
});
