import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ArticleStore } from "../../apps/desktop/out-test/article-store.mjs";
import { fakeModel } from "./fake-model.mjs";
import { Sessions } from "../../apps/desktop/out-test/session.mjs";
import { Settings } from "../../apps/desktop/out-test/settings.mjs";
import { defaultModels } from "../../apps/desktop/out-test/models.mjs";
import {
  publicAddress,
  readSource,
} from "../../apps/desktop/out-test/network.mjs";
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
process.env.WRITER_TOUTIAO_SKILL_DIR = path.join(
  root,
  "packages/toutiao/skill",
);
process.env.WRITER_FANQIE_SKILL_DIR = path.join(root, "packages/fanqie/skill");
process.env.WRITER_TOUTIAO_DEFAULT_DIR = path.join(
  root,
  "packages/toutiao/profiles/default",
);
process.env.WRITER_FANQIE_DEFAULT_DIR = path.join(
  root,
  "packages/fanqie/profiles/default",
);
function settled() {
  let finish;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("任务未在 15 秒内结束")),
      15000,
    );
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
  process.env.DSH_HOME = home;
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
  const sessions = new Sessions(
    home,
    "python3",
    () => models(model.url),
    (event) => {
      events.push(event);
      if (event.event?.type === "agent_settled" && !event.editor) onSettled();
    },
    async (message) => {
      asks.push(message);
      return false;
    },
    {},
    async (previous, next) => {
      attached = { previous, next };
    },
  );
  try {
    await sessions.send(
      { mode: "fanqie", root: data },
      "MAIN-PRIVATE：按要求创建测试作品与草稿，然后派编辑，最后请求作者定稿。",
      { intent: "plan" },
    );
    await done.promise;
    assert.equal(attached.next.work, "station");
    assert.equal(asks.length, 1);
    const planning = events.find(event => event.event?.type === "tool_execution_end" && event.event.toolName === "writer_plan")?.event.result.details.writerResult;
    assert.equal(planning.status, "saved");
    assert.ok(planning.saved.some(item => item.tool === "fanqie_project_create"));
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
      assert.ok(
        card.focus.candidate &&
          result.content[0].text.includes(card.focus.candidate),
      );
    }
    const writer = model.calls.find((call) => call.model === "mock-writer"),
      editor = model.calls.find((call) => call.model === "mock-editor");
    assert.ok(writer && editor);
    assert.ok(model.calls.some((call) => call.model === "mock-planner"));
    const planner = model.calls.find(call => call.model === "mock-planner");
    assert.ok(!planner.tools.some(tool => tool.function.name === "fanqie_chapter_save"));
    assert.ok(editor.tools.some(tool => tool.function.name === "fanqie_foundation_get"));
    assert.ok(!editor.tools.some(tool => tool.function.name === "fanqie_library_card_stage"));
    assert.ok(!JSON.stringify(editor.messages).includes("MAIN-PRIVATE"));
    assert.ok(editor.messages.some(m => (typeof m.content === "string" ? m.content : (m.content || []).map(part => part.text || "").join("\n")).includes('"intent":"review"')));
    assert.ok(
      !editor.tools.some(
        (tool) => tool.function.name === "fanqie_chapter_save",
      ),
    );
    const chapter = await readFile(
      path.join(data, "works/station/chapters/c001.md"),
      "utf8",
    );
    assert.ok(!chapter.includes("status: final"));
    assert.match(chapter, /站台/);
    assert.ok(
      !model.calls
        .flatMap((call) => call.messages || [])
        .some(
          (message) =>
            message.role === "tool" &&
            String(message.content).includes("Validation failed"),
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
    assert.ok(
      before.messages.some((message) => message.customType === "writer-author"),
    );
    const live = await sessions.open(attached.next);
    live.sessionManager.appendCustomMessageEntry("hidden", "not displayed", false);
    live.sessionManager.appendCustomMessageEntry("hidden", "also hidden", false);
    const tail = await sessions.view(attached.next, 2);
    assert.equal(tail.total, before.total);
    assert.deepEqual(tail.messages.map(item => item.writerMessageId), before.messages.slice(-2).map(item => item.writerMessageId));
    await sessions.newConversation(attached.next);
    assert.equal((await sessions.view(attached.next)).messages.length, 0);
    const conversations = await sessions.conversations(attached.next);
    assert.equal(conversations.length, 1);
    assert.ok((await sessions.view(attached.next, 80, 0)).messages.length > 0);
    const handoff = await sessions.handoffPreview(attached.next, {
      chapter: "c001",
      intent: "write",
    });
    assert.match(handoff, /briefRecorded/);
    assert.ok(!handoff.includes("MAIN-PRIVATE"));
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
      for (const file of [
        "desktop.json",
        "model.json",
        "search.json",
        "writer.json",
      ])
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
    assert.ok(
      !(await readFile(path.join(home, "model.json"), "utf8")).includes(
        "do-not-persist",
      ),
    );
    assert.equal(store.models.writer.apiKey, "do-not-persist");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("作品租约：另一进程持有时只读；进程结束后可重新取得", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "writer-lease-"));
  const moduleURL = new URL(
    "../../apps/desktop/out-test/lease.mjs",
    import.meta.url,
  ).href;
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
      await symlink(
        folder,
        alias,
        process.platform === "win32" ? "junction" : "dir",
      );
      await releaseWorkspace(alias);
      await assert.rejects(
        readFile(path.join(folder, ".writer-workspace-lock.json")),
        { code: "ENOENT" },
      );
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
  process.env.DSH_HOME = home;
  await writeFile(
    path.join(home, "writer-toutiao-roots.json"),
    JSON.stringify([folder]),
  );
  const store = new ArticleStore(folder);
  try {
    const story = await readFile(
        path.join(
          root,
          "packages/toutiao/skill/tests/fixtures/story_long_good.md",
        ),
        "utf8",
      ),
      title = story.split("\n")[0].slice(2);
    const article = await store.create("export", { titleHint: title });
    await store.stageDraft(
      article.id,
      story.replace(/\n/g, "\r\n") +
        "\r\n" +
        "正文".repeat(110000) +
        "唯一尾标",
      "writer",
      "导出校验",
    );
    const result = await exportContent(
      { mode: "toutiao", root: folder },
      { article: article.id },
    );
    assert.equal(
      result.text.split("\n").filter((line) => line === title).length,
      1,
    );
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
  let release, calls = 0;
  const prepared = new Promise(resolve => { release = resolve; });
  const session = { abort: async () => {}, prompt: async () => { calls++; } };
  const pending = promptWithSignal(session, () => prepared, controller.signal);
  controller.abort();
  release("不应启动");
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 0);

  const starting = new AbortController();
  let active = false, stopped = false;
  const delayed = {
    abort: async () => { if (active) stopped = true; },
    prompt: async (_text, options) => {
      starting.abort(); // SDK input/auth can await before the run exists.
      await Promise.resolve();
      active = true;
      options.preflightResult("started");
      assert.equal(stopped, true, "必须在首个模型请求前重新传递停止");
    },
  };
  await assert.rejects(promptWithSignal(delayed, async () => "任务", starting.signal), { name: "AbortError" });
});

