import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fakeModel } from "./fake-model.mjs";
import { Sessions } from "../../apps/desktop/out-test/session.mjs";
import { Settings } from "../../apps/desktop/out-test/settings.mjs";
import { defaultModels } from "../../apps/desktop/out-test/models.mjs";
import {
  publicAddress,
  readSource,
} from "../../apps/desktop/out-test/network.mjs";
import {
  publicationIssues,
  publishText,
  wordDocument,
} from "../../apps/desktop/out-test/exports.mjs";
import {
  claimWorkspace,
  assertWorkspaceWritable,
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

test("真实 Pi：建书归属、独立编辑、角色模型、作者确认、通知落盘与新对话交接", async () => {
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
    const writer = model.calls.find((call) => call.model === "mock-writer"),
      editor = model.calls.find((call) => call.model === "mock-editor");
    assert.ok(writer && editor);
    assert.ok(model.calls.some((call) => call.model === "mock-planner"));
    assert.ok(!JSON.stringify(editor.messages).includes("MAIN-PRIVATE"));
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
});
