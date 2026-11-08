import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, realpath } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ArticleStore, parseFeedbackEntries } from "../../apps/desktop/out-test/article-store.mjs";
import { fakeModel } from "./fake-model.mjs";
import { Sessions } from "../../apps/desktop/out-test/session.mjs";
import { Settings } from "../../apps/desktop/out-test/settings.mjs";
import { defaultModels } from "../../apps/desktop/out-test/models.mjs";
import { publicAddress, readSource } from "../../apps/desktop/out-test/network.mjs";
import {
  exportContent,
  publicationIssues,
  publishText,
  wordDocument,
} from "../../apps/desktop/out-test/exports.mjs";
import {
  claimWorkspace,
  assertWorkspaceWritable,
  releaseWorkspace,
  releaseWorkspaces,
} from "../../apps/desktop/out-test/lease.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
process.env.WRITER_TOUTIAO_SKILL_DIR = path.join(root, "packages/toutiao/skill");
process.env.WRITER_FANQIE_SKILL_DIR = path.join(root, "packages/fanqie/skill");
process.env.WRITER_TOUTIAO_DEFAULT_DIR = path.join(root, "packages/toutiao/profiles/default");
process.env.WRITER_FANQIE_DEFAULT_DIR = path.join(root, "packages/fanqie/profiles/default");
function settled() {
  let finish;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("任务未在 15 秒内结束")), 15000);
    finish = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  return { promise, finish };
}
function models(url) {
  const value = defaultModels();
  value.planner = { ...value.writer };
  for (const [role, model] of Object.entries(value))
    if (model)
      Object.assign(model, {
        provider: "fixture",
        baseUrl: url,
        apiKey: "fixture-key",
        model: "mock-" + role,
        reasoning: false,
        thinkingLevel: "off",
      });
  return value;
}

test("真实 Pi：建书归属、候选定位、独立编辑、角色模型、作者确认、通知落盘与新对话交接", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-desktop-")),
    home = path.join(base, "app"),
    data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.WRITER_STATE_ROOT = home;
  const model = await fakeModel({
    "mock-writer": [
      {
        name: "writer_plan",
        input: { task: "创建题名为长夜车站、目录 station 的作品，不写正文。" },
      },
      {
        name: "fanqie_outline_set",
        input: {
          chapter: "c001",
          title: "站台",
          pov: "林川",
          targetWords: 2000,
          locks: "车站停电",
          knowledge: "他不知道来电者身份",
          synopsis: "林川等车",
          conflict: "末班车不停站",
          beats: "广播来电",
          ending: "门打开",
        },
      },
      {
        name: "fanqie_chapter_save",
        input: {
          chapter: "c001",
          content:
            "林川把票递到窗口。售票员没接，先看了眼墙上的钟。\n\n“末班车不停这一站。”她说。门外却传来了刹车声。",
          status: "drafted",
        },
      },
      {
        name: "fanqie_candidate_stage",
        input: { chapter: "c001", content: "候选一：林川走到窗边。" },
      },
      {
        name: "fanqie_candidate_stage",
        input: { chapter: "c001", content: "候选二：她拉开了门。" },
      },
      {
        name: "writer_review",
        input: {
          work: "station",
          chapter: "c001",
          task: "只审读本章并记录回报。",
        },
      },
      {
        name: "fanqie_chapter_save",
        input: { work: "station", chapter: "c001", status: "final" },
      },
      { text: "请作者查看审读回报，当前仍是草稿。" },
      { text: "已收到交接，按当前正文继续写作。" },
      { status: 401, error: "Unauthorized" },
    ],
    "mock-planner": [
      {
        name: "fanqie_project_create",
        input: { title: "长夜车站", key: "station" },
      },
      { text: "作品已创建。" },
    ],
    "mock-editor": [
      {
        name: "fanqie_chapter_read",
        input: { work: "station", chapter: "c001" },
      },
      {
        name: "fanqie_review_report",
        input: {
          work: "station",
          chapter: "c001",
          verdict: "通过",
          hard_issues: [],
          levels: [],
          reread_full: true,
          changed_scope: "未改",
          strengths: "动作清楚。",
        },
      },
      { text: "本章回报已记录。" },
    ],
  });
  const done = settled(),
    events = [],
    asks = [];
  let attached,
    onSettled = done.finish;
  const sessions = new Sessions({
    home: home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      events.push(event);
      if (event.event?.type === "agent_settled" && !event.editor) onSettled();
    },
    confirm: async (message) => {
      asks.push(message);
      return false;
    },
    options: {},
    created: async (previous, next) => {
      attached = { previous, next };
    },
    extras: {},
  });
  try {
    await sessions.send(
      { mode: "fanqie", root: data },
      "MAIN-PRIVATE：按要求创建测试作品与草稿，然后派编辑，最后请求作者定稿。",
      { intent: "plan" },
    );
    await done.promise;
    assert.equal(attached.next.work, "station");
    assert.equal(asks.length, 1);
    const planning = events.find(
      (event) =>
        event.event?.type === "tool_execution_end" && event.event.toolName === "writer_plan",
    )?.event.result.details.writerResult;
    assert.equal(planning.status, "saved");
    assert.ok(planning.saved.some((item) => item.tool === "fanqie_project_create"));
    const candidates = events
      .filter(
        (event) =>
          event.event?.type === "tool_execution_end" &&
          event.event.toolName === "fanqie_candidate_stage",
      )
      .map((event) => event.event.result);
    assert.equal(candidates.length, 2);
    assert.notEqual(
      candidates[0].details.writerResult.focus.candidate,
      candidates[1].details.writerResult.focus.candidate,
    );
    for (const result of candidates) {
      const card = result.details.writerResult;
      assert.equal(card.target.work, "station");
      assert.equal(card.target.root, data);
      assert.equal(card.focus.chapter, "c001");
      assert.equal(card.focus.source, "candidate");
      assert.ok(card.focus.candidate && result.content[0].text.includes(card.focus.candidate));
    }
    const writer = model.calls.find((call) => call.model === "mock-writer"),
      editor = model.calls.find((call) => call.model === "mock-editor");
    assert.ok(writer && editor);
    for (const call of [writer, editor]) {
      const names = call.tools.map((tool) => tool.function.name);
      for (const name of [
        "fanqie_foreshadow_set",
        "fanqie_knowledge_set",
        "fanqie_continuity_commit",
        "fanqie_candidate_unify_brief",
        "fanqie_candidate_unify_stage",
      ])
        assert.ok(!names.includes(name), `关闭的功能不暴露给模型：${name}`);
    }
    assert.ok(model.calls.some((call) => call.model === "mock-planner"));
    const planner = model.calls.find((call) => call.model === "mock-planner");
    assert.ok(!planner.tools.some((tool) => tool.function.name === "fanqie_chapter_save"));
    assert.ok(editor.tools.some((tool) => tool.function.name === "fanqie_foundation_get"));
    assert.ok(!editor.tools.some((tool) => tool.function.name === "fanqie_library_card_stage"));
    assert.ok(!JSON.stringify(editor.messages).includes("MAIN-PRIVATE"));
    assert.ok(
      editor.messages.some((m) =>
        (typeof m.content === "string"
          ? m.content
          : (m.content || []).map((part) => part.text || "").join("\n")
        ).includes('"intent":"review"'),
      ),
    );
    assert.ok(!editor.tools.some((tool) => tool.function.name === "fanqie_chapter_save"));
    // 编辑常驻（默认版）带读者标尺段（T15）
    assert.ok(JSON.stringify(editor.messages).includes("回报末尾可选附读者标尺表"));
    assert.ok(JSON.stringify(editor.messages).includes("追读意愿"));
    const chapter = await readFile(path.join(data, "works/station/chapters/c001.md"), "utf8");
    assert.ok(!chapter.includes("status: final"));
    assert.match(chapter, /站台/);
    assert.ok(
      !model.calls
        .flatMap((call) => call.messages || [])
        .some(
          (message) =>
            message.role === "tool" && String(message.content).includes("Validation failed"),
        ),
    );
    assert.ok(
      events.some(
        (event) =>
          event.event?.type === "tool_execution_end" &&
          event.event.toolName === "writer_review" &&
          event.event.result.details.writerResult.summary.includes("通过"),
      ),
    );
    await sessions.notify(attached.next, {
      operation: "/chapter/review",
      chapter: "c001",
      status: "drafted",
    });
    const before = await sessions.view(attached.next);
    assert.ok(before.messages.some((message) => message.customType === "writer-author"));
    const live = await sessions.open(attached.next);
    live.sessionManager.appendCustomMessageEntry("hidden", "not displayed", false);
    live.sessionManager.appendCustomMessageEntry("hidden", "also hidden", false);
    const tail = await sessions.view(attached.next, 2);
    assert.equal(tail.total, before.total);
    assert.deepEqual(
      tail.messages.map((item) => item.writerMessageId),
      before.messages.slice(-2).map((item) => item.writerMessageId),
    );
    await sessions.newConversation(attached.next);
    assert.equal((await sessions.view(attached.next)).messages.length, 0);
    const conversations = await sessions.conversations(attached.next);
    assert.equal(conversations.length, 1);
    assert.ok((await sessions.view(attached.next, 80, 0)).messages.length > 0);
    const handoff = settled();
    onSettled = handoff.finish;
    await sessions.send(attached.next, "交接本章，按当前正文继续写作。", {
      chapter: "c001",
      intent: "write",
    });
    await handoff.promise;
    const handoffCall = model.calls.filter((call) => call.model === "mock-writer").at(-1);
    assert.ok(handoffCall);
    const handoffText = handoffCall.messages
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : (message.content || []).map((part) => part.text || "").join("\n"),
      )
      .join("\n");
    assert.match(handoffText, /briefRecorded/);
    assert.ok(!handoffText.includes("MAIN-PRIVATE"));
    const failure = settled();
    onSettled = failure.finish;
    await sessions.send(attached.next, "检查连接错误的反馈", {
      intent: "inspect",
    });
    await failure.promise;
    assert.ok(events.some((event) => /认证失败/.test(event.error || "")));
  } finally {
    await sessions.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("T15 编辑常驻（creationFirst 版）同样带读者标尺段", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-editor-ruler-")),
    home = path.join(base, "app"),
    data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.WRITER_STATE_ROOT = home;
  const model = await fakeModel({
    "mock-writer": [
      {
        name: "writer_plan",
        input: { task: "创建题名为长夜车站、目录 station 的作品，不写正文。" },
      },
      {
        name: "fanqie_outline_set",
        input: {
          chapter: "c001",
          title: "站台",
          pov: "林川",
          targetWords: 2000,
          locks: "车站停电",
          knowledge: "他不知道来电者身份",
          synopsis: "林川等车",
          conflict: "末班车不停站",
          beats: "广播来电",
          ending: "门打开",
        },
      },
      {
        name: "fanqie_chapter_save",
        input: {
          chapter: "c001",
          content: "林川把票递到窗口。售票员没接，先看了眼墙上的钟。",
          status: "drafted",
        },
      },
      {
        name: "writer_review",
        input: { work: "station", chapter: "c001", task: "只审读本章并记录回报。" },
      },
      { text: "编辑已回报。" },
    ],
    "mock-planner": [
      { name: "fanqie_project_create", input: { title: "长夜车站", key: "station" } },
      { text: "作品已创建。" },
    ],
    "mock-editor": [
      { name: "fanqie_chapter_read", input: { work: "station", chapter: "c001" } },
      {
        name: "fanqie_review_report",
        input: {
          work: "station",
          chapter: "c001",
          verdict: "通过",
          hard_issues: [],
          levels: [],
          reread_full: true,
          changed_scope: "未改",
        },
      },
      { text: "本章回报已记录。" },
    ],
  });
  const done = settled();
  let onSettled = done.finish;
  const sessions = new Sessions({
    home: home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      if (event.event?.type === "agent_settled" && !event.editor) onSettled();
    },
    confirm: async () => false,
    options: { fanqie: { brief: { creationFirst: true } } },
    created: async () => {},
    extras: {},
  });
  try {
    await sessions.send(
      { mode: "fanqie", root: data },
      "MAIN-PRIVATE：按要求创建测试作品与草稿，然后派编辑。",
      { intent: "plan" },
    );
    await done.promise;
    const editor = model.calls.find((call) => call.model === "mock-editor");
    assert.ok(editor, "编辑子会话未运行");
    // creationFirst 版与默认版共用 FANQIE_EDITOR_BODY；两版都要带读者标尺段（T15）
    assert.ok(JSON.stringify(editor.messages).includes("回报末尾可选附读者标尺表"));
    assert.ok(JSON.stringify(editor.messages).includes("兑现在场"));
  } finally {
    await sessions.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("来源读取拒绝内网与保留地址；普通公网地址可识别", async () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700::1111"), true);
  await assert.rejects(readSource("http://127.0.0.1/"), /内网|保留/);
});

test("安全存储不可用不落盘明文 Key，损坏配置仍可恢复默认", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-settings-"));
  const store = new Settings(home, {
    available: () => false,
    encrypt: () => {
      throw new Error("不应加密");
    },
    decrypt: () => {
      throw new Error("无法解密");
    },
  });
  try {
    await writeFile(path.join(home, "model.json"), "broken");
    await store.load();
    assert.ok(store.notices.length);
    for (const content of ["null", "[]"]) {
      for (const file of ["desktop.json", "model.json", "search.json", "writer.json"])
        await writeFile(path.join(home, file), content);
      const restored = new Settings(home, {
        available: () => false,
        encrypt: (text) => text,
        decrypt: (text) => text,
      });
      await restored.load();
      assert.deepEqual(await restored.readObject("writer.json"), {});
      assert.equal(restored.notices.length, 4);
      assert.equal(restored.workspace, "");
    }
    const value = defaultModels();
    value.writer.apiKey = "do-not-persist";
    await store.saveModels(value);
    assert.ok(!(await readFile(path.join(home, "model.json"), "utf8")).includes("do-not-persist"));
    assert.equal(store.models.writer.apiKey, "do-not-persist");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("作品租约：另一进程持有时只读；进程结束后可重新取得", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "writer-lease-"));
  const moduleURL = new URL("../../apps/desktop/out-test/lease.mjs", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {claimWorkspace,setWorkspaceHost} from ${JSON.stringify(moduleURL)};setWorkspaceHost('DSH');await claimWorkspace(${JSON.stringify(folder)});console.log('READY');process.stdin.resume();`,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
    });
    await assert.rejects(assertWorkspaceWritable(folder), /只读/);
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    assert.equal((await claimWorkspace(folder)).readOnly, false);
    const alias = folder + "-alias";
    try {
      await symlink(folder, alias, process.platform === "win32" ? "junction" : "dir");
      await releaseWorkspace(alias);
      await assert.rejects(readFile(path.join(folder, ".writer-workspace-lock.json")), {
        code: "ENOENT",
      });
      assert.equal((await claimWorkspace(alias)).readOnly, false);
      await releaseWorkspace(alias);
    } finally {
      await rm(alias, { force: true });
    }
  } finally {
    child.kill();
    await releaseWorkspaces();
    await rm(folder, { recursive: true, force: true });
  }
});

test("发布检查保留正文、清理标题标记，DOCX 可输出", async () => {
  assert.equal(publishText("# 标题\n\n**正文**\n<!--批注-->"), "标题\n\n正文");
  assert.ok(publicationIssues("尚有[待补事实]").length);
  const data = await wordDocument("标题", "正文");
  assert.equal(data[0], 0x50);
  assert.equal(data[1], 0x4b);
  const base = await mkdtemp(path.join(tmpdir(), "writer-export-")),
    home = path.join(base, "home"),
    folder = path.join(base, "toutiao");
  await mkdir(home);
  await mkdir(folder);
  process.env.WRITER_STATE_ROOT = home;
  await writeFile(path.join(home, "writer-toutiao-roots.json"), JSON.stringify([folder]));
  const store = new ArticleStore(folder);
  try {
    const story = await readFile(
        path.join(root, "packages/toutiao/skill/tests/fixtures/story_long_good.md"),
        "utf8",
      ),
      title = story.split("\n")[0].slice(2);
    const article = await store.create("export", { titleHint: title });
    await store.stageDraft(
      article.id,
      story.replace(/\n/g, "\r\n") + "\r\n" + "正文".repeat(110000) + "唯一尾标",
      "writer",
      "导出校验",
    );
    const result = await exportContent(
      { mode: "toutiao", root: folder },
      { article: article.id },
      {},
    );
    assert.equal(result.text.split("\n").filter((line) => line === title).length, 1);
    assert.ok(!result.text.includes("【配图："));
    assert.ok(!result.text.includes("已截断"));
    assert.ok(result.text.endsWith("唯一尾标"));
    assert.deepEqual(result.issues, ["当前稿件尚未通过有效质检"]);
  } finally {
    await releaseWorkspaces();
    await rm(base, { recursive: true, force: true });
  }
});

test("子任务在准备或 SDK 接收期间取消，不交付成功结果", async () => {
  const { promptWithSignal } = await import("../../apps/desktop/out-test/pi.mjs");
  const controller = new AbortController();
  let release,
    calls = 0;
  const prepared = new Promise((resolve) => {
    release = resolve;
  });
  const session = {
    abort: async () => {},
    prompt: async () => {
      calls++;
    },
  };
  const pending = promptWithSignal(session, () => prepared, controller.signal);
  controller.abort();
  release("不应启动");
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 0);

  const starting = new AbortController();
  let active = false,
    stopped = false;
  const delayed = {
    abort: async () => {
      if (active) stopped = true;
    },
    prompt: async (_text, options) => {
      starting.abort(); // SDK input/auth can await before the run exists.
      await Promise.resolve();
      active = true;
      options.preflightResult("started");
      assert.equal(stopped, true, "必须在首个模型请求前重新传递停止");
    },
  };
  await assert.rejects(
    promptWithSignal(delayed, async () => "任务", starting.signal),
    { name: "AbortError" },
  );
});

test("停止任务同时取消父会话与子角色会话", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-cancel-tree-"));
  const sessions = new Sessions({
    home: home,
    python: "python3",
    settings: defaultModels,
    emit: () => {},
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {},
  });
  const order = [];
  const child = {
    abort: async () => {
      order.push("child");
    },
  };
  const parent = {
    clearQueue() {},
    abort: async () => {
      order.push("parent");
    },
    isIdle: true,
  };
  const target = { mode: "fanqie", root: home };
  sessions.sessions.set(sessions.key(target), {
    session: parent,
    target,
    focus: {},
    phase: "",
    task: {},
  });
  sessions.children.set(parent, child);
  try {
    await sessions.stop(target);
    assert.deepEqual(order.sort(), ["child", "parent"]);
    assert.equal(sessions.generations.get(sessions.key(target)), 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("停止任务：文章创建后会话键已迁移，按根目标停止仍然命中", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-cancel-rekey-"));
  const sessions = new Sessions({
    home: home,
    python: "python3",
    settings: defaultModels,
    emit: () => {},
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {},
  });
  const aborted = [];
  const parent = {
    clearQueue() {},
    abort: async () => {
      aborted.push("parent");
    },
    isIdle: true,
    sessionManager: { getSessionFile: () => path.join(home, "pointer.jsonl") },
  };
  const target = { mode: "toutiao", root: home };
  const entry = {
    session: parent,
    target,
    focus: {},
    phase: "",
    methods: new Map(),
    task: {},
  };
  const rootKey = sessions.key(target);
  sessions.sessions.set(rootKey, entry);
  await sessions.attachCreated(entry, "2026-11-07-example");
  // attachCreated 会原地改写 entry.target：调用方持有的是旧根目标时（send 复制 target），停止必须仍命中
  assert.equal(sessions.sessions.has(rootKey), false, "条目应已迁到文章键");
  try {
    await sessions.stop({ mode: "toutiao", root: home });
    assert.deepEqual(aborted, ["parent"], "根目标停止必须命中迁移后的会话");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("模型等待中停止：2 秒内收尾且取消后不再请求模型", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-cancel-model-"));
  const home = path.join(base, "app");
  const data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.WRITER_STATE_ROOT = home;
  const model = await fakeModel({ "mock-writer": [{ wait: true }] });
  const sessions = new Sessions({
    home: home,
    python: "python3",
    settings: () => models(model.url),
    emit: () => {},
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {},
  });
  try {
    const target = { mode: "fanqie", root: data };
    const pending = sessions.send(target, "等待模型响应后停止。", {});
    const deadline = Date.now() + 10000;
    while (!model.calls.length && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(model.calls.length >= 1, "模型请求未发出");
    const started = Date.now();
    await sessions.stop(target);
    const settled = await Promise.race([
      pending.then(
        () => "resolved",
        (error) => error?.name || "rejected",
      ),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 2000)),
    ]);
    assert.notEqual(settled, "timeout", "停止后任务未在 2 秒内收尾");
    assert.ok(Date.now() - started < 2000, "停止耗时超过 2 秒");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(model.calls.length, 1, "取消后不应再请求模型");
    const entry = sessions.sessions.get(sessions.key(target));
    assert.ok(!entry || entry.session.isIdle, "取消后会话仍在运行");
  } finally {
    await sessions.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("首轮审读交接允许无旧回报，恢复须先备份并拒绝锁和冲突", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-recovery-"));
  const { ensureStorage, createWork, setOutline } =
    await import("../../apps/desktop/out-test/work-store.mjs");
  const { inspectRecovery, recoverWork } = await import("../../apps/desktop/out-test/recovery.mjs");
  const appHome = path.join(base, "app");
  await mkdir(appHome);
  process.env.WRITER_STATE_ROOT = appHome;
  const paths = await ensureStorage(null, { storageRoot: path.join(base, "data") });
  const work = await createWork(paths, { title: "恢复前" });
  await setOutline(work.dir, "c001", { synopsis: "站台" }, "第一章");
  const model = await fakeModel({ "mock-writer": [{ text: "收到交接，开始审读。" }] });
  let onSettled = () => {};
  const sessions = new Sessions({
    home: appHome,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      if (event.event?.type === "agent_settled" && !event.editor) onSettled();
    },
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {},
  });
  try {
    const handoff = settled();
    onSettled = handoff.finish;
    await sessions.send(
      { mode: "fanqie", root: paths.base, work: work.meta.key },
      "交接审读第一章。",
      { chapter: "c001", intent: "review" },
    );
    await handoff.promise;
    const handoffCall = model.calls.filter((call) => call.model === "mock-writer").at(-1);
    assert.ok(handoffCall);
    const handoffText = handoffCall.messages
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : (message.content || []).map((part) => part.text || "").join("\n"),
      )
      .join("\n");
    assert.match(handoffText, /尚无本章的审读回报/);
    assert.match(handoffText, /revision/);
    const metaFile = path.join(work.dir, "meta.json"),
      chapterFile = path.join(work.dir, "chapters/c001.md");
    const oldMeta = await readFile(metaFile, "utf8"),
      oldChapter = await readFile(chapterFile, "utf8");
    const hash = (text) => createHash("sha256").update(text).digest("hex");
    const nextMeta = JSON.stringify({ ...JSON.parse(oldMeta), title: "恢复后" });
    const journal = {
      version: 1,
      id: randomUUID(),
      owner: { pid: process.pid, host: hostname() },
      createdAt: new Date().toISOString(),
      chapterId: "c001",
      writes: [
        {
          file: "chapters/c001.md",
          before: hash(oldChapter),
          after: hash(oldChapter),
          content: oldChapter,
        },
        { file: "meta.json", before: hash(oldMeta), after: hash(nextMeta), content: nextMeta },
      ],
    };
    await writeFile(path.join(work.dir, ".writer-chapter-pending.json"), JSON.stringify(journal));
    const expected = await inspectRecovery(work.dir);
    assert.equal(expected.canRecover, true);
    const noLock = async () => assert.fail("没有遗留写入锁时不应清锁");
    await assert.rejects(
      recoverWork(work.dir, expected, {
        backup: async () => {
          throw new Error("备份失败");
        },
        lockCleared: noLock,
      }),
      /备份失败/,
    );
    assert.equal(await readFile(metaFile, "utf8"), oldMeta);
    // 没有所有者记录的锁无法判断原进程状态：只提示核对，不提供清理。
    await mkdir(path.join(work.dir, ".writer-write-lock"));
    const unknownLock = await inspectRecovery(work.dir);
    assert.equal(unknownLock.canRecover, false);
    assert.match(unknownLock.reason, /写入锁/);
    await rm(path.join(work.dir, ".writer-write-lock"), { recursive: true });
    await writeFile(metaFile, "作者改稿");
    assert.equal((await inspectRecovery(work.dir)).canRecover, false);
    await writeFile(metaFile, oldMeta);
    const run = promisify(execFile),
      backup = path.join(base, "backup");
    await recoverWork(work.dir, expected, {
      lockCleared: noLock,
      backup: async () => {
        await run(process.execPath, [
          path.join(root, "scripts/backup.mjs"),
          "--source",
          work.dir,
          "--output",
          backup,
        ]);
        await run(process.execPath, [path.join(root, "scripts/backup.mjs"), "--verify", backup]);
        return backup;
      },
    });
    assert.equal(JSON.parse(await readFile(metaFile, "utf8")).title, "恢复后");
    assert.equal((await inspectRecovery(work.dir)).canRecover, false);
    await assert.rejects(
      recoverWork(work.dir, expected, { backup: async () => backup, lockCleared: noLock }),
      /没有待恢复/,
    );
  } finally {
    await sessions.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

/** 子进程在写锁内执行 during，然后被 SIGKILL：模拟持锁写入时应用崩溃，锁和 journal 原样遗留。 */
async function crashInsideWriteLock(dir, during) {
  const lockURL = pathToFileURL(
    path.join(root, "build/fanqie/src/engine/storage/process-lock.js"),
  ).href;
  const journalURL = pathToFileURL(
    path.join(root, "build/fanqie/src/engine/storage/chapter-journal.js"),
  ).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {withResourceLock} from ${JSON.stringify(lockURL)};
import {createChapterJournal} from ${JSON.stringify(journalURL)};
const dir = ${JSON.stringify(dir)}, input = ${JSON.stringify(during ?? null)};
await withResourceLock(dir, async () => {
  if (input) await createChapterJournal(dir, input);
  console.log("READY");
  await new Promise(() => {});
});`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("exit", (code) => reject(new Error(`子进程提前退出 ${code}：${stderr}`)));
  });
  child.removeAllListeners("exit");
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await exited;
}