test("停止任务同时取消父会话与子角色会话", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "writer-cancel-tree-"));
  const sessions = new Sessions(
    home,
    "python3",
    defaultModels,
    () => {},
    async () => false,
  );
  const order = [];
  const child = { abort: async () => { order.push("child"); } };
  const parent = { abort: async () => { order.push("parent"); }, isIdle: true };
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

test("模型等待中停止：2 秒内收尾且取消后不再请求模型", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "writer-cancel-model-"));
  const home = path.join(base, "app");
  const data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.DSH_HOME = home;
  const model = await fakeModel({ "mock-writer": [{ wait: true }] });
  const sessions = new Sessions(
    home,
    "python3",
    () => models(model.url),
    () => {},
    async () => false,
  );
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
  const { ensureStorage, createWork, setOutline } = await import("../../apps/desktop/out-test/work-store.mjs");
  const { inspectRecovery, recoverWork } = await import("../../apps/desktop/out-test/recovery.mjs");
  const appHome = path.join(base, "app");
  await mkdir(appHome);
  process.env.DSH_HOME = appHome;
  const paths = await ensureStorage(null, { storageRoot: path.join(base, "data") });
  const work = await createWork(paths, { title: "恢复前" });
  await setOutline(work.dir, "c001", { synopsis: "站台" }, "第一章");
  const sessions = new Sessions(appHome, "python3", defaultModels, () => {}, async () => false);
  try {
    const preview = await sessions.handoffPreview({ mode: "fanqie", root: paths.base, work: work.meta.key }, { chapter: "c001", intent: "review" });
    assert.match(preview, /尚无本章的审读回报/);
    assert.match(preview, /revision/);
    const metaFile = path.join(work.dir, "meta.json"), chapterFile = path.join(work.dir, "chapters/c001.md");
    const oldMeta = await readFile(metaFile, "utf8"), oldChapter = await readFile(chapterFile, "utf8");
    const hash = text => createHash("sha256").update(text).digest("hex");
    const nextMeta = JSON.stringify({ ...JSON.parse(oldMeta), title: "恢复后" });
    const journal = { version: 1, id: randomUUID(), owner: { pid: process.pid, host: hostname() }, createdAt: new Date().toISOString(), chapterId: "c001", writes: [
      { file: "chapters/c001.md", before: hash(oldChapter), after: hash(oldChapter), content: oldChapter },
      { file: "meta.json", before: hash(oldMeta), after: hash(nextMeta), content: nextMeta },
    ] };
    await writeFile(path.join(work.dir, ".writer-chapter-pending.json"), JSON.stringify(journal));
    const expected = await inspectRecovery(work.dir);
    assert.equal(expected.canRecover, true);
    await assert.rejects(recoverWork(work.dir, expected, async () => { throw new Error("备份失败"); }), /备份失败/);
    assert.equal(await readFile(metaFile, "utf8"), oldMeta);
    await mkdir(path.join(work.dir, ".writer-write-lock"));
    assert.equal((await inspectRecovery(work.dir)).canRecover, false);
    await rm(path.join(work.dir, ".writer-write-lock"), { recursive: true });
    await writeFile(metaFile, "作者改稿");
    assert.equal((await inspectRecovery(work.dir)).canRecover, false);
    await writeFile(metaFile, oldMeta);
    const run = promisify(execFile), backup = path.join(base, "backup");
    await recoverWork(work.dir, expected, async () => {
      await run(process.execPath, [path.join(root, "scripts/backup.mjs"), "--source", work.dir, "--output", backup]);
      await run(process.execPath, [path.join(root, "scripts/backup.mjs"), "--verify", backup]);
      return backup;
    });
    assert.equal(JSON.parse(await readFile(metaFile, "utf8")).title, "恢复后");
    assert.equal((await inspectRecovery(work.dir)).canRecover, false);
    await assert.rejects(recoverWork(work.dir, expected, async () => backup), /没有待恢复/);
  } finally {
    await sessions.dispose();
    await rm(base, { recursive: true, force: true });
  }
});


