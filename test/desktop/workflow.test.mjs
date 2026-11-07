import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Sessions } from "../../apps/desktop/out-test/session.mjs";
import { defaultModels } from "../../apps/desktop/out-test/models.mjs";
import { ArticleStore } from "../../apps/desktop/out-test/article-store.mjs";
import {
  ensureStorage,
  setOutline,
  readChapter,
  listCandidates,
  updateChapter,
  readWorkMeta,
} from "../../apps/desktop/out-test/work-store.mjs";
import { fakeModel } from "./fake-model.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
for (const mode of ["FANQIE", "TOUTIAO"]) {
  process.env[`WRITER_${mode}_SKILL_DIR`] = path.join(root, `packages/${mode.toLowerCase()}/skill`);
  process.env[`WRITER_${mode}_DEFAULT_DIR`] = path.join(
    root,
    `packages/${mode.toLowerCase()}/profiles/default`,
  );
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
const plan = {
  title: "归站",
  pov: "林川",
  targetWords: 300,
  locks: "无新增旧事实",
  knowledge: "只知眼前",
  synopsis: "取回车票",
  conflict: "门被锁住",
  beats: "敲门、交涉、取票",
  ending: "发现另一张票",
};
const body =
  "林川把手里的车票递到窗口。售票员摇头，说这不是今夜的票。他转身去看站牌，风把木门吹得直响。\n\n".repeat(
    6,
  ) + "他在门缝里摸到了另一张票。";
const request = (kind, chapter = "c004") => ({
  kind,
  chapter,
  instruction: "按已保存规划写作，保留作者正文。",
  grade: "standard",
  source: "",
  line: "news",
});
function packet(call) {
  return call.messages
    .filter((row) => row.role === "user")
    .map((row) =>
      typeof row.content === "string"
        ? row.content
        : row.content.map((block) => block.text ?? "").join("\n"),
    )
    .join("\n");
}
function stageInput(text) {
  const value = text.split("## 本阶段输入\n")[1]?.split("\n\n## 本次作者要求")[0];
  return value ? JSON.parse(value) : undefined;
}
async function until(predicate) {
  const end = Date.now() + 20000;
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error("场景未在20秒内完成");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function respondStage(call, control) {
  const text = packet(call),
    input = stageInput(text),
    answer = (value) => ({ text: JSON.stringify(value) });
  if (!input) return { text: "已理解，结果以流水线报告为准。" };
  if (input.sections)
    return answer({
      sourceHash: input.sourceHash,
      rules: input.sections.map((row) => ({
        id: row.id,
        text: "保留本节设定、因果和禁项，按当前任务执行。",
      })),
    });
  if (text.includes('返回 {"locks"'))
    return answer({
      locks: "车站的门夜里会锁",
      happened: "无",
      characters: "林川",
      readerKnowledge: "车站位置",
      planned: "全书：寻找车票；第一卷：站台；卷高潮：取回票，情绪由压抑到释放",
      threads: "另一张车票",
      style: "写具体动作，不用空泛判断",
    });
  if (text.includes("只细化未来3至5章"))
    return answer({ chapters: [1, 2, 3].map((n) => ({ id: `c00${n}`, ...plan })) });
  if (input.chapter) return answer(plan);
  if (text.includes('返回 {"scenes"'))
    return answer({
      scenes: [
        { purpose: "取票", conflict: "门锁着", information: "票被退回", change: "找到另一张票" },
      ],
    });
  if (input.scenePlan) {
    if (control.holdNext) {
      control.holdNext = false;
      control.held = true;
      return { wait: true };
    }
    if (control.malformed) {
      control.malformed = false;
      return { text: "不是JSON" };
    }
    return answer({ title: "归站", body });
  }
  if (input.persona)
    return answer({
      winner: "tie",
      reason: "两稿相同，无法区分",
      abandonA: "未发现",
      abandonB: "未发现",
    });
  if (input.bodyHash && input.draft)
    return answer({ bodyHash: input.bodyHash, hard: [], suggestions: [] });
  throw new Error("未覆盖的本地阶段输入：" + JSON.stringify(input).slice(0, 100));
}
async function fixture(respond, options = {}) {
  const base = await mkdtemp(path.join(tmpdir(), "writer-workflow-")),
    home = path.join(base, "app"),
    data = path.join(base, "data");
  await mkdir(home);
  await mkdir(data);
  process.env.WRITER_STATE_ROOT = home;
  const model = await fakeModel({}, respond),
    models = defaultModels();
  models.planner = { ...models.writer };
  for (const [role, value] of Object.entries(models))
    if (value)
      Object.assign(value, {
        provider: "fixture",
        baseUrl: model.url,
        apiKey: "fixture-key",
        model: "mock-" + role,
        reasoning: false,
        thinkingLevel: "off",
      });
  const control = { confirm: true },
    events = [];
  const host = new Sessions({
    home,
    python: process.platform === "win32" ? "python" : "python3",
    settings: () => models,
    emit: (event) => events.push(event),
    confirm: async () => control.confirm,
    options,
    created: async () => {},
    extras: {
      engine: () => ({ guided: true, grade: "standard", inputBudget: 24000, runBudget: 200000 }),
    },
  });
  return {
    base,
    home,
    data,
    model,
    host,
    events,
    control,
    async done(target) {
      await until(() => !host.isRunning(target));
      return host.workflows.status(target);
    },
    async close() {
      await host.dispose();
      await model.close();
      await rm(base, { recursive: true, force: true });
    },
  };
}

test("编排完整旅程：调度工具→规划采用→章节多稿、校验重试、交付恢复、暂停与作者版本保护", async () => {
  const control = { malformed: true, holdNext: false, held: false };
  let dispatched = false,
    created = false;
  const f = await fixture((call) => {
    if (call.tools?.length && !created) {
      created = true;
      return { name: "fanqie_project_create", input: { title: "夜航", key: "night" } };
    }
    if (call.tools?.length && !dispatched) {
      dispatched = true;
      return { name: "writer_pipeline_start", input: request("book") };
    }
    return respondStage(call, control);
  });
  try {
    const paths = await ensureStorage(null, { storageRoot: f.data });
    await f.host.send({ mode: "fanqie", root: f.data }, "新建题名夜航、目录night的作品并规划本书", {
      intent: "plan",
    });
    const target = { mode: "fanqie", root: f.data, work: "night" };
    await until(() => f.host.sessions.has(f.host.key(target)));
    const work = {
      dir: path.join(paths.works, "night"),
      meta: await readWorkMeta(path.join(paths.works, "night")),
    };
    let state = await f.done(target);
    assert.equal(state.state, "awaiting-author", state.error);
    assert.match(state.id, /^run-[a-f0-9]+$/);
    const toolCall = f.model.calls.find((call) => call.tools?.length);
    assert.ok(toolCall.tools.length <= 12);
    assert.ok(
      !toolCall.tools.some((row) =>
        /method_get|candidate_stage|chapter_save|writer_draw/.test(row.function.name),
      ),
    );
    assert.equal((await readWorkMeta(work.dir)).chapters.length, 0, "规划未确认不能写入作品");
    f.control.confirm = false;
    await assert.rejects(f.host.workflows.apply(target), /取消/);
    f.control.confirm = true;
    await f.host.workflows.apply(target);
    const planned = await readWorkMeta(work.dir);
    assert.equal(planned.chapters.length, 3);
    await f.host.workflows.apply(target);
    assert.equal((await readWorkMeta(work.dir)).chapters.length, 3, "重复采用不新增章节");
    await setOutline(work.dir, "c004", { targetWords: 300, pov: "林川" }, "归站");
    await f.host.workflows.start(target, request("chapter"));
    state = await f.done(target);
    assert.equal(state.state, "awaiting-author", state.error);
    assert.equal(state.steps.find((row) => row.id === "draft-0").attempts, 2);
    assert.equal(state.steps.filter((row) => row.id.startsWith("pair-")).length, 6);
    assert.equal((await readChapter(work.dir, "c004")).body, "", "候选不代替作者正文");
    const candidates = await listCandidates(work.dir);
    assert.equal(candidates.length, 2);
    const calls = f.model.calls.length;
    const file = path.join(f.home, "workflows", f.host.key(target), state.id + ".json");
    state.steps = state.steps.filter((row) => row.id !== "delivery");
    state.state = "running";
    await writeFile(file, JSON.stringify(state));
    assert.equal((await f.host.workflows.status(target)).state, "paused", "重启遗留运行态可恢复");
    await f.host.workflows.start(target, state.request, true);
    state = await f.done(target);
    assert.equal(state.state, "awaiting-author", state.error);
    assert.equal((await listCandidates(work.dir)).length, 2, "恢复不会重复交付候选");
    assert.equal(f.model.calls.length, calls, "完成阶段不重新调用模型");
    await setOutline(work.dir, "c005", plan, "归站");
    control.holdNext = true;
    control.held = false;
    await f.host.workflows.start(target, request("chapter", "c005"));
    await until(() => control.held);
    await f.host.stop({ mode: "fanqie", root: f.data });
    assert.equal((await f.host.workflows.status(target)).state, "paused");
    await f.host.workflows.start(target, request("chapter", "c005"), true);
    state = await f.done(target);
    assert.equal(state.state, "awaiting-author", state.error);
    assert.equal(state.steps.find((row) => row.id === "scenes").attempts, 1);
    await setOutline(work.dir, "c006", plan, "归站");
    control.holdNext = true;
    control.held = false;
    await f.host.workflows.start(target, request("chapter", "c006"));
    await until(() => control.held);
    await f.host.workflows.stop(target);
    await updateChapter(work.dir, { id: "c006", body: "作者自行修改的新稿" });
    await assert.rejects(
      f.host.workflows.start(target, request("chapter", "c006"), true),
      /依据已改变/,
    );
    assert.equal((await readChapter(work.dir, "c006")).body, "作者自行修改的新稿");
    assert.equal((await f.host.workflows.history(target)).length, 4);
    assert.ok(
      f.model.calls.filter((call) => stageInput(packet(call))).every((call) => !call.tools?.length),
      "各阶段没有模型工具面",
    );
  } finally {
    await f.close();
  }
});

test("头条完整旅程：本地故事来源→工作稿真实质检→中断交付恢复→作者采用卡片与实际台账质检", async () => {
  const fixtureDir = path.join(root, "packages/toutiao/skill/tests/fixtures"),
    body = await readFile(path.join(fixtureDir, "story_long_good.md"), "utf8"),
    card = JSON.parse(await readFile(path.join(fixtureDir, "story_long_card.json"), "utf8"));
  const title = card["主标题"],
    titles = [title, ...card["备选标题"]];
  const f = await fixture((call) => {
    const text = packet(call),
      input = stageInput(text),
      answer = (value) => ({ text: JSON.stringify(value) });
    if (input?.sections) return respondStage(call, {});
    if (text.includes('返回 {"titles"')) return answer({ titles });
    if (text.includes('返回 {"opening"'))
      return answer({ opening: "精卫飞来", structure: "逐项解读原典", extension: "比较西西弗斯" });
    if (input?.blueprint) return answer({ title, body });
    if (input?.bodyHash) return answer({ bodyHash: input.bodyHash, hard: [], suggestions: [] });
    if (text.includes('返回 {"claims"'))
      return answer({ claims: [{ claim: "精卫", quote: "精卫", kind: "quotation" }] });
    throw new Error("未覆盖文章阶段：" + text.slice(-160));
  });
  try {
    const store = new ArticleStore(f.data),
      meta = await store.create("story", { line: "故事线", genre: "长图文" }),
      target = { mode: "toutiao", root: f.data, article: meta.id };
    await store.writeCard(meta.id, card);
    const req = {
      ...request("article"),
      grade: "economy",
      line: "story",
      instruction: "解释精卫填海原典",
      source: "《山海经》：精卫常衔西山之木石，以堙于东海。",
    };
    await f.host.workflows.start(target, req);
    let state = await f.done(target);
    assert.equal(state.state, "awaiting-author", state.error);
    assert.equal(
      state.steps.find((row) => row.id === "qa-0").output.pass,
      true,
      "沿用真实Python质检硬闸",
    );
    assert.equal((await store.get(meta.id)).current_rev, 1);
    assert.equal((await store.get(meta.id)).status, "初稿待改");
    assert.equal(
      await store.cardSha(meta.id),
      hash(JSON.stringify(card, null, 2)),
      "交付不擅改立项卡",
    );
    const calls = f.model.calls.length,
      file = path.join(f.home, "workflows", f.host.key(target), state.id + ".json");
    state.steps = state.steps.filter((row) => row.id !== "delivery");
    state.state = "paused";
    await writeFile(file, JSON.stringify(state));
    await f.host.workflows.start(target, req, true);
    state = await f.done(target);
    assert.equal(state.state, "awaiting-author", state.error);
    assert.equal(f.model.calls.length, calls);
    assert.equal((await store.get(meta.id)).drafts.length, 1);
    assert.ok(state.steps.find((row) => row.id === "delivery").output.card);
    await f.host.workflows.apply(target);
    const adopted = await store.get(meta.id);
    assert.equal(adopted.qa.at(-1).pass, true);
    assert.equal(adopted.status, "初稿待改", "不代作者验收或交稿");
    assert.equal(adopted.qa.at(-1).card_sha256, await store.cardSha(meta.id));
  } finally {
    await f.close();
  }
});