test("FQ-03 崩溃遗留写锁：作者确认后经恢复入口先清锁、再备份并完成原操作", async () => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "writer-stale-lock-")));
  const { ensureStorage, createWork, setOutline } =
    await import("../../apps/desktop/out-test/work-store.mjs");
  const { inspectRecovery } = await import("../../apps/desktop/out-test/recovery.mjs");
  const { Runtime, registerBackupIpc, dialog, ipcMain } =
    await import("../../apps/desktop/out-test/runtime-effects.mjs");
  const appHome = path.join(base, "app"),
    resources = path.join(base, "resources"),
    backups = path.join(base, "backups");
  await mkdir(appHome);
  await mkdir(path.join(resources, "scripts"), { recursive: true });
  await mkdir(backups);
  await writeFile(
    path.join(resources, "scripts/writer-backup.mjs"),
    await readFile(path.join(root, "scripts/backup.mjs")),
  );
  process.env.WRITER_STATE_ROOT = appHome;
  const paths = await ensureStorage(null, { storageRoot: path.join(base, "data") });
  const work = await createWork(paths, { title: "崩溃前" });
  await setOutline(work.dir, "c001", { synopsis: "站台" }, "第一章");
  const state = new Runtime(),
    diagnostics = [],
    prompts = [];
  state.home = appHome;
  state.resources = resources;
  state.target = { mode: "fanqie", root: paths.base, work: work.meta.key };
  state.diagnostics = { write: async (event, fields) => diagnostics.push({ event, ...fields }) };
  state.window = { isDestroyed: () => false, webContents: { send: () => {} } };
  state.sessions = new Sessions({
    home: appHome,
    python: "python3",
    settings: defaultModels,
    emit: () => {},
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {},
  });
  let answer = 0;
  dialog.showMessageBox = async (_window, options) => {
    prompts.push(options.message);
    return { response: answer };
  };
  // 备份目录名精确到秒；两次恢复可能落在同一秒，每次给一个新的保存位置。
  let backupCount = 0;
  dialog.showOpenDialog = async () => {
    const parent = path.join(backups, String(++backupCount));
    await mkdir(parent);
    return { canceled: false, filePaths: [parent] };
  };
  registerBackupIpc(state);
  const recover = ipcMain.handlers.get("writer:recover");
  const lockDir = path.join(work.dir, ".writer-write-lock");
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  try {
    const metaFile = path.join(work.dir, "meta.json"),
      chapterFile = path.join(work.dir, "chapters/c001.md");
    const oldMeta = await readFile(metaFile, "utf8"),
      oldChapter = await readFile(chapterFile, "utf8");
    const nextChapter = oldChapter + "\n站台上的雨停了。\n",
      nextMeta = JSON.stringify({ ...JSON.parse(oldMeta), title: "崩溃后" });
    await crashInsideWriteLock(work.dir, {
      chapterId: "c001",
      writes: [
        { file: "chapters/c001.md", before: hash(oldChapter), content: nextChapter },
        { file: "meta.json", before: hash(oldMeta), content: nextMeta },
      ],
    });
    const check = await inspectRecovery(work.dir);
    assert.equal(check.canRecover, true, check.reason);
    assert.equal(check.staleLock, true);
    assert.match(check.reason, /遗留写入锁/);
    // 作者取消：锁和记录原样保留。
    assert.equal(await recover({}, { id: check.id, fingerprint: check.fingerprint }), null);
    assert.match(prompts.at(-1), /先清理写锁，再备份/);
    assert.ok((await readFile(path.join(lockDir, "owner.json"), "utf8")).length > 0);
    answer = 1;
    const result = await recover({}, { id: check.id, fingerprint: check.fingerprint });
    await assert.rejects(readFile(path.join(lockDir, "owner.json")), { code: "ENOENT" });
    assert.ok(result.file.startsWith(backups));
    assert.ok(diagnostics.some((entry) => entry.event === "write_lock_cleared"));
    assert.ok(diagnostics.some((entry) => entry.event === "backup_completed"));
    assert.equal(
      diagnostics.findIndex((entry) => entry.event === "write_lock_cleared") <
        diagnostics.findIndex((entry) => entry.event === "backup_completed"),
      true,
    );
    assert.equal(await readFile(chapterFile, "utf8"), nextChapter);
    assert.equal(await readFile(metaFile, "utf8"), nextMeta);
    assert.equal((await inspectRecovery(work.dir)).canRecover, false);

    // 崩溃发生在写下恢复记录之前：只有遗留写锁，同样经确认清理并备份。
    await crashInsideWriteLock(work.dir);
    const lockOnly = await inspectRecovery(work.dir);
    assert.equal(lockOnly.canRecover, true, lockOnly.reason);
    assert.equal(lockOnly.kind, "lock");
    await recover({}, { id: lockOnly.id, fingerprint: lockOnly.fingerprint });
    assert.match(prompts.at(-1), /清理《.+》的遗留写入锁/);
    await assert.rejects(readFile(path.join(lockDir, "owner.json")), { code: "ENOENT" });
    assert.equal(diagnostics.filter((entry) => entry.event === "write_lock_cleared").length, 2);
    assert.equal((await inspectRecovery(work.dir)).reason, "没有待恢复的写入。");
  } finally {
    delete dialog.showMessageBox;
    delete dialog.showOpenDialog;
    await state.sessions.dispose();
    await rm(base, { recursive: true, force: true });
  }
});

test("CORE-08 只读作品可经接管入口取得写权限，锁已换人时拒绝", async () => {
  // 接管登记在主进程那份模块实例里，认领与释放必须用同一实例。
  const { Runtime, registerWorkspaceIpc, ipcMain, claimWorkspace, releaseWorkspace } =
    await import("../../apps/desktop/out-test/runtime-effects.mjs");
  const home = await realpath(await mkdtemp(path.join(tmpdir(), "writer-takeover-")));
  const folder = path.join(home, "articles");
  await mkdir(folder);
  const foreign = {
    id: "other-owner",
    pid: 4242,
    machine: "other-host",
    host: "DSH",
    at: "2026-11-01T08:00:00.000Z",
  };
  await writeFile(path.join(folder, ".writer-workspace-lock.json"), JSON.stringify(foreign));
  const state = new Runtime(),
    events = [],
    diagnostics = [];
  state.home = home;
  state.settings = new Settings(home, {
    available: () => false,
    encrypt: (text) => text,
    decrypt: (text) => text,
  });
  state.diagnostics = { write: async (event, fields) => diagnostics.push({ event, ...fields }) };
  state.window = {
    isDestroyed: () => false,
    webContents: { send: (_, event) => events.push(event) },
  };
  state.target = { mode: "toutiao", root: folder };
  state.access = await claimWorkspace(folder);
  registerWorkspaceIpc(state);
  const read = ipcMain.handlers.get("writer:state");
  const takeOver = ipcMain.handlers.get("writer:take-over-workspace");
  try {
    const before = await read({});
    assert.equal(before.access.readOnly, true);
    assert.deepEqual(before.access.owner, foreign);
    await assert.rejects(assertWorkspaceWritable(folder), /只读/);
    await assert.rejects(takeOver({}, "stale-id"), (error) => error.code === "CONFLICT");
    assert.equal((await read({})).access.readOnly, true);
    await assert.rejects(async () => takeOver({}, 42), /参数无效/);
    const access = await takeOver({}, foreign.id);
    assert.equal(access.readOnly, false);
    assert.equal(access.owner.pid, process.pid);
    assert.equal((await read({})).access.readOnly, false);
    await assertWorkspaceWritable(folder);
    assert.ok(events.some((event) => event.refresh));
    const logged = diagnostics.find((entry) => entry.event === "workspace_taken_over");
    assert.equal(logged.previousMachine, "other-host");
  } finally {
    await releaseWorkspace(folder);
    await rm(home, { recursive: true, force: true });
  }
});

test("连续作品切换及持久化失败保留目标与租约一致", async () => {
  const { selectTarget } = await import("../../apps/desktop/out-test/targets.mjs");
  const { access } = await import("node:fs/promises");
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "writer-select-")));
  const roots = ["a", "b", "c"].map((name) => path.join(base, name));
  await Promise.all(roots.map((root) => mkdir(root)));
  const state = {
    home: base,
    writerConfig: {},
    sessions: new Sessions({
      home: base,
      python: "python3",
      settings: defaultModels,
      emit: () => {},
      confirm: async () => false,
      options: {},
      created: async () => {},
      extras: {},
    }),
  };
  try {
    await Promise.all(
      roots.slice(0, 2).map((root) => selectTarget(state, { mode: "toutiao", root })),
    );
    assert.equal(state.target.root, roots[1]);
    assert.equal(state.access.readOnly, false);
    await assert.rejects(access(path.join(roots[0], ".writer-workspace-lock.json")));
    const owner = state.access.owner.id;
    await rm(path.join(base, "target.json"));
    await mkdir(path.join(base, "target.json"));
    await assert.rejects(selectTarget(state, { mode: "toutiao", root: roots[2] }));
    assert.equal(state.target.root, roots[1]);
    assert.equal(state.access.owner.id, owner);
    await assert.rejects(access(path.join(roots[2], ".writer-workspace-lock.json")));
  } finally {
    const { releaseWorkspaces } = await import("../../apps/desktop/out-test/targets.mjs");
    // Each compiled entry owns its lease registry; release through the target module.
    await releaseWorkspaces();
    await rm(base, { recursive: true, force: true });
  }
});