test("连续作品切换及持久化失败保留目标与租约一致", async () => {
  const {selectTarget}=await import('../../apps/desktop/out-test/targets.mjs');
  const {access}=await import('node:fs/promises');
  const base=await mkdtemp(path.join(tmpdir(),'writer-select-'));
  const roots=['a','b','c'].map(name=>path.join(base,name));
  await Promise.all(roots.map(root=>mkdir(root)));
  const state={home:base,writerConfig:{},sessions:{key:t=>t.root,running:()=>[],release:()=>{}}};
  try {
    await Promise.all(roots.slice(0,2).map(root=>selectTarget(state,{mode:'toutiao',root})));
    assert.equal(state.target.root,roots[1]);
    assert.equal(state.access.readOnly,false);
    await assert.rejects(access(path.join(roots[0],'.writer-workspace-lock.json')));
    const owner=state.access.owner.id;
    await rm(path.join(base,'target.json'));
    await mkdir(path.join(base,'target.json'));
    await assert.rejects(selectTarget(state,{mode:'toutiao',root:roots[2]}));
    assert.equal(state.target.root,roots[1]);
    assert.equal(state.access.owner.id,owner);
    await assert.rejects(access(path.join(roots[2],'.writer-workspace-lock.json')));
  } finally {
    const {releaseWorkspaces}=await import('../../apps/desktop/out-test/targets.mjs');
    // Each compiled entry owns its lease registry; release through the target module.
    await releaseWorkspaces();
    await rm(base,{recursive:true,force:true});
  }
});