test("PI 作用范围、目录别名及显式内核配置", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-scope-"));
  process.env.WRITER_STATE_ROOT = path.join(base, "home");
  const data = path.join(base, "project");
  await mkdir(path.join(data, ".pi"), { recursive: true });
  await writeFile(path.join(data, "AGENTS.md"), "AMBIENT_096_MUST_NOT_ENTER");
  await writeFile(path.join(data, ".pi/settings.json"), '{"compaction":{"enabled":false}}');
  const model = await fakeModel();
  const host = new Sessions({
    home: process.env.WRITER_STATE_ROOT,
    python: "python3",
    settings: () => models(model.url),
    emit: () => {},
    confirm: async () => true,
    options: { fanqie: { continuity: { enabled: true }, multiDraft: { enabled: true } } },
    created: async () => {},
    extras: {},
  });
  try {
    const a = { mode: "fanqie", root: data, work: "a" };
    const session = await host.open(a);
    assert.equal(session.systemPrompt.includes("AMBIENT_096_MUST_NOT_ENTER"), false);
    assert.equal(session.settingsManager.getCompactionEnabled(), true);
    assert.equal(session.getActiveToolNames().includes("bash"), false);
    for (const name of [
      "fanqie_foreshadow_set",
      "fanqie_knowledge_set",
      "fanqie_continuity_commit",
      "fanqie_candidate_unify_brief",
      "fanqie_candidate_unify_stage",
    ])
      assert.ok(session.getActiveToolNames().includes(name), `开启功能后注册工具：${name}`);
    const tool = session.agent.state.tools.find((t) => t.name === "fanqie_chapter_save");
    await assert.rejects(
      tool.execute("cross-work", { work: "b", chapter: "c001", content: "越界" }),
      /当前小说/,
    );
    await assert.rejects(
      tool.execute("cross-root", { working_dir: path.join(base, "other"), chapter: "c001" }),
      /项目目录/,
    );
    if (process.platform !== "win32") {
      const alias = path.join(base, "alias");
      await symlink(data, alias, "dir");
      assert.equal(host.key(a), host.key({ ...a, root: alias }));
    }
  } finally {
    await host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("文章独立历史、旧依据冲突与准备阶段取消", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-article-"));
  process.env.WRITER_STATE_ROOT = path.join(base, "home");
  const root = path.join(base, "articles"),
    store = new ArticleStore(root);
  const one = await store.create("one", {}),
    two = await store.create("two", {});
  const model = await fakeModel();
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const host = new Sessions({
    home: process.env.WRITER_STATE_ROOT,
    python: "python3",
    settings: () => models(model.url),
    emit: () => {},
    confirm: async () => true,
    options: {},
    created: async () => {},
    extras: {
      preferences: async () => {
        entered();
        await gate;
        return "";
      },
    },
  });
  const a = { mode: "toutiao", root, article: one.id },
    b = { mode: "toutiao", root, article: two.id };
  try {
    assert.notEqual(host.key(a), host.key(b));
    await store.stageDraft(one.id, "第一版", "writer", "");
    const session = await host.open(a);
    const tools = session.agent.state.tools;
    await tools.find((t) => t.name === "toutiao_draft_get").execute("read", { id: one.id });
    await store.stageDraft(one.id, "作者第二版", "author", "");
    await assert.rejects(
      tools
        .find((t) => t.name === "toutiao_draft_stage")
        .execute("stale", { id: one.id, text: "模型旧依据稿" }),
      /文章已变化/,
    );
    assert.equal((await store.get(one.id)).current_rev, 2);
    const pending = host.send(a, "准备中的任务", { article: one.id, intent: "inspect" });
    const rejected = assert.rejects(pending, /任务已取消/);
    await ready;
    assert.equal(host.running().length, 1);
    host.release(a);
    release();
    await rejected;
    assert.equal(model.calls.length, 0);
  } finally {
    release();
    await host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("准备阶段取消只发送一次 cancelled 结束事件", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-settle-"));
  process.env.WRITER_STATE_ROOT = home;
  const model = await fakeModel();
  let entered, release;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const events = [];
  const host = new Sessions({
    home: home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => events.push(event),
    confirm: async () => true,
    options: {},
    created: async () => {},
    extras: {
      preferences: async () => {
        entered();
        await gate;
        return "";
      },
    },
  });
  const target = { mode: "toutiao", root: path.join(home, "articles") };
  try {
    const pending = host.send(target, "准备中的任务");
    const rejected = assert.rejects(pending, /任务已取消/);
    await ready;
    await host.stop(target);
    release();
    await rejected;
    const settled = events.filter((event) => event.event?.type === "agent_settled");
    assert.equal(settled.length, 1);
    assert.equal(settled[0].event.reason, "cancelled");
    assert.equal(model.calls.length, 0);
  } finally {
    release();
    await host.dispose();
    await model.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("启动前失败标为 failed 并保留真实错误", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-failed-"));
  process.env.WRITER_STATE_ROOT = home;
  const model = await fakeModel(),
    events = [];
  const host = new Sessions({
    home: home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => events.push(event),
    confirm: async () => true,
    options: {},
    created: async () => {},
    extras: {
      preferences: async () => {
        throw new Error("材料文件不可读");
      },
    },
  });
  try {
    await assert.rejects(
      host.send({ mode: "toutiao", root: path.join(home, "articles") }, "开始"),
      /材料文件不可读/,
    );
    const settled = events.filter((event) => event.event?.type === "agent_settled");
    assert.equal(settled.length, 1);
    assert.equal(settled[0].event.reason, "failed");
    assert.match(settled[0].event.error, /材料文件不可读/);
  } finally {
    await host.dispose();
    await model.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("会话历史不可访问不能显示成空历史", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-history-error-"));
  const host = new Sessions({
    home: home,
    python: "python3",
    settings: defaultModels,
    emit: () => {},
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {},
  });
  const target = { mode: "toutiao", root: path.join(home, "articles") };
  try {
    const directory = await host.directory(target);
    await mkdir(directory, { recursive: true });
    const file = path.join(home, "not-a-directory");
    await writeFile(file, "x");
    for (const marker of [
      path.join(file, "session.jsonl"),
      path.join(file, "nested", "session.jsonl"),
    ]) {
      await writeFile(path.join(directory, "current"), marker);
      await assert.rejects(
        host.view(target),
        (error) => error.code === "ENOTDIR" || error.code === "unsafe_path",
      );
    }
    await writeFile(path.join(directory, "current"), path.join(home, "missing", "session.jsonl"));
    assert.deepEqual((await host.view(target)).messages, []);
  } finally {
    await host.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test("后台工作区释放失败告知作者，保留锁以供核对", async () => {
  const { Runtime, claimWorkspace, releaseWorkspace } =
    await import("../../apps/desktop/out-test/runtime-effects.mjs");
  const home = await realpath(await mkdtemp(path.join(tmpdir(), "writer-release-error-")));
  const previous = path.join(home, "previous"),
    current = path.join(home, "current");
  await mkdir(previous);
  await mkdir(current);
  const owner = await claimWorkspace(previous);
  const lock = path.join(previous, ".writer-workspace-lock.json");
  await rm(lock);
  await mkdir(lock);
  const state = new Runtime(),
    events = [];
  state.target = { mode: "toutiao", root: current };
  state.sessions = new Sessions({
    home,
    python: "python3",
    settings: defaultModels,
    emit: () => {},
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {},
  });
  state.diagnostics = { write: async () => {} };
  state.window = {
    isDestroyed: () => false,
    isFocused: () => true,
    webContents: { send: (_, event) => events.push(event) },
  };
  try {
    await state.sessionEvent({
      target: { mode: "toutiao", root: previous },
      event: { type: "agent_settled", reason: "done" },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(events.some((event) => /占用释放失败/.test(event.error || "")));
    assert.ok(state.notice.includes("占用释放失败"));
  } finally {
    await rm(lock, { recursive: true });
    await writeFile(lock, JSON.stringify(owner.owner));
    await releaseWorkspace(previous);
    await rm(home, { recursive: true, force: true });
  }
});

test("窗口已销毁时任务收尾与作者确认不触碰窗口，不产生收尾失败提示", async () => {
  const { Runtime } = await import("../../apps/desktop/out-test/runtime-effects.mjs");
  const state = new Runtime();
  const destroyed = () => {
    throw new Error("Object has been destroyed");
  };
  state.diagnostics = { write: async () => {} };
  state.window = {
    isDestroyed: () => true,
    isFocused: destroyed,
    show: destroyed,
    webContents: { send: destroyed },
  };
  await state.sessionEvent({ event: { type: "agent_settled", reason: "done" } });
  assert.equal(state.notice, "");
  assert.equal(await state.confirm("确认定稿？"), false);
  assert.throws(() => state.windowOrThrow(), /界面窗口尚未就绪或已关闭/);
});

test("SDK 错误后正确结束，下一次成功任务有独立结束事件", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-sdk-settle-"));
  process.env.WRITER_STATE_ROOT = home;
  const model = await fakeModel({ "mock-writer": [{ status: 401, error: "invalid api key" }] }),
    events = [];
  let finish;
  const host = new Sessions({
    home: home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      events.push(event);
      if (event.event?.type === "agent_settled" && !event.editor) finish?.();
    },
    confirm: async () => true,
    options: {},
    created: async () => {},
    extras: {},
  });
  const target = { mode: "toutiao", root: path.join(home, "articles") };
  try {
    for (const expected of ["failed", "done"]) {
      const ready = settled();
      finish = ready.finish;
      await host.send(target, "开始任务");
      await ready.promise;
      const ended = events.filter(
        (event) => event.event?.type === "agent_settled" && !event.editor,
      );
      assert.equal(ended.at(-1).event.reason, expected);
      assert.equal(
        ended.at(-1).error,
        undefined,
        "结束事件必须先让对话退出忙碌状态，再单独显示错误",
      );
    }
    const ended = events.filter((event) => event.event?.type === "agent_settled" && !event.editor);
    assert.equal(ended.length, 2);
    assert.equal(new Set(ended.map((event) => event.event.taskId)).size, 2);
    assert.match(ended[0].event.error, /认证失败/);
  } finally {
    await host.dispose();
    await model.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("PI 上下文：连续请求和重启保持历史前缀，缓存用量使用 SDK 口径", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-cache-"));
  process.env.WRITER_STATE_ROOT = home;
  const model = await fakeModel({
    "mock-writer": [
      { text: "第一轮" },
      {
        text: "第二轮",
        usage: {
          prompt_tokens: 1000,
          prompt_tokens_details: { cached_tokens: 700, cache_write_tokens: 100 },
        },
      },
      { text: "重启后继续" },
    ],
  });
  const usage = [],
    target = { mode: "toutiao", root: path.join(home, "articles") };
  let finish;
  const make = () =>
    new Sessions({
      home: home,
      python: "python3",
      settings: () => models(model.url),
      emit: (event) => {
        if (event.event?.type === "agent_settled" && !event.editor) finish?.();
      },
      confirm: async () => true,
      options: {},
      created: async () => {},
      extras: {
        log: (event, fields) => {
          if (event === "model_usage") usage.push(fields);
        },
      },
    });
  let host = make();
  const send = async (text) => {
    const done = settled();
    finish = done.finish;
    await host.send(target, text);
    await done.promise;
  };
  try {
    await send("先核对要求");
    const first = structuredClone(model.calls[0]);
    await send("继续核对");
    const second = structuredClone(model.calls[1]);
    assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages);
    assert.deepEqual(second.tools, first.tools);
    assert.equal(usage[1].input, 200);
    assert.equal(usage[1].cacheRead, 700);
    assert.equal(usage[1].cacheWrite, 100);
    const { sessionUsage } = await import("../../apps/desktop/out-test/usage.mjs");
    const snapshot = await sessionUsage(host, target);
    assert.equal(
      (await sessionUsage(host, target)).stats,
      snapshot.stats,
      "同一会话版本复用统计，不重扫历史",
    );
    const session = await host.open(target),
      id = session.sessionId;
    assert.equal(session.settingsManager.getCompactionSettings().enabled, true);
    assert.equal(session.settingsManager.getCacheWarmingMode(), "streaming");
    await host.dispose();
    host = make();
    assert.equal((await host.open(target)).sessionId, id);
    await send("重启后继续核对");
    assert.deepEqual(model.calls[2].messages.slice(0, second.messages.length), second.messages);
    assert.deepEqual(model.calls[2].tools, first.tools);
  } finally {
    await host.dispose();
    await model.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("IPC 边界拒绝非法角色、动作、恢复条件与字号", async () => {
  const { IPC_PARSERS: p } = await import("../../apps/desktop/out-test/ipc-contract.mjs");
  assert.throws(() => p["model-catalog"](["unknown", {}]), /参数无效/);
  assert.throws(() => p["model-catalog"](["writer", {}, "delete"]), /参数无效/);
  assert.throws(() => p.updates(["delete"]), /参数无效/);
  assert.throws(() => p.recover([{ id: "x", fingerprint: 1 }]), /参数无效/);
  assert.throws(() => p.export([{ mode: "fanqie", root: "/tmp" }, {}, "html"]), /参数无效/);
  for (const fontSize of [15, 23, "18"]) assert.throws(() => p.appearance([{ fontSize }]), /字号/);
  assert.deepEqual(p.appearance([{ fontSize: 22 }]), [{ fontSize: 22 }]);
  assert.deepEqual(p.view([{ mode: "toutiao", root: "/tmp" }]), [
    { mode: "toutiao", root: "/tmp" },
    80,
    undefined,
  ]);
  assert.throws(() => p.view([{ mode: "toutiao", root: "/tmp" }, "80"]), /历史条数/);
  assert.throws(() => p.search([{}]), /文本/);
  assert.deepEqual(p["save-preferences"](["偏好"]), ["偏好"]);
  assert.throws(() => p.model(["writer"]), /模型设置须为对象/);
  assert.throws(() => p.model([{ writer: { model: 1 } }]), /model 须为文本/);
  assert.deepEqual(p.model([{ planner: null }]), [
    { writer: undefined, editor: undefined, planner: null },
  ]);
});

test("任务运行或准备中拒绝保存模型，不中止任务也不改写配置", async () => {
  const { Runtime, registerModelsIpc, ipcMain } =
    await import("../../apps/desktop/out-test/runtime-effects.mjs");
  const home = await mkdtemp(path.join(tmpdir(), "writer-model-guard-"));
  const state = new Runtime(),
    events = [];
  state.home = home;
  state.settings = new Settings(home, {
    available: () => false,
    encrypt: (text) => text,
    decrypt: (text) => text,
  });
  state.model = state.settings.models;
  state.diagnostics = { write: async () => {} };
  state.window = {
    isDestroyed: () => false,
    webContents: { send: (_, event) => events.push(event) },
  };
  const target = { mode: "toutiao", root: home };
  state.sessions = new Sessions({
    home,
    python: "python3",
    settings: () => state.model,
    emit: () => {},
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {},
  });
  registerModelsIpc(state);
  const save = ipcMain.handlers.get("writer:model");
  const next = { ...state.settings.public().models };
  next.writer = { ...next.writer, model: "changed-model" };
  try {
    state.sessions.preparations.set(Symbol("task"), { target, focus: {}, generation: 0 });
    await assert.rejects(save({}, next), /请等待任务结束后修改模型设置/);
    assert.equal(state.sessions.preparations.size, 1);
    await assert.rejects(readFile(path.join(home, "model.json"), "utf8"), { code: "ENOENT" });
    assert.equal(state.model.writer.model, defaultModels().writer.model);
    state.sessions.preparations.clear();
    await save({}, next);
    assert.equal(state.model.writer.model, "changed-model");
    assert.ok(events.some((event) => event.refresh));
  } finally {
    await state.sessions.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test("搜索 Key 可清除，非法外观读盘提示，旧模型迁移保留密文", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-config-boundary-"));
  const secrets = {
    available: () => true,
    encrypt: (text) => "cipher:" + text,
    decrypt: (text) => text.replace(/^cipher:/, ""),
  };
  try {
    const store = new Settings(home, secrets);
    await store.saveSearch("secret");
    await store.saveSearch("");
    await writeFile(
      path.join(home, "desktop.json"),
      JSON.stringify({ appearance: { fontSize: 99 } }),
    );
    await writeFile(
      path.join(home, "model.json"),
      JSON.stringify({ ...defaultModels().writer, secret: "cipher:retained" }),
    );
    await store.load();
    assert.equal(store.searchKey, "");
    assert.equal(store.appearance.fontSize, 18);
    assert.ok(store.notices.some((n) => n.includes("外观")));
    const saved = await readFile(path.join(home, "model.json"), "utf8");
    assert.equal(JSON.parse(saved).writer.secret, "cipher:retained");
    assert.ok(!saved.includes('"apiKey": "retained"'));
    const reopened = new Settings(home, secrets);
    await reopened.load();
    assert.equal(reopened.models.writer.apiKey, "retained");
    assert.equal(reopened.searchKey, "");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("诊断精确脱敏并保留容量和无 Key 配置", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-diagnostic-fields-"));
  try {
    const { Diagnostics } = await import("../../apps/desktop/out-test/diagnostics.mjs");
    const diagnostics = new Diagnostics(home);
    await diagnostics.init();
    const result = await diagnostics.bundle({
      apiKey: "secret",
      token: "secret",
      secret: "secret",
      password: "secret",
      authorization: "secret",
      maxTokens: 8192,
      keyless: true,
    });
    assert.equal(result.config.maxTokens, 8192);
    assert.equal(result.config.keyless, true);
    for (const key of ["apiKey", "token", "secret", "password", "authorization"])
      assert.equal(result.config[key], "[已移除]");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("交接埋点：write 任务记录 handoff 事件并携带方法字节与 lean 简报字节", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-handoff-"));
  const { ensureStorage, createWork } = await import("../../apps/desktop/out-test/work-store.mjs");
  const appHome = path.join(base, "app");
  await mkdir(appHome);
  process.env.WRITER_STATE_ROOT = appHome;
  const paths = await ensureStorage(null, { storageRoot: path.join(base, "data") });
  const work = await createWork(paths, { title: "长夜车站" });
  const model = await fakeModel({
    "mock-writer": [
      {
        name: "fanqie_outline_set",
        input: {
          chapter: "c001",
          title: "站台",
          pov: "林川",
          targetWords: 2000,
          locks: "车站停电",
          knowledge: "他不知道来电者身份",
          synopsis: "林川等车",
          conflict: "末班车不停站",
          beats: "广播来电",
          ending: "门打开",
        },
      },
      { text: "开篇规划已保存。" },
      { text: "已按简报续写。" },
    ],
  });
  const logs = [];
  const first = settled();
  let onSettled = first.finish;
  const host = new Sessions({
    home: appHome,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      if (event.event?.type === "agent_settled") onSettled();
    },
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: { log: (name, fields) => logs.push({ name, ...fields }) },
  });
  const target = { mode: "fanqie", root: paths.base, work: work.meta.key };
  try {
    await host.send(target, "规划本书开篇。", { chapter: "c001", intent: "plan" });
    await first.promise;
    const second = settled();
    onSettled = second.finish;
    await host.send(target, "交接本章，按当前正文继续写作。", {
      chapter: "c001",
      intent: "write",
    });
    await second.promise;
    const handoffs = logs.filter((row) => row.name === "handoff");
    assert.equal(handoffs.length, 2);
    const plan = handoffs[0];
    assert.equal(plan.mode, "fanqie");
    assert.equal(plan.intentSource, "focus");
    assert.equal(plan.intent, "plan");
    assert.deepEqual(plan.methodIds, ["plan-foundation"]);
    assert.ok(plan.methodBytes > 0);
    assert.equal(plan.briefAttached, false);
    assert.equal(plan.briefBytes, 0);
    const write = handoffs[1];
    assert.equal(write.mode, "fanqie");
    assert.equal(write.intentSource, "focus");
    assert.equal(write.intent, "write");
    assert.deepEqual(write.methodIds, ["write-chapter"]);
    assert.ok(write.methodBytes > 0);
    assert.equal(write.briefAttached, true);
    assert.ok(write.briefBytes > 0);
  } finally {
    await host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("工具调用埋点：tool_call 随执行落盘，失败记录错误原文", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-tool-call-"));
  const target = { mode: "toutiao", root: path.join(home, "articles") };
  const store = new ArticleStore(target.root);
  const article = await store.create("toolcall", { date: "2026-11-05" });
  target.article = article.id;
  const card = { 内容线: "资讯线", 出处: [{ 事实: "26户", 链接: "作者素材" }] };
  const model = await fakeModel({
    "mock-writer": [
      { name: "toutiao_card_set", input: { id: article.id, card: { 内容线: "资讯线" } } },
      { name: "toutiao_card_set", input: { id: article.id, card } },
      { text: "立项卡已保存。" },
    ],
  });
  const logs = [];
  const done = settled();
  const host = new Sessions({
    home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      if (event.event?.type === "agent_settled") done.finish();
    },
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: { log: (name, fields) => logs.push({ name, ...fields }) },
  });
  try {
    await host.send(target, "只使用作者素材建立资讯线立项卡");
    await done.promise;
    const calls = logs.filter((row) => row.name === "tool_call");
    assert.equal(calls.filter((row) => row.tool === "toutiao_card_set").length, 2);
    const failed = calls.find((row) => row.tool === "toutiao_card_set" && row.error);
    assert.ok(failed);
    assert.equal(failed.role, "writer");
    assert.match(failed.error, /出处/);
    assert.equal("denied" in failed, false);
    const saved = calls.find((row) => row.tool === "toutiao_card_set" && !row.error);
    assert.ok(saved);
    assert.equal(saved.role, "writer");
    assert.ok(calls.every((row) => row.tool && row.role));
    const handoff = logs.find((row) => row.name === "handoff");
    assert.equal(handoff.mode, "toutiao");
    assert.equal(handoff.intentSource, "regex");
    assert.equal(handoff.intent, "inspect");
    assert.deepEqual(handoff.methodIds, []);
    assert.equal(handoff.methodBytes, 0);
    assert.equal(handoff.briefAttached, false);
    assert.equal(handoff.briefBytes, 0);
  } finally {
    await host.dispose();
    await model.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("方法加载埋点：同一方法重复读取时 method_loaded 带 duplicate 标记", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-method-dup-"));
  const target = { mode: "toutiao", root: path.join(home, "articles") };
  const model = await fakeModel({
    "mock-writer": [
      { name: "toutiao_method_get", input: { id: "overview" } },
      { name: "toutiao_method_get", input: { id: "overview" } },
      { text: "方法已读取。" },
    ],
  });
  const logs = [];
  const done = settled();
  const host = new Sessions({
    home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      if (event.event?.type === "agent_settled") done.finish();
    },
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: { log: (name, fields) => logs.push({ name, ...fields }) },
  });
  try {
    await host.send(target, "读取当前方法说明");
    await done.promise;
    const loads = logs.filter((row) => row.name === "method_loaded");
    assert.equal(loads.length, 2);
    assert.equal(loads[0].id, "overview");
    assert.equal(loads[0].duplicate, false);
    assert.equal(loads[1].duplicate, true);
    assert.equal(loads[0].hash, loads[1].hash);
    assert.equal(loads[1].profile, loads[0].profile);
    assert.ok(loads[0].taskId);
    assert.ok(loads[0].conversationId);
  } finally {
    await host.dispose();
    await model.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("压缩埋点：context_compacted 记录 trigger、触发比例与作者任务预览", async () => {
  for (const automatic of [false, true]) {
    const home = await mkdtemp(path.join(tmpdir(), "writer-compact-log-"));
    const target = { mode: "toutiao", root: path.join(home, "articles") };
    const model = await fakeModel({
      "mock-writer": [
        {
          text: "四项事实已记录",
          usage: automatic
            ? { prompt_tokens: 110000, completion_tokens: 10, total_tokens: 110010 }
            : undefined,
        },
        { text: "摘要：保留作者约束" },
      ],
    });
    const logs = [];
    const done = settled();
    const host = new Sessions({
      home,
      python: "python3",
      settings: () => models(model.url),
      emit: (event) => {
        if (event.event?.type === "agent_settled") done.finish();
      },
      confirm: async () => false,
      options: {},
      created: async () => {},
      extras: {
        log: (name, fields) => logs.push({ name, ...fields }),
        context: () => ({
          enabled: automatic,
          triggerPercent: 80,
          budget: 0,
          keepRecentTokens: 0,
        }),
      },
    });
    try {
      await host.send(target, "作者约束：主角不能飞。");
      await done.promise;
      const session = await host.open(target);
      await session.waitForIdle();
      if (!automatic) await host.compact(target, "保留四项事实");
      const compacted = logs.filter((row) => row.name === "context_compacted");
      assert.equal(compacted.length, 1);
      assert.equal(compacted[0].trigger, automatic ? "auto" : "manual");
      assert.ok(compacted[0].thresholdRatio > 0);
      assert.ok(compacted[0].thresholdRatio <= 1);
      assert.equal(compacted[0].lastUserPreview, "作者约束：主角不能飞。");
      assert.equal(compacted[0].success, true);
      assert.ok(compacted[0].tokensBefore > 0);
      assert.equal(compacted[0].aborted, false);
    } finally {
      await host.dispose();
      await model.close();
      await rm(home, { recursive: true, force: true });
    }
  }
});

test("旧目录对话只迁移一次，后续读取不访问旧目录", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-history-migration-"));
  const events = [];
  const host = new Sessions({
    home,
    python: "python3",
    settings: defaultModels,
    emit: () => {},
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: { log: (name, fields) => events.push({ name, ...fields }) },
  });
  const target = { mode: "toutiao", root: home, article: "article-1" };
  try {
    const old = await host.directory({ ...target, article: undefined });
    await mkdir(old, { recursive: true });
    await writeFile(path.join(old, "history.json"), JSON.stringify(["/tmp/old-session.jsonl"]));
    await host.initialize(target);
    await rm(path.join(old, "history.json"));
    await mkdir(path.join(old, "history.json"));
    await host.initialize(target);
    const rows = await host.conversations(target);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].file, "/tmp/old-session.jsonl");
    assert.equal(events.filter((e) => e.name === "legacy_sessions_migrated").length, 1);
  } finally {
    await host.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test("作者素材可保存，未读取网页仍拒绝且不覆盖旧卡", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-source-"));
  const target = { mode: "toutiao", root: path.join(home, "articles") };
  const store = new ArticleStore(target.root);
  const article = await store.create("source", { date: "2026-11-05" });
  target.article = article.id;
  const card = { 内容线: "资讯线", 出处: [{ 事实: "26户", 链接: "作者素材" }] };
  const model = await fakeModel({
    "mock-writer": [
      { name: "toutiao_card_set", input: { id: article.id, card } },
      {
        name: "toutiao_card_patch",
        input: {
          id: article.id,
          patch: { 出处: [{ 事实: "26户", 链接: "https://example.com/unread" }] },
        },
      },
      { text: "已核对" },
    ],
  });
  const done = settled();
  const host = new Sessions({
    home,
    python: "python3",
    settings: () => models(model.url),
    emit: (e) => {
      if (e.event?.type === "agent_settled") done.finish();
    },
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {},
  });
  try {
    await host.send(target, "只使用作者素材");
    await done.promise;
    assert.deepEqual((await store.readCard(article.id)).出处, card.出处);
    const results = model.calls.at(-1).messages.filter((m) => m.role === "tool");
    assert.ok(results.some((m) => m.content.includes("writer_read_url")));
    assert.ok(results.every((m) => !m.content.includes("Invalid URL")));
  } finally {
    await host.dispose();
    await model.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("Exa 轻量契约与 HTTP 错误不静默升级", async () => {
  const { searchSources } = await import("../../apps/desktop/out-test/network.mjs");
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({ results: [{ title: "资料", url: "https://example.com/source" }] }),
      { status: 200 },
    );
  };
  try {
    const results = await searchSources("中文资料", "fixture-key");
    assert.equal(results.results.length, 1);
    assert.equal(results.cost, undefined);
    assert.equal(calls[0].url, "https://api.exa.ai/search");
    assert.equal(calls[0].init.headers["x-api-key"], "fixture-key");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      query: "中文资料",
      type: "lite",
      numResults: 3,
    });
    assert.ok(!calls[0].init.body.includes("fixture-key"));
    globalThis.fetch = async () => new Response("unsupported", { status: 400 });
    await assert.rejects(searchSources("资料", "fixture-key"), /HTTP 400/);
  } finally {
    globalThis.fetch = original;
  }
});

test("压缩预算按窗口和输出预留计算，设置持久化", async () => {
  const { parseContextSettings, compactionSettings } =
    await import("../../apps/desktop/out-test/context-settings.mjs");
  const value = parseContextSettings({
    enabled: false,
    triggerPercent: 80,
    budget: 0,
    keepRecentTokens: 20000,
  });
  assert.deepEqual(compactionSettings(value, 128000, 8192), {
    enabled: false,
    reserveTokens: 25600,
    keepRecentTokens: 20000,
  });
  assert.equal(
    compactionSettings({ ...value, budget: 64000 }, 1024000, 65536).reserveTokens,
    960000,
  );
  assert.throws(() => parseContextSettings({ ...value, triggerPercent: 99 }), /压缩/);
  assert.throws(() => compactionSettings(value, 8192, 8192), /输出预算/);
  const home = await mkdtemp(path.join(tmpdir(), "writer-context-"));
  const secrets = {
    available: () => false,
    encrypt: () => {
      throw Error("unavailable");
    },
    decrypt: () => {
      throw Error("unavailable");
    },
  };
  try {
    const store = new Settings(home, secrets);
    await store.saveContext(value);
    const reopened = new Settings(home, secrets);
    await reopened.load();
    assert.deepEqual(reopened.public().context, value);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("手动压缩保留原始历史和会话，自动阈值会产生压缩条目", async () => {
  for (const automatic of [false, true]) {
    const home = await mkdtemp(path.join(tmpdir(), "writer-compact-"));
    const model = await fakeModel({
      "mock-writer": [
        {
          text: "四项事实已记录",
          usage: { prompt_tokens: 110000, completion_tokens: 10, total_tokens: 110010 },
        },
        { text: "摘要：保留四项事实" },
      ],
    });
    const done = settled();
    const target = { mode: "toutiao", root: path.join(home, "articles") };
    const events = [];
    const host = new Sessions({
      home,
      python: "python3",
      settings: () => models(model.url),
      emit: (e) => {
        events.push(e);
        if (e.event?.type === "agent_settled") done.finish();
      },
      confirm: async () => false,
      options: {},
      created: async () => {},
      extras: {
        context: () => ({ enabled: automatic, triggerPercent: 80, budget: 0, keepRecentTokens: 0 }),
      },
    });
    try {
      await host.send(target, "林砚是修表师，阿禾对花生过敏，桥退潮出现，钥匙只开档案柜。");
      await done.promise;
      const session = await host.open(target);
      await session.waitForIdle();
      const id = session.sessionId;
      if (!automatic) await host.compact(target, "保留四项事实");
      assert.equal(session.sessionId, id);
      const entries = session.sessionManager.getEntries();
      assert.equal(entries.filter((e) => e.type === "compaction").length, 1);
      assert.ok(entries.some((e) => e.type === "message" && e.message.role === "user"));
      assert.ok(entries.some((e) => e.type === "message" && e.message.role === "assistant"));
      assert.ok(events.some((e) => e.event?.type === "compaction_start"));
      assert.ok(events.some((e) => e.event?.type === "compaction_end"));
      assert.equal(session.isIdle, true);
      assert.equal(session.getContextUsage().tokens, null);
    } finally {
      await host.dispose();
      await model.close();
      await rm(home, { recursive: true, force: true });
    }
  }
});

test("手动压缩互斥，可取消且不删除原始历史", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-compact-cancel-"));
  const model = await fakeModel({ "mock-writer": [{ text: "已记录素材" }, { wait: true }] });
  const target = { mode: "toutiao", root: path.join(home, "articles") };
  const done = settled();
  let start;
  const started = new Promise((resolve) => {
    start = resolve;
  });
  const host = new Sessions({
    home,
    python: "python3",
    settings: () => models(model.url),
    emit: (e) => {
      if (e.event?.type === "agent_settled") done.finish();
      if (e.event?.type === "compaction_start") start();
    },
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {
      context: () => ({ enabled: false, triggerPercent: 80, budget: 0, keepRecentTokens: 0 }),
    },
  });
  try {
    await host.send(target, "保留作者素材");
    await done.promise;
    const pending = host.compact(target, "");
    const cancelled = assert.rejects(pending, /cancel|abort/i);
    await started;
    await assert.rejects(host.compact(target, ""), /当前任务|停止任务/);
    await assert.rejects(host.send(target, "不应发出"), /正在压缩/);
    await host.stop(target);
    await cancelled;
    const session = await host.open(target);
    assert.equal(session.isIdle, true);
    assert.equal(host.compactions.size, 0);
    assert.equal(
      session.sessionManager.getEntries().filter((e) => e.type === "compaction").length,
      0,
    );
    assert.ok(
      session.sessionManager
        .getEntries()
        .some((e) => e.type === "message" && e.message.role === "user"),
    );
    model.push("mock-writer", { status: 401, error: "invalid api key" });
    await assert.rejects(host.compact(target, ""));
    assert.equal(session.isIdle, true);
    assert.equal(host.compactions.size, 0);
  } finally {
    await host.dispose();
    await model.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("Agent 直接保存尚无文件的新章正文，不因缺少已读版本报错；已有正文仍须版本依据", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-new-chapter-"));
  const { ensureStorage, createWork, readChapter } =
    await import("../../apps/desktop/out-test/work-store.mjs");
  const appHome = path.join(base, "app");
  await mkdir(appHome);
  process.env.WRITER_STATE_ROOT = appHome;
  const paths = await ensureStorage(null, { storageRoot: path.join(base, "data") });
  const work = await createWork(paths, { title: "新章" });
  const model = await fakeModel();
  const host = new Sessions({
    home: appHome,
    python: "python3",
    settings: () => models(model.url),
    emit: () => {},
    confirm: async () => true,
    options: {},
    created: async () => {},
    extras: {},
  });
  try {
    const session = await host.open({ mode: "fanqie", root: paths.base, work: work.meta.key });
    const tool = session.agent.state.tools.find((t) => t.name === "fanqie_chapter_save");
    await tool.execute("fresh", { chapter: "c001", content: "站台的灯一盏盏熄灭。" });
    assert.equal((await readChapter(work.dir, "c001")).body.trim(), "站台的灯一盏盏熄灭。");
    await assert.rejects(
      tool.execute("overwrite", { chapter: "c001", content: "改写" }),
      /expected_revision/,
    );
  } finally {
    await host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("配置更新期间拒绝新任务与压缩，失败后恢复接收", async () => {
  const { Runtime } = await import("../../apps/desktop/out-test/runtime-effects.mjs");
  const home = await mkdtemp(path.join(tmpdir(), "writer-config-transaction-"));
  const state = new Runtime();
  state.sessions = new Sessions({
    home,
    python: "python3",
    settings: defaultModels,
    emit: () => {},
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {},
  });
  const target = { mode: "toutiao", root: home };
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const update = state.reconfigure(async () => {
    await gate;
    throw new Error("保存失败");
  });
  const failure = assert.rejects(update, /保存失败/);
  try {
    await assert.rejects(state.sessions.send(target, "不应发送"), /正在更新/);
    await assert.rejects(state.sessions.compact(target, ""), /正在更新/);
    await assert.rejects(state.sessions.open(target), /正在更新/);
    await assert.rejects(
      state.reconfigure(async () => {}),
      /请等待/,
    );
    assert.equal(state.sessions.preparations.size, 0);
    release();
    await failure;
    assert.equal(state.sessions.reconfiguring, false);
    assert.equal(await state.reconfigure(async () => "恢复"), "恢复");
  } finally {
    release();
    await failure;
    await state.sessions.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test("长篇任务自动注入当前用户方法，并记录与实际内容一致的哈希", async () => {
  const { createProfile } = await import("../../build/core/src/profiles.js");
  const { fanqieLibrary } = await import("../../build/fanqie/src/forge.js");
  const { sessionUsage } = await import("../../apps/desktop/out-test/usage.mjs");
  const home = await mkdtemp(path.join(tmpdir(), "writer-method-fusion-"));
  const previous = process.env.WRITER_PROFILES_DIR;
  process.env.WRITER_PROFILES_DIR = path.join(home, "profiles");
  process.env.WRITER_STATE_ROOT = home;
  const text = "# 本书写作要求\nFUSION_RULE_不要替人物补全未知事实";
  const profile = await createProfile(fanqieLibrary, {
    name: "融合测试",
    base: "default",
    files: [{ id: "write-chapter", text }],
  });
  const model = await fakeModel({ "mock-writer": [{ text: "收到" }] });
  const done = settled();
  const host = new Sessions({
    home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      if (event.event?.type === "agent_settled") done.finish();
    },
    confirm: async () => false,
    options: { fanqie: { profile: profile.id } },
    created: async () => {},
    extras: {},
  });
  const target = { mode: "fanqie", root: home };
  try {
    await host.send(target, "写一段场景", { intent: "write" });
    await done.promise;
    const messages = model.calls[0].messages;
    assert.match(JSON.stringify(messages), /FUSION_RULE_不要替人物补全未知事实/);
    const usage = await sessionUsage(host, target);
    const receipt = usage.methods.find((method) => method.id === "write-chapter");
    assert.equal(receipt.profile, profile.id);
    assert.equal(receipt.hash, createHash("sha256").update(text).digest("hex"));
  } finally {
    await host.dispose();
    await model.close();
    if (previous === undefined) delete process.env.WRITER_PROFILES_DIR;
    else process.env.WRITER_PROFILES_DIR = previous;
    await rm(home, { recursive: true, force: true });
  }
});

const OUTLINE_C001 = {
  chapter: "c001",
  title: "站台",
  pov: "林川",
  targetWords: 2000,
  locks: "车站停电",
  knowledge: "他不知道来电者身份",
  synopsis: "林川等车",
  conflict: "末班车不停站",
  beats: "广播来电",
  ending: "门打开",
};

function handoffHost(base, options, model, logs, extras = {}) {
  let onSettled = () => {};
  const host = new Sessions({
    home: base,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      if (event.event?.type === "agent_settled") onSettled();
    },
    confirm: async () => false,
    options,
    created: async () => {},
    extras: { log: (name, fields) => logs.push({ name, ...fields }), ...extras },
  });
  return {
    host,
    settle() {
      let finish;
      const promise = new Promise((resolve) => {
        onSettled = resolve;
        finish = resolve;
      });
      return { promise, finish };
    },
  };
}

function writerMessages(model, index) {
  const call = model.calls.filter((call) => call.model === "mock-writer")[index];
  assert.ok(call, `第 ${index + 1} 次写手调用不存在`);
  return call.messages
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : (message.content || []).map((part) => part.text || "").join("\n"),
    )
    .join("\n");
}

test("handoff.v2 关闭：显式配置 false 时交接与方法注入与旧路径一致", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-handoff-v1-"));
  const { ensureStorage, createWork } = await import("../../apps/desktop/out-test/work-store.mjs");
  const appHome = path.join(base, "app");
  await mkdir(appHome);
  process.env.WRITER_STATE_ROOT = appHome;
  const paths = await ensureStorage(null, { storageRoot: path.join(base, "data") });
  const work = await createWork(paths, { title: "长夜车站" });
  const model = await fakeModel({
    "mock-writer": [
      { name: "fanqie_outline_set", input: OUTLINE_C001 },
      { text: "开篇规划已保存。" },
      { text: "已收到任务。" },
    ],
  });
  const logs = [];
  const { host, settle } = handoffHost(
    appHome,
    { fanqie: { handoff: { v2: false } } },
    model,
    logs,
  );
  const target = { mode: "fanqie", root: paths.base, work: work.meta.key };
  try {
    let step = settle();
    await host.send(target, "规划本书开篇。", { chapter: "c001", intent: "plan" });
    await step.promise;
    step = settle();
    await host.send(target, "帮我看看这章写得怎么样", { chapter: "c001" });
    await step.promise;
    const handoffs = logs.filter((row) => row.name === "handoff");
    assert.equal(handoffs.length, 2);
    assert.deepEqual(
      handoffs.map((row) => [row.intentSource, row.intent, row.methodIds, row.briefAttached]),
      [
        ["focus", "plan", ["plan-foundation"], false],
        ["regex", "write", ["write-chapter"], true],
      ],
    );
    assert.match(writerMessages(model, 2), /写章流程：从章纲到交付/);
  } finally {
    await host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("handoff.v2 开启：番茄按状态路由（K-02），revise 附审读回报，无章纲先补章纲", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-handoff-v2-"));
  const { ensureStorage, createWork } = await import("../../apps/desktop/out-test/work-store.mjs");
  const { saveReview, bodyFingerprint } = await import("../../apps/desktop/out-test/review.mjs");
  const appHome = path.join(base, "app");
  await mkdir(appHome);
  process.env.WRITER_STATE_ROOT = appHome;
  const paths = await ensureStorage(null, { storageRoot: path.join(base, "data") });
  const work = await createWork(paths, { title: "长夜车站" });
  const model = await fakeModel({
    "mock-writer": [
      { name: "fanqie_outline_set", input: OUTLINE_C001 },
      { text: "开篇规划已保存。" },
      { text: "本章状态已核对。" },
      { text: "已按回报修改。" },
      { name: "fanqie_outline_set", input: { chapter: "c002", title: "空章" } },
      { text: "新章已登记。" },
      { text: "按章纲推进。" },
    ],
  });
  const logs = [];
  const { host, settle } = handoffHost(appHome, { fanqie: { handoff: { v2: true } } }, model, logs);
  const target = { mode: "fanqie", root: paths.base, work: work.meta.key };
  try {
    let step = settle();
    await host.send(target, "规划本书开篇。", { chapter: "c001", intent: "plan" });
    await step.promise;

    // K-02：问句含"写"不能判成写章，也不注入方法或简报
    step = settle();
    await host.send(target, "帮我看看这章写得怎么样", { chapter: "c001" });
    await step.promise;

    // K-02：按审读意见修改是 revise，附审读回报全文与 L1–L3 修改范围
    const workDir = path.join(paths.works, work.meta.key);
    await saveReview(workDir, {
      work: work.meta.key,
      work_title: "长夜车站",
      chapter: "c001",
      chapter_title: "站台",
      body_sha256: bodyFingerprint(""),
      verdict: "未通过",
      hard_issues: [],
      levels: [{ level: "L1", location: "第 2 段", symptom: "视角漂移", fix: "回到林川" }],
      optional: [],
      reread_full: true,
      changed_scope: "未改",
      strengths: "",
      by: "editor",
      at: new Date().toISOString(),
    });
    step = settle();
    await host.send(target, "按审读意见修改这章", { chapter: "c001" });
    await step.promise;

    // 先经一次任务登记无章纲的 c002（快照要在下一次任务前能看到它）
    step = settle();
    await host.send(target, "再登记一章 c002，标题「空章」。");
    await step.promise;

    // 状态压过按钮的 write 意图：无章纲的章先补章纲
    step = settle();
    await host.send(target, "【写作台】续写《长夜车站》第 2 章（c002）。", {
      chapter: "c002",
      intent: "write",
    });
    await step.promise;

    const handoffs = logs.filter((row) => row.name === "handoff");
    assert.equal(handoffs.length, 5);
    assert.deepEqual(
      handoffs.map((row) => [row.intentSource, row.intent, row.methodIds, row.briefAttached]),
      [
        ["focus", "plan", ["plan-foundation"], false],
        ["state", "inspect", [], false],
        ["state", "revise", ["revise"], false],
        ["state", "inspect", [], false],
        ["focus", "plan", ["plan-outline"], false],
      ],
    );
    assert.ok(handoffs[2].methodBytes > 0);
    const inspectText = writerMessages(model, 2);
    assert.ok(!inspectText.includes("写章流程：从章纲到交付"));
    const reviseText = writerMessages(model, 3);
    assert.match(reviseText, /受控修订/);
    assert.match(reviseText, /审读回报 · 《长夜车站》站台/);
    assert.match(reviseText, /L1 第 2 段：视角漂移/);
    const outlineText = writerMessages(model, 6);
    assert.match(outlineText, /章纲：8 个字段怎么写好/);
    assert.ok(!outlineText.includes("写章流程：从章纲到交付"));
  } finally {
    await host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("handoff.v2 开启：头条按文章状态注入对应 S 步方法（K-03）", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-handoff-tt-"));
  process.env.WRITER_STATE_ROOT = base;
  const root = path.join(base, "articles");
  const store = new ArticleStore(root);
  const article = await store.create("topic", { date: "2026-11-06", line: "资讯线" });
  const model = await fakeModel();
  const logs = [];
  const { host, settle } = handoffHost(base, { toutiao: { handoff: { v2: true } } }, model, logs);
  const target = { mode: "toutiao", root, article: article.id };
  try {
    let step = settle();
    await host.send(target, "推进这篇", { article: article.id });
    await step.promise;
    await store.writeCard(article.id, { 内容线: "资讯线" });
    step = settle();
    await host.send(target, "标题拟好了吗", { article: article.id });
    await step.promise;
    await store.update(article.id, (m) => {
      m.headlines.main = "测试主标题";
    });
    step = settle();
    await host.send(target, "开始写正文", { article: article.id });
    await step.promise;
    await store.stageDraft(article.id, "初稿正文，先跑通流程。", "writer", "初稿");
    await store.update(article.id, (m) => {
      m.status = "待验收";
    });
    step = settle();
    await host.send(target, "送验收", { article: article.id });
    await step.promise;
    step = settle();
    await host.send({ mode: "toutiao", root }, "再写一篇新的");
    await step.promise;

    const handoffs = logs.filter((row) => row.name === "handoff");
    assert.equal(handoffs.length, 5);
    assert.deepEqual(
      handoffs.map((row) => [row.intentSource, row.intent, row.methodIds]),
      [
        ["state", "plan", ["s2-selection"]],
        ["state", "write", ["s3-headline"]],
        ["state", "write", ["s4-common", "s4-news", "corpus-common"]],
        ["state", "review", ["s5-editing", "s6-qa"]],
        ["state", "plan", ["s1-hot", "s1-evergreen"]],
      ],
    );
    assert.match(writerMessages(model, 2), /S4 资讯线写法/);
    assert.match(writerMessages(model, 2), /语料：通用底座/);
    assert.match(writerMessages(model, 3), /S5 红笔/);
  } finally {
    await host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

function lastUserText(call) {
  const message = call.messages.findLast((message) => message.role === "user");
  assert.ok(message, "写手调用缺少任务消息");
  return typeof message.content === "string"
    ? message.content
    : (message.content || []).map((part) => part.text || "").join("\n");
}

function writerPrompt(model, index) {
  const call = model.calls.filter((call) => call.model === "mock-writer")[index];
  assert.ok(call, `第 ${index + 1} 次写手调用不存在`);
  return lastUserText(call);
}

function writerContext(prompt) {
  const match = /^<writer-context>\n([^\n]+)\n<\/writer-context>\n\n/.exec(prompt);
  assert.ok(match, "任务缺少 writer-context");
  return JSON.parse(match[1]);
}

test("handoff.v2 注入形态：方法全文走 writer-method 块，writer-context 只留凭据", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-handoff-block-"));
  const { ensureStorage, createWork } = await import("../../apps/desktop/out-test/work-store.mjs");
  const appHome = path.join(base, "app");
  await mkdir(appHome);
  process.env.WRITER_STATE_ROOT = appHome;
  const paths = await ensureStorage(null, { storageRoot: path.join(base, "data") });
  const work = await createWork(paths, { title: "长夜车站" });
  const model = await fakeModel({ "mock-writer": [{ text: "开篇规划已保存。" }] });
  const logs = [];
  const { host, settle } = handoffHost(appHome, { fanqie: { handoff: { v2: true } } }, model, logs);
  const target = { mode: "fanqie", root: paths.base, work: work.meta.key };
  try {
    const step = settle();
    await host.send(target, "规划本书开篇。", { chapter: "c001", intent: "plan" });
    await step.promise;
    const prompt = writerPrompt(model, 0);
    const context = writerContext(prompt);
    assert.ok(Array.isArray(context.methods) && context.methods.length === 1);
    const [credential] = context.methods;
    assert.equal(credential.id, "plan-foundation");
    assert.equal(credential.profile, "default");
    assert.match(credential.hash, /^[0-9a-f]{64}$/);
    assert.equal("text" in credential, false);
    assert.equal(context.intent, "plan");
    const block =
      /<writer-method id="plan-foundation" hash="([0-9a-f]{64})">([\s\S]*?)<\/writer-method>\n\n/.exec(
        prompt,
      );
    assert.ok(block, "任务缺少 writer-method 块");
    assert.equal(block[1], credential.hash);
    assert.equal(
      createHash("sha256").update(block[2]).digest("hex"),
      block[1],
      "块哈希须等于块正文",
    );
    const probe = "开书立项：卖点、主角、规则、节奏档位与读者承诺";
    assert.ok(block[2].includes(probe), "块须携带方法全文");
    assert.ok(!prompt.match(/^<writer-context>\n([^\n]+)\n<\/writer-context>/)[1].includes(probe));
    assert.ok(prompt.endsWith("规划本书开篇。"));
    const handoff = logs.find((row) => row.name === "handoff");
    assert.deepEqual(handoff.methodIds, ["plan-foundation"]);
    assert.equal(handoff.methodBytes, Buffer.byteLength(block[2]));
    assert.equal("trimmedIds" in handoff, false);
  } finally {
    await host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("handoff.v2 去重：同会话第二条任务同方法只发凭据不发块", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-handoff-dedup-"));
  const { ensureStorage, createWork } = await import("../../apps/desktop/out-test/work-store.mjs");
  const appHome = path.join(base, "app");
  await mkdir(appHome);
  process.env.WRITER_STATE_ROOT = appHome;
  const paths = await ensureStorage(null, { storageRoot: path.join(base, "data") });
  const work = await createWork(paths, { title: "长夜车站" });
  const model = await fakeModel({
    "mock-writer": [{ text: "开篇规划已保存。" }, { text: "继续规划已收到。" }],
  });
  const logs = [];
  const { host, settle } = handoffHost(appHome, { fanqie: { handoff: { v2: true } } }, model, logs);
  const target = { mode: "fanqie", root: paths.base, work: work.meta.key };
  try {
    let step = settle();
    await host.send(target, "规划本书开篇。", { chapter: "c001", intent: "plan" });
    await step.promise;
    step = settle();
    await host.send(target, "继续开书规划。", { chapter: "c001", intent: "plan" });
    await step.promise;
    const first = /<writer-method id="plan-foundation" hash="([0-9a-f]{64})">/.exec(
      writerPrompt(model, 0),
    );
    assert.ok(first, "首条任务应附全文块");
    const prompt = writerPrompt(model, 1);
    assert.ok(!prompt.includes("<writer-method"), "去重后不应再发 writer-method 块");
    const context = writerContext(prompt);
    assert.equal(context.methods[0].id, "plan-foundation");
    assert.equal(context.methods[0].injected, true);
    assert.equal(context.methods[0].hash, first[1]);
    const handoffs = logs.filter((row) => row.name === "handoff");
    assert.equal(handoffs.length, 2);
    assert.deepEqual(handoffs[1].methodIds, []);
    assert.equal(handoffs[1].methodBytes, 0);
    assert.equal("trimmedIds" in handoffs[1], false);
  } finally {
    await host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("handoff.v2 去重恢复：手动压缩后同方法恢复全文块", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-handoff-restore-"));
  const { ensureStorage, createWork } = await import("../../apps/desktop/out-test/work-store.mjs");
  const appHome = path.join(base, "app");
  await mkdir(appHome);
  process.env.WRITER_STATE_ROOT = appHome;
  const paths = await ensureStorage(null, { storageRoot: path.join(base, "data") });
  const work = await createWork(paths, { title: "长夜车站" });
  const model = await fakeModel({
    "mock-writer": [
      { text: "开篇规划已保存。" },
      { text: "继续规划已收到。" },
      { text: "摘要：保留方法凭据" },
      { text: "压缩后继续规划。" },
    ],
  });
  const logs = [];
  const { host, settle } = handoffHost(
    appHome,
    { fanqie: { handoff: { v2: true } } },
    model,
    logs,
    // PI 默认保留近 20k token 不压缩，小会话需把保留预算清零才能手动压缩
    { context: () => ({ enabled: false, triggerPercent: 80, budget: 0, keepRecentTokens: 0 }) },
  );
  const target = { mode: "fanqie", root: paths.base, work: work.meta.key };
  try {
    let step = settle();
    await host.send(target, "规划本书开篇。", { chapter: "c001", intent: "plan" });
    await step.promise;
    step = settle();
    await host.send(target, "继续开书规划。", { chapter: "c001", intent: "plan" });
    await step.promise;
    assert.ok(!writerPrompt(model, 1).includes("<writer-method"), "压缩前同方法应被去重");
    const session = await host.open(target);
    await session.waitForIdle();
    await host.compact(target, "保留方法凭据");
    assert.ok(
      logs.some((row) => row.name === "context_compacted" && row.success === true),
      "手动压缩应成功",
    );
    step = settle();
    await host.send(target, "再开书规划一次。", { chapter: "c001", intent: "plan" });
    await step.promise;
    // 压缩的摘要请求也走写手模型且夹在两次任务之间，按任务内容定位压缩后的任务调用
    const prompt = model.calls
      .filter((call) => call.model === "mock-writer")
      .map(lastUserText)
      .filter((text) => text.startsWith("<writer-context>") && text.endsWith("再开书规划一次。"))
      .at(-1);
    assert.ok(prompt, "压缩后缺少第三次任务调用");
    assert.match(prompt, /<writer-method id="plan-foundation" hash="[0-9a-f]{64}">/);
    const handoffs = logs.filter((row) => row.name === "handoff");
    assert.equal(handoffs.length, 3);
    assert.deepEqual(handoffs[2].methodIds, ["plan-foundation"]);
    assert.ok(handoffs[2].methodBytes > 0);
  } finally {
    await host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("handoff.v2 预算裁剪：超限方法包按 prose→rhythm 整份裁剪并记录 trimmedIds", async () => {
  const { createProfile } = await import("../../build/core/src/profiles.js");
  const { fanqieLibrary } = await import("../../build/fanqie/src/forge.js");
  const base = await mkdtemp(path.join(tmpdir(), "writer-handoff-budget-"));
  const { ensureStorage, createWork } = await import("../../apps/desktop/out-test/work-store.mjs");
  const appHome = path.join(base, "app");
  await mkdir(appHome);
  process.env.WRITER_STATE_ROOT = appHome;
  const profile = await createProfile(fanqieLibrary, {
    name: "超限方案",
    base: "default",
    files: [
      { id: "write-chapter", text: "a".repeat(30000) },
      { id: "prose", text: "b".repeat(20000) },
      { id: "rhythm", text: "c".repeat(20000) },
    ],
  });
  const paths = await ensureStorage(null, { storageRoot: path.join(base, "data") });
  const work = await createWork(paths, { title: "长夜车站" });
  const model = await fakeModel({
    "mock-writer": [
      { name: "fanqie_outline_set", input: OUTLINE_C001 },
      { text: "开篇规划已保存。" },
      { text: "已按方法包续写。" },
    ],
  });
  const logs = [];
  const { host, settle } = handoffHost(
    appHome,
    { fanqie: { handoff: { v2: true }, profile: profile.id } },
    model,
    logs,
  );
  const target = { mode: "fanqie", root: paths.base, work: work.meta.key };
  try {
    let step = settle();
    await host.send(target, "规划本书开篇。", { chapter: "c001", intent: "plan" });
    await step.promise;
    step = settle();
    await host.send(target, "交接本章，按当前正文继续写作。", {
      chapter: "c001",
      intent: "write",
    });
    await step.promise;
    const handoffs = logs.filter((row) => row.name === "handoff");
    assert.equal(handoffs.length, 2);
    assert.equal("trimmedIds" in handoffs[0], false);
    assert.deepEqual(handoffs[1].trimmedIds, ["prose", "rhythm"]);
    assert.deepEqual(handoffs[1].methodIds, ["write-chapter"]);
    assert.equal(handoffs[1].methodBytes, 30000);
    const prompt = writerPrompt(model, 2);
    assert.match(prompt, /<writer-method id="write-chapter" hash="[0-9a-f]{64}">/);
    assert.ok(!prompt.includes('<writer-method id="prose"'), "prose 被裁不应有块");
    assert.ok(!prompt.includes('<writer-method id="rhythm"'), "rhythm 被裁不应有块");
    assert.match(prompt, /预算裁剪：prose 未随交接附上，需要时 fanqie_method_get 读取/);
    assert.match(prompt, /预算裁剪：rhythm 未随交接附上，需要时 fanqie_method_get 读取/);
    const context = writerContext(prompt);
    assert.deepEqual(
      context.methods.map((method) => [method.id, "note" in method, "injected" in method]),
      [
        ["write-chapter", false, false],
        ["rhythm", true, false],
        ["prose", true, false],
      ],
    );
  } finally {
    await host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("章级会话：perChapter 开启跨章自动新对话，同章续写与关闭开关都留在原会话", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-per-chapter-"));
  const { ensureStorage, createWork } = await import("../../apps/desktop/out-test/work-store.mjs");
  const appHome = path.join(base, "app");
  await mkdir(appHome);
  process.env.WRITER_STATE_ROOT = appHome;
  const paths = await ensureStorage(null, { storageRoot: path.join(base, "data") });
  const work = await createWork(paths, { title: "长夜车站" });
  const model = await fakeModel({
    "mock-writer": [
      { text: "c001 已按简报续写。" },
      { text: "c002 已按简报续写。" },
      { text: "c002 已按回报修改。" },
      { text: "c003 已按简报续写。" },
    ],
  });
  const logs = [];
  const { host, settle } = handoffHost(
    appHome,
    { fanqie: { session: { perChapter: true } } },
    model,
    logs,
  );
  const plain = handoffHost(appHome, {}, model, logs);
  const target = { mode: "fanqie", root: paths.base, work: work.meta.key };
  try {
    let step = settle();
    await host.send(target, "交接本章，按当前正文继续写作。", { chapter: "c001", intent: "write" });
    await step.promise;
    const first = await host.open(target);
    assert.equal((await host.conversations(target)).length, 0);

    // 跨章投递：自动开新对话，旧会话进历史
    step = settle();
    await host.send(target, "交接本章，按当前正文继续写作。", { chapter: "c002", intent: "write" });
    await step.promise;
    assert.equal((await host.conversations(target)).length, 1);
    assert.notEqual((await host.open(target)).sessionId, first.sessionId);

    // 同章续写：仍在当前会话
    step = settle();
    await host.send(target, "按审读意见修改本章。", { chapter: "c002", intent: "revise" });
    await step.promise;
    assert.equal((await host.conversations(target)).length, 1);
    const sameChapter = await host.open(target);

    // 关闭开关（新 host 读同一 target）：跨章也不再轮换
    step = plain.settle();
    await plain.host.send(target, "交接本章，按当前正文继续写作。", {
      chapter: "c003",
      intent: "write",
    });
    await step.promise;
    assert.equal((await plain.host.conversations(target)).length, 1);
    assert.equal((await plain.host.open(target)).sessionId, sameChapter.sessionId);
  } finally {
    await host.dispose();
    await plain.host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("主动压缩：写手结算空闲后达窗口 75% 自动整理并带写作保留指令，关闭时不触发", async () => {
  for (const enabled of [true, false]) {
    const home = await mkdtemp(path.join(tmpdir(), "writer-proactive-"));
    const target = { mode: "toutiao", root: path.join(home, "articles") };
    const model = await fakeModel({
      "mock-writer": [
        { text: "长任务完成。", usage: { prompt_tokens: 60000, completion_tokens: 10 } },
        { text: "摘要：保留作者约束。" },
      ],
    });
    const value = models(model.url);
    for (const role of Object.values(value)) if (role) role.contextWindow = 80000; // PI 自动压缩阈值按 80% 算为 63616，主动阈值 60000 先触发
    const logs = [];
    const done = settled(),
      packed = enabled ? settled() : undefined;
    const host = new Sessions({
      home,
      python: "python3",
      settings: () => value,
      emit: (event) => {
        if (event.event?.type === "agent_settled") done.finish();
        if (event.event?.type === "compaction_end") packed?.finish();
      },
      confirm: async () => false,
      options: { toutiao: { session: { proactiveCompact: enabled } } },
      created: async () => {},
      extras: {
        log: (name, fields) => logs.push({ name, ...fields }),
        // PI 默认保留近 20k token 不压缩，小会话需把保留预算清零
        context: () => ({ enabled: true, triggerPercent: 80, budget: 0, keepRecentTokens: 0 }),
      },
    });
    try {
      await host.send(target, "作者约束：主角不能飞。");
      await done.promise;
      const usage = (await host.open(target)).getContextUsage();
      assert.ok(usage && usage.tokens >= 60000, "前置：结算后用量须达到主动压缩阈值");
      if (enabled) {
        await packed.promise;
        const compacted = logs.filter((row) => row.name === "context_compacted");
        assert.equal(compacted.length, 1);
        assert.equal(compacted[0].trigger, "manual", "主动压缩走手动路径，trigger 记 manual");
        assert.equal(compacted[0].success, true);
        assert.ok(compacted[0].tokensBefore >= 60000);
        assert.ok(
          model.calls.some((call) =>
            JSON.stringify(call.messages).includes("保留作者限制、已确定事实"),
          ),
          "压缩摘要请求须携带写作保留指令前缀",
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(logs.filter((row) => row.name === "context_compacted").length, 0);
      }
    } finally {
      await host.dispose();
      await model.close();
      await rm(home, { recursive: true, force: true });
    }
  }
});

test("writer_remember：作者约束落盘并随下一条任务注入", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-remember-"));
  process.env.WRITER_STATE_ROOT = home;
  const settings = new Settings(home, {
    available: () => false,
    encrypt: (text) => text,
    decrypt: (text) => text,
  });
  await settings.load();
  settings.workspace = home;
  const target = { mode: "toutiao", root: path.join(home, "articles") };
  const model = await fakeModel({
    "mock-writer": [
      { name: "writer_remember", input: { text: "主角不能飞。" } },
      { text: "已记住。" },
      { text: "带偏好继续任务。" },
    ],
  });
  let onSettled = () => {};
  const host = new Sessions({
    home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      if (event.event?.type === "agent_settled") onSettled();
    },
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {
      preferences: () => settings.preferences(),
      savePreferences: (text) => settings.savePreferences(text),
    },
  });
  try {
    const first = settled();
    onSettled = first.finish;
    await host.send(target, "请记住：主角不能飞。");
    await first.promise;
    assert.match(await settings.preferences(), /- \d{4}-\d{2}-\d{2} 主角不能飞。/);
    const session = await host.open(target);
    const tool = session.agent.state.tools.find((item) => item.name === "writer_remember");
    assert.ok(tool, "写手会话须注册 writer_remember");
    await assert.rejects(tool.execute("empty", { text: "  " }), /不能为空/);
    await assert.rejects(tool.execute("long", { text: "长".repeat(501) }), /500 字/);
    const second = settled();
    onSettled = second.finish;
    await host.send(target, "带偏好继续任务。");
    await second.promise;
    assert.match(writerPrompt(model, 2), /主角不能飞。/, "下一条任务的 writer-context 须带偏好");
  } finally {
    await host.dispose();
    await model.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("主动压缩判定：75% 恰好触发，窗口无效或用量未知不触发", async () => {
  const { shouldProactivelyCompact } =
    await import("../../apps/desktop/out-test/context-settings.mjs");
  assert.equal(shouldProactivelyCompact({ tokens: 300, contextWindow: 400 }), true);
  assert.equal(shouldProactivelyCompact({ tokens: 299, contextWindow: 400 }), false);
  assert.equal(shouldProactivelyCompact({ tokens: 6000, contextWindow: 0 }), false);
  assert.equal(shouldProactivelyCompact({ tokens: 6000, contextWindow: undefined }), false);
  assert.equal(shouldProactivelyCompact({ tokens: null, contextWindow: 80000 }), false);
  assert.equal(shouldProactivelyCompact(undefined), false);
});

// —— T13 抽卡（writer_draw）：draw.enabled 开关注册、并发起草候选、编辑评估排序、用量回加 ——

const DRAW_OUTLINE = {
  pov: "“我”第一人称",
  targetWords: 2500,
  locks: "两张车票，明天八点四十",
  knowledge: "迟川不知道剧团的事",
  synopsis: "我把车票推给迟川",
  conflict: "他发现我已答应剧团",
  beats: "推票—追问—摊牌",
  ending: "他问什么时候",
};

async function makeDrawWork(data) {
  const { ensureStorage, createWork, setOutline } =
    await import("../../apps/desktop/out-test/work-store.mjs");
  // 桌面侧 target.root 即存储根：works 直接在 <root>/works（与 createSession 的 storageRoot 语义一致）。
  const paths = await ensureStorage(null, { storageRoot: data });
  const { dir, meta } = await createWork(paths, { title: "长夜车站" });
  await setOutline(dir, "c001", DRAW_OUTLINE, "第一章 站台");
  return { dir, key: meta.key };
}

test("抽卡：writer_draw 并发起草候选、编辑评估排序与用量回加；n 超上限被钳制", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-draw-")),
    home = path.join(base, "app"),
    data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.WRITER_STATE_ROOT = home;
  const model = await fakeModel({
    "mock-writer": [
      { name: "writer_draw", input: { scenario: "opening", chapter: "c001", n: 1 } },
      {
        name: "fanqie_candidate_stage",
        input: {
          chapter: "c001",
          content: "开头一版：林川把票递到窗口，售票员先看了眼墙上的钟。",
          draft_label: "抽卡-1",
          note: "抽卡起草（本章开头）",
        },
      },
      { text: "开头这一版已暂存。" },
      { text: "排序已交回，请作者挑选。" },
      { name: "writer_draw", input: { scenario: "chapter-end", chapter: "c001", n: 5 } },
      {
        name: "fanqie_candidate_stage",
        input: {
          chapter: "c001",
          content: "章末一版：门开了，站台空无一人。",
          draft_label: "抽卡-1",
          note: "抽卡起草（本章章末）",
        },
      },
      { text: "章末这一版已暂存。" },
      { text: "第二批排序已交回。" },
    ],
    "mock-editor": [
      { text: '[{"label":"抽卡-1","score":19,"reason":"钩子具体，局面推进明确"}]' },
      { text: '[{"label":"抽卡-1","score":21,"reason":"残局具体"}]' },
    ],
  });
  const done = settled(),
    events = [];
  let onSettled = done.finish;
  const { dir, key } = await makeDrawWork(data);
  const sessions = new Sessions({
    home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      events.push(event);
      if (event.event?.type === "agent_settled" && !event.editor) onSettled();
    },
    confirm: async () => false,
    options: { fanqie: { draw: { enabled: true, max: 1 } } },
    created: async () => {},
    extras: {},
  });
  try {
    const writerCalls = () => model.calls.filter((call) => call.model === "mock-writer");
    const drawEnds = () =>
      events.filter(
        (event) =>
          event.event?.type === "tool_execution_end" && event.event.toolName === "writer_draw",
      );
    await sessions.send({ mode: "fanqie", root: data, work: key }, "抽卡本章开头。", {
      chapter: "c001",
      intent: "write",
    });
    await done.promise;
    assert.ok(
      writerCalls()[0].tools.some((tool) => tool.function.name === "writer_draw"),
      "draw.enabled 时写手工具须含 writer_draw",
    );
    assert.equal(drawEnds().length, 1);
    const result = drawEnds()[0].event.result;
    assert.deepEqual(result.details.draws, [
      { label: "抽卡-1", score: 19, reasons: "钩子具体，局面推进明确" },
    ]);
    assert.match(result.content[0].text, /抽卡评估 · 本章开头/);
    assert.match(result.content[0].text, /1\. 抽卡-1 · 19 分：钩子具体，局面推进明确/);
    assert.match(result.content[0].text, /fanqie_chapter_drafts/);
    const { listCandidates } = await import("../../apps/desktop/out-test/work-store.mjs");
    const staged = (await listCandidates(dir)).filter((row) => row.note === "抽卡起草（本章开头）");
    assert.equal(staged.length, 1);
    assert.equal(staged[0].draftLabel, "抽卡-1");
    const laneCall = writerCalls().find((call) =>
      JSON.stringify(call.messages).includes("抽卡起草 抽卡-1"),
    );
    assert.ok(laneCall, "起草子会话须拿到带序号的任务");
    assert.ok(laneCall.tools.some((tool) => tool.function.name === "fanqie_candidate_stage"));
    assert.ok(
      !laneCall.tools.some((tool) => tool.function.name === "writer_draw"),
      "起草子会话不递归注册抽卡",
    );
    assert.ok(
      JSON.stringify(laneCall.messages).includes("抽卡起草会话"),
      "起草子会话系统提示带只起草约束",
    );
    const evaluator = model.calls.find((call) => call.model === "mock-editor");
    assert.ok(JSON.stringify(evaluator.messages).includes("开头一版"));
    assert.ok(JSON.stringify(evaluator.messages).includes("局面改变"));
    assert.ok(drawEnds()[0].task.usage.input >= 120, "起草子会话与评估会话的用量须回加父任务");
    const second = settled();
    onSettled = second.finish;
    await sessions.send({ mode: "fanqie", root: data, work: key }, "抽卡本章章末。", {
      chapter: "c001",
      intent: "write",
    });
    await second.promise;
    assert.equal(drawEnds().length, 2);
    assert.equal(drawEnds()[1].event.result.details.draws.length, 1);
    assert.equal(drawEnds()[1].event.result.details.failed, undefined);
    assert.match(drawEnds()[1].event.result.content[0].text, /抽卡评估 · 本章章末/);
  } finally {
    await sessions.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("抽卡：单路起草失败其余成功时交回部分结果", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-draw-partial-")),
    home = path.join(base, "app"),
    data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.WRITER_STATE_ROOT = home;
  const model = await fakeModel({
    "mock-writer": [
      { name: "writer_draw", input: { scenario: "opening", chapter: "c001", n: 2 } },
      {
        name: "fanqie_candidate_stage",
        input: {
          chapter: "c001",
          content: "开头一版：林川把票递到窗口。",
          draft_label: "抽卡-1",
          note: "抽卡起草（本章开头）",
        },
      },
    ],
    "mock-editor": [{ text: '[{"label":"抽卡-1","score":12,"reason":"可用但偏平"}]' }],
  });
  const done = settled(),
    events = [];
  let onSettled = done.finish;
  const { key } = await makeDrawWork(data);
  const sessions = new Sessions({
    home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      events.push(event);
      if (event.event?.type === "agent_settled" && !event.editor) onSettled();
    },
    confirm: async () => false,
    options: { fanqie: { draw: { enabled: true, max: 2 } } },
    created: async () => {},
    extras: {},
  });
  try {
    await sessions.send({ mode: "fanqie", root: data, work: key }, "抽卡本章开头。", {
      chapter: "c001",
      intent: "write",
    });
    await done.promise;
    const end = events.find(
      (event) =>
        event.event?.type === "tool_execution_end" && event.event.toolName === "writer_draw",
    );
    assert.ok(end, "writer_draw 须正常交回而不是整单失败");
    assert.equal(end.event.result.details.draws.length, 1);
    assert.equal(end.event.result.details.failed.length, 1);
    assert.match(end.event.result.details.failed[0], /起草会话没有暂存候选/);
    assert.match(end.event.result.content[0].text, /失败的路/);
    assert.match(end.event.result.content[0].text, /1\. 抽卡-1 · 12 分：可用但偏平/);
  } finally {
    await sessions.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("抽卡开关关闭时 writer_draw 不注册", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-draw-off-")),
    home = path.join(base, "app"),
    data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.WRITER_STATE_ROOT = home;
  const model = await fakeModel({ "mock-writer": [{ text: "收到，先读材料。" }] });
  const done = settled();
  let onSettled = done.finish;
  const { key } = await makeDrawWork(data);
  const sessions = new Sessions({
    home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      if (event.event?.type === "agent_settled" && !event.editor) onSettled();
    },
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {},
  });
  try {
    await sessions.send({ mode: "fanqie", root: data, work: key }, "先读本章材料。", {
      chapter: "c001",
      intent: "write",
    });
    await done.promise;
    const call = model.calls.find((item) => item.model === "mock-writer");
    assert.ok(call.tools.some((tool) => tool.function.name === "fanqie_candidate_stage"));
    assert.ok(!call.tools.some((tool) => tool.function.name === "writer_draw"));
  } finally {
    await sessions.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("写作台抽卡投递：指令带 writer_draw 场景并要求转报作者，抽卡须指明章节", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-draw-delivery-")),
    data = path.join(base, "data");
  await mkdir(data);
  const { dir } = await makeDrawWork(data);
  const outfile = path.join(base, "delivery.mjs");
  const { build } = await import("esbuild");
  await build({
    entryPoints: [path.join(root, "packages/fanqie/src/workbench/delivery.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile,
    logLevel: "silent",
  });
  try {
    const { buildDeliveryPrompt, DELIVERY_ACTIONS } = await import(pathToFileURL(outfile).href);
    assert.ok(DELIVERY_ACTIONS.includes("draw-opening"));
    assert.ok(DELIVERY_ACTIONS.includes("draw-chapter-end"));
    const opening = await buildDeliveryPrompt(dir, { action: "draw-opening", chapter: "c001" });
    assert.equal(opening.chapterId, "c001");
    assert.match(opening.text, /writer_draw（scenario="opening"）/);
    assert.match(opening.text, /不要自动采纳/);
    const ending = await buildDeliveryPrompt(dir, { action: "draw-chapter-end", chapter: "c001" });
    assert.match(ending.text, /writer_draw（scenario="chapter-end"）/);
    await assert.rejects(
      buildDeliveryPrompt(dir, { action: "draw-chapter-end" }),
      /抽卡须指明章节/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// —— T16 头条标题抽卡：writer_draw 仅 title-brief（五母体各一版），评估按 s3 四问排序，不代作者采纳 ——

const TOUTIAO_DRAW_TITLES = [
  "交了二十多年社保，我到退休才发现少算了一笔钱",
  "家里有六十岁以上老人的，月底前这件事别忘了办",
  "房租能全额提公积金了，他看完细则却把手机合上了",
  "早说啊，我白跑三趟！去办这事前先看清这一条",
  "明年元旦以后，回收旧手机得先清数据",
];

test("头条标题抽卡：五母体各一版、按四问分数排序、指回 toutiao_headline_set；opening 场景拒绝", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-tt-draw-")),
    home = path.join(base, "app"),
    data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.WRITER_STATE_ROOT = home;
  const store = new ArticleStore(data);
  const article = await store.create("headline-draw", { line: "资讯线", genre: "短图文" });
  await store.stageDraft(
    article.id,
    "老周把手机扣在柜台上。\n\n他数了三遍零钱。",
    "writer",
    "初稿",
  );
  const model = await fakeModel({
    "mock-writer": [
      { name: "writer_draw", input: { scenario: "title-brief" } },
      ...TOUTIAO_DRAW_TITLES.map((title) => ({ text: title })),
      { text: "排序已交回，请作者挑选。" },
    ],
    "mock-editor": [
      {
        text: JSON.stringify([
          { label: "抽卡-3", score: 5, reason: "反常动作具体，缺口清楚" },
          { label: "抽卡-2", score: 4, reason: "人群点名明确" },
          { label: "抽卡-5", score: 4, reason: "节点与代价都在" },
          { label: "抽卡-1", score: 3, reason: "数字反差但认不出是谁" },
          { label: "抽卡-4", score: 2, reason: "原话缺现场" },
        ]),
      },
    ],
  });
  const done = settled(),
    events = [];
  let onSettled = done.finish;
  const sessions = new Sessions({
    home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      events.push(event);
      if (event.event?.type === "agent_settled" && !event.editor) onSettled();
    },
    confirm: async () => false,
    options: { toutiao: { draw: { enabled: true } } },
    created: async () => {},
    extras: {},
  });
  try {
    await sessions.send(
      { mode: "toutiao", root: data, article: article.id },
      "给这篇抽五个标题。",
      { article: article.id, intent: "write" },
    );
    await done.promise;
    const writerCalls = () => model.calls.filter((call) => call.model === "mock-writer");
    assert.ok(
      writerCalls()[0].tools.some((tool) => tool.function.name === "writer_draw"),
      "toutiao draw.enabled 时写手工具须含 writer_draw（create.ts 注册条件须改为 host.options[target.mode]?.draw?.enabled === true，并给 createDrawTools 传 toutiaoDrawMax）",
    );
    const end = events.find(
      (event) =>
        event.event?.type === "tool_execution_end" && event.event.toolName === "writer_draw",
    );
    assert.ok(end, "writer_draw 须交回结果");
    assert.deepEqual(end.event.result.details.draws, [
      { label: "抽卡-3", score: 5, reasons: "反常动作具体，缺口清楚" },
      { label: "抽卡-2", score: 4, reasons: "人群点名明确" },
      { label: "抽卡-5", score: 4, reasons: "节点与代价都在" },
      { label: "抽卡-1", score: 3, reasons: "数字反差但认不出是谁" },
      { label: "抽卡-4", score: 2, reasons: "原话缺现场" },
    ]);
    const text = end.event.result.content[0].text;
    assert.match(text, /抽卡评估 · 标题五母体/);
    assert.match(text, /toutiao_headline_set/);
    assert.match(text, /不要代作者选/);
    // 五路起草各自指定一个母体
    const laneCalls = writerCalls().filter((call) =>
      JSON.stringify(call.messages).includes("只用母体「"),
    );
    assert.equal(laneCalls.length, 5, JSON.stringify(laneCalls.length));
    const matrices = laneCalls.map(
      (call) => /只用母体「([^」]+)」/.exec(JSON.stringify(call.messages))[1],
    );
    assert.deepEqual([...matrices].sort(), [
      "原话现场式",
      "悬念缺口式",
      "数字反差式",
      "时间坐标式",
      "身份点名式",
    ]);
    const evaluator = model.calls.find((call) => call.model === "mock-editor");
    assert.ok(JSON.stringify(evaluator.messages).includes("画得出来吗"));
    assert.ok(JSON.stringify(evaluator.messages).includes("接得住吗"));
    assert.ok(JSON.stringify(evaluator.messages).includes("【正文前两段】"));
    // 头条抽卡只允许 title-brief
    const session = await sessions.open({ mode: "toutiao", root: data, article: article.id });
    const drawTool = session.agent.state.tools.find((tool) => tool.name === "writer_draw");
    await assert.rejects(
      drawTool.execute("x", { scenario: "opening" }, new AbortController().signal),
      /title-brief/,
    );
  } finally {
    await sessions.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("头条标题抽卡：n 超上限被钳制；开关关闭不注册", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-tt-draw-clamp-")),
    home = path.join(base, "app"),
    data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.WRITER_STATE_ROOT = home;
  const store = new ArticleStore(data);
  const article = await store.create("headline-clamp", { line: "故事线", genre: "短图文" });
  const model = await fakeModel({
    "mock-writer": [
      { name: "writer_draw", input: { scenario: "title-brief", n: 9 } },
      { text: "精卫填了一辈子海，原典没写海填平了没有" },
      { text: "后羿射完太阳以后，第一个疏远他的是谁" },
      { text: "两版已交回。" },
    ],
    "mock-editor": [
      {
        text: '[{"label":"抽卡-2","score":4,"reason":"缺口具体"},{"label":"抽卡-1","score":3,"reason":"可用"}]',
      },
    ],
  });
  const done = settled(),
    events = [];
  let onSettled = done.finish;
  const sessions = new Sessions({
    home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      events.push(event);
      if (event.event?.type === "agent_settled" && !event.editor) onSettled();
    },
    confirm: async () => false,
    options: { toutiao: { draw: { enabled: true, max: 2 } } },
    created: async () => {},
    extras: {},
  });
  try {
    await sessions.send({ mode: "toutiao", root: data, article: article.id }, "抽标题。", {
      article: article.id,
      intent: "write",
    });
    await done.promise;
    const laneCalls = model.calls.filter(
      (call) =>
        call.model === "mock-writer" && JSON.stringify(call.messages).includes("只用母体「"),
    );
    assert.equal(laneCalls.length, 2, "n=9 被钳到 draw.max=2");
    const end = events.find(
      (event) =>
        event.event?.type === "tool_execution_end" && event.event.toolName === "writer_draw",
    );
    assert.equal(end.event.result.details.draws.length, 2);
  } finally {
    await sessions.dispose();
    await model.close();
  }

  const offModel = await fakeModel({ "mock-writer": [{ text: "收到。" }] });
  const offDone = settled();
  let offSettled = offDone.finish;
  const offSessions = new Sessions({
    home,
    python: "python3",
    settings: () => models(offModel.url),
    emit: (event) => {
      if (event.event?.type === "agent_settled" && !event.editor) offSettled();
    },
    confirm: async () => false,
    options: {},
    created: async () => {},
    extras: {},
  });
  try {
    await offSessions.send(
      { mode: "toutiao", root: data, article: article.id },
      "先读一下这篇文章。",
      { article: article.id, intent: "inspect" },
    );
    await offDone.promise;
    const call = offModel.calls.find((item) => item.model === "mock-writer");
    assert.ok(call.tools.some((tool) => tool.function.name === "toutiao_draft_get"));
    assert.ok(!call.tools.some((tool) => tool.function.name === "writer_draw"));
  } finally {
    await offSessions.dispose();
    await offModel.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("handoff.v2 头条 S4 反馈软上限 1000 字：装最新的，截掉最旧的", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-tt-fb-cap-"));
  process.env.WRITER_STATE_ROOT = base;
  const root = path.join(base, "articles");
  const store = new ArticleStore(root);
  const article = await store.create("fb-cap", { date: "2026-11-06", line: "资讯线" });
  await store.writeCard(article.id, { 内容线: "资讯线" });
  await store.update(article.id, (m) => {
    m.headlines.main = "软上限主标题";
  });
  await store.stageDraft(article.id, "初稿正文。", "writer", "初稿");
  const lines = ["# 作者改稿反馈", ""];
  for (let i = 0; i < 40; i += 1)
    lines.push(
      `- 2026-10-${String(20 + (i % 10)).padStart(2, "0")}：第${i}条很长的一句话原句 → 改后也长的一句话 → 动机说明也要占字数 ｜ 病型=1·套话连接词`,
    );
  await writeFile(path.join(root, "feedback.md"), lines.join("\n"), "utf8");
  const model = await fakeModel({ "mock-writer": [{ text: "收到。" }] });
  const { host, settle } = handoffHost(base, { toutiao: { handoff: { v2: true } } }, model, []);
  const target = { mode: "toutiao", root, article: article.id };
  try {
    const step = settle();
    await host.send(target, "开始写正文", { article: article.id });
    await step.promise;
    const context = writerContext(writerPrompt(model, 0));
    const block = context.saved.feedback;
    assert.ok(block.length <= 1100, `反馈块 ${block.length} 字超出软上限`);
    assert.match(block, /第39条/, "最新一条必须在");
    assert.ok(!block.includes("第0条"), "最旧的被截掉");
  } finally {
    await host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("qa.judge 开启：writer_review 任务附九项标尺，读者评审落到 meta.qa 最近一条；关闭时保持现行为", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-tt-judge-")),
    home = path.join(base, "app"),
    data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.WRITER_STATE_ROOT = home;
  const store = new ArticleStore(data);
  const article = await store.create("judge-me", { line: "资讯线", genre: "短图文" });
  await store.stageDraft(
    article.id,
    "# 测试标题\n\n老周把手机扣在柜台上，数了三遍零钱。\n\n他没说话，先把围裙解了下来。\n\n评论区聊聊。",
    "writer",
    "初稿",
  );
  const REVIEW_JSON = JSON.stringify({
    scores: {
      标题: 3,
      开篇三段: 4,
      人物: 4,
      引语: 2,
      延伸: 3,
      节奏: 4,
      结尾: 3,
      不像模板: 4,
      读完意愿: 3,
    },
    evidences: Object.fromEntries(
      ["标题", "开篇三段", "人物", "引语", "延伸", "节奏", "结尾", "不像模板", "读完意愿"].map(
        (k) => [k, `${k}的一句证据`],
      ),
    ),
  });
  const runCase = async (options, judgeOn) => {
    const model = await fakeModel({
      "mock-writer": [
        { name: "writer_review", input: { task: "红笔并质检这篇", article: article.id } },
        { text: "已收到编辑回报。" },
      ],
      "mock-editor": [
        { name: "toutiao_qa_check", input: { id: article.id } },
        {
          text: judgeOn ? `红笔完成，读者评审：\n${REVIEW_JSON}` : "红笔完成，改了三处。",
        },
      ],
    });
    const done = settled(),
      events = [];
    let onSettled = done.finish;
    const sessions = new Sessions({
      home,
      python: "python3",
      settings: () => models(model.url),
      emit: (event) => {
        events.push(event);
        if (event.event?.type === "agent_settled" && !event.editor) onSettled();
      },
      confirm: async () => true,
      options,
      created: async () => {},
      extras: {},
    });
    try {
      await sessions.send(
        { mode: "toutiao", root: data, article: article.id },
        "派编辑审读这篇。",
        { article: article.id, intent: "review" },
      );
      await done.promise;
      const end = events.find(
        (event) =>
          event.event?.type === "tool_execution_end" && event.event.toolName === "writer_review",
      );
      assert.ok(end, "writer_review 须交回报");
      return end.event.result.details.writerResult.summary;
    } finally {
      await sessions.dispose();
      await model.close();
    }
  };
  try {
    const onSummary = await runCase({ toutiao: { qa: { judge: true } } }, true);
    assert.match(onSummary, /读者评审已记入 meta.qa 最近一条/);
    assert.match(onSummary, /读完意愿 3 分/);
    const meta = await store.get(article.id);
    assert.equal(meta.qa.length, 1);
    assert.equal(meta.qa[0].readerReview.scores["不像模板"], 4);
    assert.equal(meta.qa[0].readerReview.rev, 1);
    const offSummary = await runCase({}, false);
    assert.doesNotMatch(offSummary, /读者评审/);
    const offMeta = await store.get(article.id);
    assert.equal(offMeta.qa.length, 2);
    assert.equal(offMeta.qa[1].readerReview, undefined);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("handoff.v2 头条 S4 交接附最近作者反馈：故事线病型只给故事线，软上限 1000 字", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-tt-fb-"));
  process.env.WRITER_STATE_ROOT = base;
  const root = path.join(base, "articles");
  const store = new ArticleStore(root);
  const article = await store.create("fb-me", { date: "2026-11-06", line: "资讯线" });
  await store.writeCard(article.id, { 内容线: "资讯线" });
  await store.update(article.id, (m) => {
    m.headlines.main = "测试主标题";
  });
  await store.stageDraft(article.id, "初稿正文。", "writer", "初稿");
  const feedback = [
    "# 作者改稿反馈",
    "",
    "- 2026-10-31：故事病一句 → 改后一句 → 更像说书 ｜ 病型=G2·寓意说教 ｜ 位置=结尾",
    "- 2026-11-01：铺垫一句 → 改后一句 → 更直给 ｜ 病型=8·万能背景开头",
    "- 2026-11-02：空话一句 → 改后一句 → 更具体 ｜ 病型=3·大词空转 ｜ 改法=落到具体的人",
    "- 2026-11-03：流水账一段 → 改后一段 → 有起伏 ｜ 位置=第 2 段",
  ].join("\n");
  await writeFile(path.join(root, "feedback.md"), feedback, "utf8");
  const model = await fakeModel({ "mock-writer": [{ text: "收到。" }] });
  const logs = [];
  const { host, settle } = handoffHost(base, { toutiao: { handoff: { v2: true } } }, model, logs);
  const target = { mode: "toutiao", root, article: article.id };
  try {
    const step = settle();
    await host.send(target, "开始写正文", { article: article.id });
    await step.promise;
    const context = writerContext(writerPrompt(model, 0));
    assert.match(context.saved.feedback, /作者改稿反馈（最近）：/);
    assert.match(context.saved.feedback, /病型=3·大词空转/);
    assert.match(context.saved.feedback, /位置=第 2 段/);
    assert.ok(!context.saved.feedback.includes("G2·寓意说教"), "故事线病型不给资讯线");
    // 故事线文章：故事病型随附
    const story = await store.create("fb-story", { date: "2026-11-06", line: "故事线" });
    await store.writeCard(story.id, { 内容线: "故事线" });
    await store.update(story.id, (m) => {
      m.headlines.main = "故事主标题";
    });
    await store.stageDraft(story.id, "故事初稿。", "writer", "初稿");
    const model2 = await fakeModel({ "mock-writer": [{ text: "收到。" }] });
    const host2 = handoffHost(base, { toutiao: { handoff: { v2: true } } }, model2, []);
    try {
      const step2 = host2.settle();
      await host2.host.send({ mode: "toutiao", root, article: story.id }, "开始写正文", {
        article: story.id,
      });
      await step2.promise;
      const storyContext = writerContext(writerPrompt(model2, 0));
      assert.match(storyContext.saved.feedback, /病型=G2·寓意说教/);
      assert.match(storyContext.saved.feedback, /病型=3·大词空转/);
    } finally {
      await host2.host.dispose();
      await model2.close();
    }
  } finally {
    await host.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

// —— T17 改稿学习（writer_revision_learn / writer_revision_decide）：learn.enabled 开关注册、
// 改稿对收集、归纳候选落盘 learn-pending.json、作者确认后写 foundation.style / feedback.md ——

const LEARN_EDITOR_JSON =
  '[{"condition":"对话推进到关键决定时","change":"把总结性叙述改成动作与原话","why":"作者嫌总结腔",' +
  '"example":{"before":"林川很犹豫。","after":"林川把票捏又放下。"},"source":"c001","count":3}]';
const LEARN_CANDIDATE_ID = createHash("sha256")
  .update("对话推进到关键决定时\n把总结性叙述改成动作与原话")
  .digest("hex");

async function makeLearnWork(data) {
  const { ensureStorage, createWork, setOutline, updateChapter, findChapter } =
    await import("../../apps/desktop/out-test/work-store.mjs");
  const paths = await ensureStorage(null, { storageRoot: data });
  const { dir, meta } = await createWork(paths, { title: "长夜车站" });
  await setOutline(dir, "c001", DRAW_OUTLINE, "第一章 站台");
  await updateChapter(dir, {
    id: "c001",
    body: "林川把票递到窗口。他站了很久，还是很犹豫。\n\n售票员看了他一眼，没说话。",
  });
  const before = await findChapter(dir, "c001");
  // 与写作台阅读面板保存正文同一条生产路径：updateChapter + 面板专用 ledgerEntry。
  await updateChapter(dir, {
    id: "c001",
    body: "林川把票捏在手里又放下，转身走向检票口。\n\n“我不去了。”他说。",
    expectedRevision: before.revision,
    ledgerEntry: "作者在阅读面板保存正文",
  });
  return { dir, key: meta.key };
}

function learnSessions(home, model, options, events, settle) {
  return new Sessions({
    home,
    python: "python3",
    settings: () => models(model.url),
    emit: (event) => {
      events.push(event);
      if (event.event?.type === "agent_settled" && !event.editor) settle();
    },
    confirm: async () => true,
    options,
    created: async () => {},
    extras: {},
  });
}

test("改稿学习：番茄收集阅读面板改稿对、归纳候选落盘、作者采纳进 foundation.style", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-learn-fanqie-")),
    home = path.join(base, "app"),
    data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.WRITER_STATE_ROOT = home;
  const model = await fakeModel({
    "mock-writer": [
      { name: "writer_revision_learn", input: {} },
      { text: "候选已列出，请作者决定。" },
      { name: "writer_revision_decide", input: { id: LEARN_CANDIDATE_ID, action: "accept" } },
      { text: "已按作者决定采纳。" },
    ],
    "mock-editor": [{ text: LEARN_EDITOR_JSON }],
  });
  const done = settled(),
    events = [];
  let onSettled = done.finish;
  const { dir, key } = await makeLearnWork(data);
  const sessions = learnSessions(
    home,
    model,
    { fanqie: { learn: { enabled: true } } },
    events,
    () => onSettled(),
  );
  const pendingFile = path.join(dir, "learn-pending.json");
  try {
    const writerCalls = () => model.calls.filter((call) => call.model === "mock-writer");
    await sessions.send({ mode: "fanqie", root: data, work: key }, "学习我的改稿。", {
      chapter: "c001",
      intent: "write",
    });
    await done.promise;
    assert.ok(
      writerCalls()[0].tools.some((tool) => tool.function.name === "writer_revision_learn"),
      "learn.enabled 时写手工具须含 writer_revision_learn",
    );
    assert.ok(
      writerCalls()[0].tools.some((tool) => tool.function.name === "writer_revision_decide"),
    );
    const end = events.find(
      (event) =>
        event.event?.type === "tool_execution_end" &&
        event.event.toolName === "writer_revision_learn",
    );
    assert.ok(end, "writer_revision_learn 须交回结果");
    assert.equal(end.event.result.details.learn.pairs, 1);
    assert.equal(end.event.result.details.learn.items[0].id, LEARN_CANDIDATE_ID);
    assert.match(end.event.result.content[0].text, /改稿学习候选 · 1 条/);
    assert.match(end.event.result.content[0].text, /作者明确确认前不要调用 writer_revision_decide/);
    const editorText = JSON.stringify(
      model.calls.find((call) => call.model === "mock-editor").messages,
    );
    assert.ok(editorText.includes("作者在阅读面板改稿"), "改稿对须带来源与方式");
    assert.ok(editorText.includes("林川把票递到窗口"), "归纳输入须含前版正文");
    assert.ok(editorText.includes("把票捏在手里又放下"), "归纳输入须含后版正文");
    const pending = JSON.parse(await readFile(pendingFile, "utf8"));
    assert.equal(pending.mode, "fanqie");
    assert.equal(pending.items.length, 1);
    assert.equal(pending.items[0].count, 3);
    const second = settled();
    onSettled = second.finish;
    await sessions.send({ mode: "fanqie", root: data, work: key }, "采纳那一条。", {
      chapter: "c001",
      intent: "write",
    });
    await second.promise;
    const { readWorkMeta } = await import("../../apps/desktop/out-test/work-store.mjs");
    const meta = await readWorkMeta(dir);
    assert.match(meta.foundation.style, /【改稿学习/);
    assert.match(meta.foundation.style, /改法：把总结性叙述改成动作与原话/);
    assert.match(meta.foundation.style, /来源：c001/);
    const decide = events.find(
      (event) =>
        event.event?.type === "tool_execution_end" &&
        event.event.toolName === "writer_revision_decide",
    );
    assert.match(decide.event.result.content[0].text, /已按作者决定采纳 1 条/);
    assert.equal(
      await readFile(pendingFile, "utf8").then(
        () => true,
        () => false,
      ),
      false,
      "最后一条采纳后 pending 文件须删除",
    );
  } finally {
    await sessions.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("改稿学习：头条收集 author 版改稿对与 feedback 条目，采纳经 feedback_append 落结构化行", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-learn-tt-")),
    home = path.join(base, "app"),
    data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.WRITER_STATE_ROOT = home;
  const store = new ArticleStore(data);
  const article = await store.create("ttlearn", { date: "2026-11-06", line: "故事线" });
  await store.stageDraft(
    article.id,
    "他很失落。他把票塞回口袋。他想，就这样吧。",
    "writer",
    "初稿",
  );
  await store.stageDraft(
    article.id,
    "他把票塞回口袋，没再回头。检票员喊了三遍，都没有人应。",
    "author",
    "作者改稿",
  );
  await writeFile(
    path.join(data, "feedback.md"),
    "# 作者改稿反馈\n\n- 2026-11-01：总结腔收尾 → 动作收尾 → 嫌总结腔 ｜ 病型=1·套话连接词 ｜ 改法=动作落地\n",
    "utf8",
  );
  const model = await fakeModel({
    "mock-writer": [
      { name: "writer_revision_learn", input: {} },
      { text: "候选已列出，请作者决定。" },
      { name: "writer_revision_decide", input: { id: LEARN_CANDIDATE_ID, action: "accept" } },
      { text: "已按作者决定采纳。" },
    ],
    "mock-editor": [{ text: LEARN_EDITOR_JSON }],
  });
  const done = settled(),
    events = [];
  let onSettled = done.finish;
  const sessions = learnSessions(
    home,
    model,
    { toutiao: { learn: { enabled: true } } },
    events,
    () => onSettled(),
  );
  const pendingFile = path.join(data, "learn-pending.json");
  try {
    await sessions.send({ mode: "toutiao", root: data, article: article.id }, "学习我的改稿。", {
      article: article.id,
      intent: "write",
    });
    await done.promise;
    const end = events.find(
      (event) =>
        event.event?.type === "tool_execution_end" &&
        event.event.toolName === "writer_revision_learn",
    );
    assert.ok(end, "writer_revision_learn 须交回结果");
    assert.equal(end.event.result.details.learn.pairs, 1, "author 版与前版构成一对");
    assert.equal(end.event.result.details.learn.feedback, 1);
    const editorText = JSON.stringify(
      model.calls.find((call) => call.model === "mock-editor").messages,
    );
    assert.ok(editorText.includes("作者改稿（author 版）"));
    assert.ok(editorText.includes("他把票塞回口袋，没再回头"));
    assert.ok(editorText.includes("病型=1·套话连接词"), "feedback 结构化条目须进归纳输入");
    const pending = JSON.parse(await readFile(pendingFile, "utf8"));
    assert.equal(pending.mode, "toutiao");
    const second = settled();
    onSettled = second.finish;
    await sessions.send({ mode: "toutiao", root: data, article: article.id }, "都要。", {
      article: article.id,
      intent: "write",
    });
    await second.promise;
    const feedback = parseFeedbackEntries(await readFile(path.join(data, "feedback.md"), "utf8"));
    const learned = feedback.find((entry) => entry.original === "林川很犹豫。");
    assert.ok(learned, "采纳的候选须写进 feedback.md");
    assert.equal(learned.revised, "林川把票捏又放下。");
    assert.equal(learned.病型, "对话推进到关键决定时");
    assert.equal(learned.改法, "把总结性叙述改成动作与原话");
    assert.equal(
      await readFile(pendingFile, "utf8").then(
        () => true,
        () => false,
      ),
      false,
      "采纳后 pending 文件须删除",
    );
  } finally {
    await sessions.dispose();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("改稿学习：模型输出非法 JSON 时如实报归纳失败且不落盘；开关关闭两工具不注册", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-learn-badjson-")),
    home = path.join(base, "app"),
    data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.WRITER_STATE_ROOT = home;
  const model = await fakeModel({
    "mock-writer": [{ text: "收到。" }],
    "mock-editor": [{ text: "抱歉，我不会输出 JSON。" }],
  });
  const done = settled(),
    events = [];
  let onSettled = done.finish;
  const { dir, key } = await makeLearnWork(data);
  const sessions = learnSessions(
    home,
    model,
    { fanqie: { learn: { enabled: true } } },
    events,
    () => onSettled(),
  );
  const pendingFile = path.join(dir, "learn-pending.json");
  try {
    await sessions.send({ mode: "fanqie", root: data, work: key }, "先打个招呼。", {
      chapter: "c001",
      intent: "write",
    });
    await done.promise;
    const session = await sessions.open({ mode: "fanqie", root: data, work: key });
    const learn = session.agent.state.tools.find((tool) => tool.name === "writer_revision_learn");
    await assert.rejects(
      learn.execute("x", {}, new AbortController().signal),
      /归纳失败/,
      "非法模型输出须如实报归纳失败",
    );
    assert.equal(
      await readFile(pendingFile, "utf8").then(
        () => true,
        () => false,
      ),
      false,
      "归纳失败不得落盘",
    );
  } finally {
    await sessions.dispose();
    await model.close();
  }

  const offModel = await fakeModel({ "mock-writer": [{ text: "收到。" }] });
  const offDone = settled();
  onSettled = offDone.finish;
  const offSessions = learnSessions(home, offModel, {}, events, () => onSettled());
  try {
    await offSessions.send({ mode: "fanqie", root: data, work: key }, "先读材料。", {
      chapter: "c001",
      intent: "write",
    });
    await offDone.promise;
    const call = offModel.calls.find((item) => item.model === "mock-writer");
    assert.ok(call.tools.some((tool) => tool.function.name === "fanqie_candidate_stage"));
    assert.ok(!call.tools.some((tool) => tool.function.name === "writer_revision_learn"));
    assert.ok(!call.tools.some((tool) => tool.function.name === "writer_revision_decide"));
  } finally {
    await offSessions.dispose();
    await offModel.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("PI 请求遵循系统代理，NO_PROXY 的本地接口保持直连", async (t) => {
  const { createServer, request: forward } = await import("node:http");
  const { connect } = await import("node:net");
  const model = await fakeModel();
  const target = new URL(model.url);
  const sockets = new Set();
  let tunnels = 0;
  const proxy = createServer((request, response) => {
    tunnels++;
    const requested = new URL(request.url, model.url);
    const upstream = forward(
      new URL(requested.pathname + requested.search, model.url),
      {
        method: request.method,
        headers: request.headers,
      },
      (result) => {
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response);
      },
    );
    upstream.on("error", (error) => {
      response.writeHead(502);
      response.end(error.message);
    });
    request.pipe(upstream);
  });
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  proxy.on("connect", (_request, socket, head) => {
    tunnels++;
    const upstream = connect(Number(target.port), "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    for (const stream of [socket, upstream]) {
      sockets.add(stream);
      stream.on("close", () => sockets.delete(stream));
      stream.on("error", () => {
        socket.destroy();
        upstream.destroy();
      });
    }
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const home = await mkdtemp(path.join(tmpdir(), "writer-proxy-"));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
    await model.close();
    await rm(home, { recursive: true, force: true });
  });
  const endpoint = `http://127.0.0.1:${proxy.address().port}`;
  const config = models(model.url).writer;
  const adapter = pathToFileURL(path.join(root, "apps/desktop/out-test/pi.mjs")).href;
  const code = `const {testConnection}=await import(${JSON.stringify(adapter)});const config=JSON.parse(process.argv[1]);await testConnection(config,process.argv[2]);`;
  const run = promisify(execFile);
  const env = {
    ...process.env,
    HTTP_PROXY: endpoint,
    HTTPS_PROXY: endpoint,
    http_proxy: endpoint,
    https_proxy: endpoint,
    NO_PROXY: "127.0.0.1",
    no_proxy: "127.0.0.1",
  };
  await run(
    process.execPath,
    ["--input-type=module", "-e", code, JSON.stringify(config), path.join(home, "direct.json")],
    { env, timeout: 20000 },
  );
  assert.equal(tunnels, 0);
  // Loopback stays direct even when the author's NO_PROXY does not mention it.
  await run(
    process.execPath,
    ["--input-type=module", "-e", code, JSON.stringify(config), path.join(home, "loopback.json")],
    { env: { ...env, NO_PROXY: "", no_proxy: "" }, timeout: 20000 },
  );
  assert.equal(tunnels, 0);
  const proxied = { ...config, baseUrl: "http://writer-proxy.invalid/v1" };
  await run(
    process.execPath,
    ["--input-type=module", "-e", code, JSON.stringify(proxied), path.join(home, "proxied.json")],
    { env, timeout: 20000 },
  );
  assert.ok(tunnels > 0);
  assert.equal(model.calls.length, 3);
});
