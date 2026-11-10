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
  createWork,
} from "../../apps/desktop/out-test/work-store.mjs";
import { fakeModel } from "./fake-model.mjs";
import { Settings } from "../../apps/desktop/out-test/settings.mjs";
import { PYTHON } from "./python.mjs";
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
  const value = text.split("## 本阶段输入\n")[1]?.split("\n\n## ")[0];
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
  if (text.includes('返回 {"hard"')) return answer({ hard: [], suggestions: [] });
  throw new Error("未覆盖的本地阶段输入：" + JSON.stringify(input).slice(0, 100));
}
async function fixture(
  respond,
  options = {},
  engine = { guided: true, grade: "standard", inputBudget: 24000, runBudget: 200000 },
) {
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
    python: PYTHON,
    settings: () => models,
    emit: (event) => events.push(event),
    confirm: async () => control.confirm,
    options,
    created: async () => {},
    extras: { engine: () => engine },
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
    const eventStart = f.events.length,
      measuredAt = Date.now();
    await f.host.workflows.start(target, request("chapter"));
    state = await f.done(target);
    const measured = f.events.slice(eventStart).filter((event) => event.workflow?.id === state.id);
    assert.ok(measured.length < state.steps.length * 2);
    assert.deepEqual(measured.at(-1).workflow, state);
    console.log(
      "workflow-events",
      JSON.stringify({
        count: measured.length,
        bytes: measured.reduce((sum, event) => sum + Buffer.byteLength(JSON.stringify(event)), 0),
        elapsedMs: Date.now() - measuredAt,
      }),
    );
    assert.equal(state.state, "awaiting-author", state.error);
    assert.equal(state.steps.find((row) => row.id === "draft-0").attempts, 2);
    const draftCalls = f.model.calls.filter(
      (call) => stageInput(packet(call))?.entry === "从动作进入主场面",
    );
    assert.equal(draftCalls.length, 2);
    assert.ok(!packet(draftCalls[0]).includes("## 上次返回未通过校验"));
    assert.match(packet(draftCalls[1]), /## 上次返回未通过校验\n.+请按返回格式完整重答/);
    const system = draftCalls[0].messages.find((row) => row.role !== "user");
    assert.ok(system, "阶段前缀作为系统提示发送");
    assert.match(JSON.stringify(system.content), /阶段职责/);
    assert.ok(!packet(draftCalls[0]).includes("## 阶段职责"), "前缀不重复进入用户消息");
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
    const paused = await f.host.workflows.status(target);
    assert.equal(paused.state, "paused");
    await f.host.notify(target, { operation: "/chapter/finalize", chapter: "c004" });
    assert.equal(
      (await f.host.workflows.status(target)).id,
      paused.id,
      "定稿不抢暂停任务的恢复入口",
    );
    assert.ok(f.events.some((event) => /记账已排队/.test(event.error ?? "")));
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
    if (text.includes('返回 {"hard"')) return answer({ hard: [], suggestions: [] });
    if (text.includes('返回 {"claims"'))
      return answer({ claims: [{ claim: "精卫", quote: "精卫", kind: "quotation" }] });
    throw new Error("未覆盖文章阶段：" + text.slice(-160));
  });
  try {
    const store = new ArticleStore(f.data),
      meta = await store.create("story", { line: "故事线", genre: "长图文" }),
      target = { mode: "toutiao", root: f.data, article: meta.id };
    const broken = await store.create("broken", { line: "故事线", genre: "长图文" });
    await writeFile(store.metaPath(broken.id), "{broken");
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
    assert.ok(
      state.steps
        .find((row) => row.id === "prepared")
        .output.skippedHistory.some((issue) => issue.id === broken.id),
    );
    assert.ok(!state.steps.some((row) => row.id === "facts-final"));
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
    assert.ok(
      !state.steps.some((row) => row.id === "final-review"),
      "终稿自审读后未变，复用审读结论",
    );
    const articleCalls = f.model.calls.filter((call) => stageInput(packet(call))?.source);
    assert.ok(articleCalls.length > 0);
    assert.ok(
      articleCalls.every(
        (call) =>
          stageInput(packet(call)).source.text === "见材料「来源原文」" &&
          JSON.stringify(call.messages.filter((row) => row.role !== "user")).includes(
            "精卫常衔西山之木石",
          ),
      ),
      "来源原文进入材料前缀，阶段输入只留引用",
    );
    assert.equal((await store.get(meta.id)).drafts.length, 1);
    assert.ok(state.steps.find((row) => row.id === "delivery").output.card);
    const originalCard = await readFile(store.cardPath(meta.id), "utf8"),
      originalHeadlines = (await store.get(meta.id)).headlines;
    const prepared = state.steps.find((row) => row.id === "prepared").output;
    const goodCard = prepared.card;
    prepared.card = { ...goodCard, 主驱动: "非法驱动" };
    state.steps.find((row) => row.id === "delivery").output.card = prepared.card;
    await writeFile(file, JSON.stringify(state));
    await assert.rejects(f.host.workflows.apply(target), /质检未通过/);
    assert.equal(await readFile(store.cardPath(meta.id), "utf8"), originalCard);
    assert.deepEqual((await store.get(meta.id)).headlines, originalHeadlines);
    prepared.card = goodCard;
    state.steps.find((row) => row.id === "delivery").output.card = goodCard;
    await writeFile(file, JSON.stringify(state));
    const draftCall = f.model.calls.find((call) => stageInput(packet(call))?.blueprint);
    assert.match(packet(draftCall), /不贴链接/);
    assert.doesNotMatch(packet(draftCall), /与AI参与声明/);
    await f.host.workflows.apply(target);
    const adopted = await store.get(meta.id);
    assert.equal(adopted.qa.at(-1).pass, true);
    assert.equal(adopted.status, "初稿待改", "不代作者验收或交稿");
    assert.equal(adopted.qa.at(-1).card_sha256, await store.cardSha(meta.id));
  } finally {
    await f.close();
  }
});

test("阶段输出解析：容忍正文里的裸换行、前后说明文字与代码围栏", async () => {
  const { jsonOutput } = await import("../../apps/desktop/out-test/workflow-schema.mjs");
  assert.deepEqual(jsonOutput('{"title":"归站","body":"第一段\n\n第二段"}'), {
    title: "归站",
    body: "第一段\n\n第二段",
  });
  assert.deepEqual(jsonOutput('好的，结果如下：\n```json\n{"a":"含 } 括号","b":1}\n```\n以上。'), {
    a: "含 } 括号",
    b: 1,
  });
  assert.throws(() => jsonOutput("没有任何 JSON"));
});

test("引文定位：容忍空白与引号样式差异，返回正文原文；不存在时为空", async () => {
  const { locate } = await import("../../apps/desktop/out-test/workflow-schema.mjs");
  const text = "他说：“走吧。”\n\n风把木门吹得直响。";
  assert.equal(locate(text, "风把木门吹得直响"), "风把木门吹得直响");
  assert.equal(locate(text, '他说："走吧。"'), "他说：“走吧。”");
  assert.equal(locate(text, "风把 木门\n吹得"), "风把木门吹得");
  assert.equal(locate(text, "门外有人"), undefined);
});

test("审读不要求模型回显指纹；硬伤原文按定位结果绑定当前正文", async () => {
  const { review } = await import("../../apps/desktop/out-test/workflow-schema.mjs");
  const text = "他说：“走吧。”\n\n风把木门吹得直响。";
  const result = review(
    JSON.stringify({
      hard: [{ location: "第一段", quote: '他说："走吧。"', impact: "看不懂", fix: "补动机" }],
      suggestions: [],
    }),
    text,
  );
  assert.equal(result.bodyHash, hash(text));
  assert.equal(result.hard[0].quote, "他说：“走吧。”");
  assert.equal(review('{"hard":[],"suggestions":[]}', text).bodyHash, hash(text));
});

test("写作引擎预算：旧默认只在缺少版本标记时迁移一次，显式值保留", async () => {
  const { parseEngine, DEFAULT_ENGINE } =
    await import("../../apps/desktop/out-test/workflow-config.mjs");
  const base = { guided: true, grade: "standard", inputBudget: 24000 };
  assert.equal(parseEngine({ ...base, runBudget: 200000 }).runBudget, 200000);
  assert.equal(parseEngine({ ...base, runBudget: 300000 }).runBudget, 300000);
  assert.equal(parseEngine({ ...base, runBudget: 5000000 }).runBudget, 5000000);
  assert.throws(() => parseEngine({ ...base, runBudget: 30000000 }));
  assert.throws(() => parseEngine({ ...base, runBudget: 200000, engineVersion: 3 }));

  const home = await mkdtemp(path.join(tmpdir(), "writer-engine-"));
  const secrets = { available: () => true, encrypt: (text) => text, decrypt: (text) => text };
  try {
    await writeFile(path.join(home, "engine.json"), JSON.stringify({ ...base, runBudget: 200000 }));
    const legacy = new Settings(home, secrets);
    await legacy.load();
    assert.equal(legacy.engine.runBudget, DEFAULT_ENGINE.runBudget);
    assert.match(legacy.notices.join(), /20 万 token/);

    await legacy.saveEngine({ ...legacy.engine, runBudget: 200000 });
    const reopened = new Settings(home, secrets);
    await reopened.load();
    assert.equal(reopened.engine.runBudget, 200000, "作者显式选择的预算不能被再次迁移");
    assert.equal(reopened.notices.length, 0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("两轮定向修订后仍有硬伤：交付最佳稿并标注待作者判断，不丢弃整次任务", async () => {
  const { editDraft, selectDraft } =
    await import("../../apps/desktop/out-test/workflow-editor.mjs");
  const text = "林川把车票递到窗口。\n\n售票员摇头。\n\n他在门缝里摸到另一张票。";
  const ids = [];
  const run = {
    journal: { record: { request: { grade: "standard" } } },
    host: {
      settings: () => ({
        writer: { provider: "a", model: "w" },
        editor: { provider: "b", model: "e" },
      }),
    },
    async model(id, _title, _role, _card, input, shape, parse) {
      ids.push(id);
      if (shape.includes('{"hard"'))
        return parse(
          JSON.stringify({
            hard: [{ location: "末段", quote: "另一张票", impact: "来历不明", fix: "交代来历" }],
            suggestions: [],
          }),
        );
      if (input.persona)
        return parse(
          JSON.stringify({ winner: "B", reason: "B 更紧", abandonA: "首段", abandonB: "未发现" }),
        );
      return parse(
        JSON.stringify({ title: "归站", body: input.draft.body, resolved: ["已交代来历"] }),
      );
    },
  };
  const result = await editDraft(run, { title: "归站", body: text }, "", "");
  assert.equal(result.unresolved, true);
  assert.equal(result.rounds, 2);
  assert.equal(result.review.hard.length, 1);
  assert.deepEqual(ids, ["review-0", "revise-0", "review-1", "revise-1", "review-2"]);
  const selection = await selectDraft(
    run,
    [
      { title: "甲", body: "甲稿" },
      { title: "乙", body: "乙稿" },
    ],
    "toutiao",
  );
  assert.equal(selection.comparisons.length, 1);
  assert.equal(selection.comparisons[0].reasons.length, 6);
  assert.ok(selection.comparisons[0].reasons[0].startsWith("四五十岁的资讯读者"));
  const votes = ids.filter((id) => id.startsWith("pair-"));
  assert.deepEqual(votes.slice(0, 2), ["pair-1-0-0", "pair-1-0-1"], "先跑两个位置预热前缀");
});

test("停止原因写进记录：任务预算、余额不足、作者暂停为可恢复暂停，鉴权失败为失败且不重试", async () => {
  const fixtureDir = path.join(root, "packages/toutiao/skill/tests/fixtures"),
    card = JSON.parse(await readFile(path.join(fixtureDir, "story_long_card.json"), "utf8"));
  const req = {
    ...request("article"),
    grade: "economy",
    line: "story",
    instruction: "解释精卫填海原典",
    source: "《山海经》：精卫常衔西山之木石，以堙于东海。",
  };
  async function run(respond, engine, act) {
    const f = await fixture(respond, {}, engine);
    try {
      const store = new ArticleStore(f.data),
        meta = await store.create("story", { line: "故事线", genre: "长图文" }),
        target = { mode: "toutiao", root: f.data, article: meta.id };
      await store.writeCard(meta.id, card);
      await f.host.workflows.start(target, req);
      await act?.(f, target);
      return { state: await f.done(target), calls: f.model.calls.length };
    } finally {
      await f.close();
    }
  }
  const tight = { guided: true, grade: "economy", inputBudget: 24000, runBudget: 2000 };
  const budget = await run((call) => respondStage(call, {}), tight);
  assert.equal(budget.state.state, "paused", budget.state.error);
  assert.equal(budget.state.reason, "run-budget");

  const balance = await run(() => ({ status: 402, error: "Insufficient Balance" }));
  assert.equal(balance.state.state, "paused", balance.state.error);
  assert.equal(balance.state.reason, "balance");

  const auth = await run(() => ({
    status: 401,
    error: "Incorrect API key provided. See https://x/account/billing for details",
  }));
  assert.equal(auth.state.state, "failed", auth.state.error);
  assert.equal(auth.state.reason, "auth");
  assert.match(auth.state.error, /鉴权或权限失败/);

  const hold = { held: false };
  const stopped = await run(
    () => {
      hold.held = true;
      return { wait: true };
    },
    undefined,
    async (f, target) => {
      await until(() => hold.held);
      await f.host.workflows.stop(target);
    },
  );
  assert.equal(stopped.state.state, "paused", stopped.state.error);
  assert.equal(stopped.state.reason, "stopped");
});

/** A fanqie work with complete outlines for `ids`, opened as the desktop target. */
async function fanqieWork(f, key, ids) {
  const paths = await ensureStorage(null, { storageRoot: f.data });
  const { dir } = await createWork(paths, { title: key, key });
  for (const id of ids) await setOutline(dir, id, plan, "归站");
  return { dir, target: { mode: "fanqie", root: f.data, work: path.basename(dir) } };
}
async function finalize(dir, id) {
  await updateChapter(dir, { id, body });
  await updateChapter(dir, {
    id,
    status: "reviewed",
    expectedRevision: (await readChapter(dir, id)).revision,
  });
  await updateChapter(dir, { id, status: "final" });
}
const pendingLedger = async (f, target) =>
  JSON.parse(
    await readFile(
      path.join(f.home, "workflows", f.host.key(target), "pending-ledger.json"),
      "utf8",
    ),
  ).chapters;

test("新建任务覆盖可继续的任务前先经作者确认；取消则原任务照常恢复，应用内已确认则直接开始", async () => {
  const control = { holdNext: false, held: false };
  const f = await fixture((call) => respondStage(call, control));
  try {
    const { target } = await fanqieWork(f, "confirm", ["c001", "c002"]);
    const hold = async (chapter) => {
      control.holdNext = true;
      control.held = false;
      await f.host.workflows.start(target, request("chapter", chapter));
      await until(() => control.held);
      await f.host.workflows.stop(target);
      const paused = await f.host.workflows.status(target);
      assert.equal(paused.state, "paused");
      return paused;
    };
    const paused = await hold("c001");
    f.control.confirm = false;
    await assert.rejects(
      f.host.workflows.start(target, request("chapter", "c002")),
      /已取消新建任务/,
    );
    assert.equal((await f.host.workflows.status(target)).id, paused.id, "指针仍指向原任务");
    assert.equal(f.host.workflows.busy(target), false);
    await f.host.workflows.start(target, paused.request, true);
    let state = await f.done(target);
    assert.equal(state.id, paused.id);
    assert.equal(state.state, "awaiting-author", state.error);

    const second = await hold("c002");
    f.control.confirm = true;
    await f.host.workflows.start(target, request("chapter", "c001"));
    state = await f.done(target);
    assert.notEqual(state.id, second.id);
    assert.equal(state.state, "awaiting-author", state.error);
    assert.ok((await f.host.workflows.history(target)).some((row) => row.id === second.id));

    // The renderer asked in the app already: `replace` must not ask again.
    const third = await hold("c002");
    f.control.confirm = false;
    const replaced = await f.host.workflows.replace(target, request("chapter", "c001"));
    assert.notEqual(replaced.id, third.id);
    state = await f.done(target);
    assert.equal(state.state, "awaiting-author", state.error);
  } finally {
    await f.close();
  }
});

test("记账给失败与待采用的任务让位并排队；放行后两章依次补记，队列清空", async () => {
  const control = { failDrafts: true };
  const f = await fixture((call) => {
    const text = packet(call),
      input = stageInput(text),
      answer = (value) => ({ text: JSON.stringify(value) });
    if (input?.scenePlan && control.failDrafts) return { text: "不是JSON" };
    if (text.includes("只细化未来3至5章"))
      return answer({ chapters: [4, 5, 6].map((n) => ({ id: `c00${n}`, ...plan })) });
    if (text.includes('返回 {"facts"'))
      return answer({ facts: [], summary: "取回车票", hook: "悬念", emotion: 3 });
    return respondStage(call, {});
  });
  try {
    const { dir, target } = await fanqieWork(f, "yield", ["c001", "c002", "c003"]);
    await finalize(dir, "c001");
    await finalize(dir, "c002");
    await f.host.workflows.start(target, { ...request("chapter", "c003"), grade: "economy" });
    const failed = await f.done(target);
    assert.equal(failed.state, "failed");

    await f.host.notify(target, { operation: "/chapter/finalize", chapter: "c001" });
    const after = await f.host.workflows.status(target);
    assert.equal(after.id, failed.id, "定稿不覆盖失败任务的指针");
    assert.equal(after.state, "failed");
    assert.deepEqual(await pendingLedger(f, target), ["c001"]);
    assert.ok(f.events.some((event) => /记账已排队/.test(event.error ?? "")));
    control.failDrafts = false;
    await f.host.workflows.start(target, after.request, true);
    const retried = await f.done(target);
    assert.equal(retried.id, failed.id, "从失败处重试仍可用");
    assert.equal(retried.state, "awaiting-author", retried.error);

    await f.host.workflows.start(target, request("book", ""));
    const book = await f.done(target);
    assert.equal(book.state, "awaiting-author", book.error);
    await f.host.notify(target, { operation: "/chapter/finalize", chapter: "c002" });
    assert.equal((await f.host.workflows.status(target)).id, book.id, "待采用方案保留");
    assert.deepEqual(await pendingLedger(f, target), ["c001", "c002"]);
    await f.host.workflows.apply(target);
    assert.equal((await readWorkMeta(dir)).chapters.length, 6, "方案仍可采用");

    await f.host.notify(target, { operation: "/chapter/finalize", chapter: "c002" });
    await until(
      async () => !f.host.isRunning(target) && (await pendingLedger(f, target)).length === 0,
    );
    const recorded = (await f.host.workflows.continuity(target)).chapters.map((row) => row.id);
    assert.deepEqual(recorded.sort(), ["c001", "c002"]);
    const ledgers = (await f.host.workflows.history(target)).filter(
      (row) => row.request.kind === "ledger",
    );
    assert.deepEqual(
      ledgers.map((row) => row.state),
      ["awaiting-author", "awaiting-author"],
    );
  } finally {
    await f.close();
  }
});

test("待补记账队列损坏时报错并提示作者重跑记账，不当作空队列", async () => {
  const f = await fixture((call) => respondStage(call, {}));
  try {
    const { dir, target } = await fanqieWork(f, "broken", ["c001"]);
    await finalize(dir, "c001");
    const file = path.join(f.home, "workflows", f.host.key(target), "pending-ledger.json");
    await mkdir(path.dirname(file), { recursive: true });
    for (const broken of ["{坏", '{"chapters":"c001"}', '{"chapters":[1]}']) {
      await writeFile(file, broken);
      await f.host.notify(target, { operation: "/chapter/finalize", chapter: "c001" });
      assert.match(f.events.at(-1).error, /待补记账队列已损坏.*定稿记账/);
      assert.equal(await readFile(file, "utf8"), broken, "损坏文件原样保留");
    }
    assert.equal(await f.host.workflows.status(target), undefined, "没有启动记账");
  } finally {
    await f.close();
  }
});

test("恢复：标题矩阵完成后发了同名文章，已完成阶段不被重新判为不合格", async () => {
  const fixtureDir = path.join(root, "packages/toutiao/skill/tests/fixtures"),
    articleBody = await readFile(path.join(fixtureDir, "story_long_good.md"), "utf8"),
    card = JSON.parse(await readFile(path.join(fixtureDir, "story_long_card.json"), "utf8"));
  const title = card["主标题"],
    titles = [title, ...card["备选标题"]];
  const control = { holdNext: true, held: false };
  const f = await fixture((call) => {
    const text = packet(call),
      input = stageInput(text),
      answer = (value) => ({ text: JSON.stringify(value) });
    if (input?.sections) return respondStage(call, {});
    if (text.includes('返回 {"titles"')) return answer({ titles });
    if (text.includes('返回 {"opening"'))
      return answer({ opening: "精卫飞来", structure: "逐项解读原典", extension: "比较西西弗斯" });
    if (input?.blueprint) {
      if (control.holdNext) {
        control.holdNext = false;
        control.held = true;
        return { wait: true };
      }
      return answer({ title, body: articleBody });
    }
    if (text.includes('返回 {"hard"')) return answer({ hard: [], suggestions: [] });
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
    await until(() => control.held);
    await f.host.workflows.stop(target);
    const paused = await f.host.workflows.status(target);
    assert.equal(paused.state, "paused");
    assert.equal(paused.steps.find((row) => row.id === "headlines").status, "complete");
    // While paused the author published another article under one of the alternative titles.
    const other = await store.create("other", { line: "故事线", genre: "长图文" });
    await store.update(other.id, (row) => {
      row.headlines = { main: titles[1], alts: [] };
    });
    const calls = f.model.calls.length;
    await f.host.workflows.start(target, req, true);
    const state = await f.done(target);
    assert.equal(state.state, "awaiting-author", state.error);
    assert.equal(state.id, paused.id);
    assert.ok(
      !f.model.calls.slice(calls).some((call) => packet(call).includes('返回 {"titles"')),
      "标题矩阵不重新生成",
    );
  } finally {
    await f.close();
  }
});

test("T124 方法缓存不带作品私有数据，跨书复用且模型变化重新生成", async () => {
  const { WorkflowJournal } = await import("../../build/core/src/workflow.js");
  const { WorkflowRun } = await import("../../apps/desktop/out-test/workflow-run.mjs");
  const { stageCard } = await import("../../apps/desktop/out-test/workflow-methods.mjs");
  const f = await fixture((call) => respondStage(call, {}));
  try {
    const create = async (number) =>
      new WorkflowRun(
        f.host,
        await WorkflowJournal.open(
          path.join(f.home, `card-${number}.json`),
          { ...request("chapter"), instruction: `PRIVATE INSTRUCTION ${number}` },
          "hash",
          "basis",
          () => {},
        ),
        {
          stable: `PRIVATE BOOK ${number}`,
          material: [{ name: "private", text: "PRIVATE MATERIAL", required: true }],
          assertCurrent: async () => {},
        },
        { inputBudget: 24000, runBudget: 1200000, grade: "standard", guided: true },
        new AbortController().signal,
      );
    await stageCard(await create(1), "toutiao", "s3-headline");
    assert.equal(f.model.calls.length, 1);
    assert.doesNotMatch(
      JSON.stringify(f.model.calls),
      /PRIVATE BOOK|PRIVATE INSTRUCTION|PRIVATE MATERIAL/,
    );
    await stageCard(await create(2), "toutiao", "s3-headline");
    assert.equal(f.model.calls.length, 1);
    f.host.settings().planner.model = "changed-planner";
    await stageCard(await create(3), "toutiao", "s3-headline");
    assert.equal(f.model.calls.length, 2);
  } finally {
    await f.close();
  }
});

test("T123 非法驱动当场重试，QA 精修后事实链绑定终稿", async () => {
  const dir = path.join(root, "packages/toutiao/skill/tests/fixtures"),
    body = await readFile(path.join(dir, "story_long_good.md"), "utf8"),
    card = JSON.parse(await readFile(path.join(dir, "story_long_card.json"), "utf8"));
  card["出处"] = card["出处"].map((item) => ({ ...item, 链接: "作者素材" }));
  let cardCalls = 0;
  const f = await fixture((call) => {
    const text = packet(call),
      input = stageInput(text),
      answer = (value) => ({ text: JSON.stringify(value) });
    if (input?.sections) return respondStage(call, {});
    if (text.includes("返回合法立项卡"))
      return answer({ ...card, 主驱动: ++cardCalls === 1 ? "非法驱动" : card["主驱动"] });
    if (text.includes('返回 {"titles"'))
      return answer({ titles: [card["主标题"], ...card["备选标题"]] });
    if (text.includes('返回 {"opening"'))
      return answer({ opening: "精卫飞来", structure: "原典解读", extension: "比较西西弗斯" });
    if (input?.blueprint) return answer({ title: card["主标题"], body: body + "\n本文由AI生成。" });
    if (text.includes('返回 {"hard"')) return answer({ hard: [], suggestions: [] });
    if (text.includes('返回 {"claims"'))
      return answer({ claims: [{ claim: "精卫", quote: "精卫", kind: "quotation" }] });
    if (input?.qa) return answer({ title: card["主标题"], body });
    throw new Error("未覆盖阶段 " + text.slice(-200));
  });
  try {
    const store = new ArticleStore(f.data),
      meta = await store.create("story", { line: "故事线", genre: "长图文" }),
      target = { mode: "toutiao", root: f.data, article: meta.id };
    await f.host.workflows.start(target, {
      ...request("article"),
      grade: "economy",
      line: "story",
      instruction: "解释精卫填海原典",
      source: "《山海经》：精卫常衔西山之木石，以堙于东海。",
    });
    const state = await f.done(target);
    assert.equal(state.state, "awaiting-author", state.error);
    assert.equal(state.steps.find((row) => row.id === "article-card").attempts, 2);
    assert.equal(state.steps.find((row) => row.id === "qa-0").output.pass, false);
    const final = state.steps.find((row) => row.id === "facts-final");
    assert.ok(final);
    assert.deepEqual(state.steps.find((row) => row.id === "prepared").output.facts, final.output);
    assert.match(body, new RegExp(final.output.claims[0].claim));
  } finally {
    await f.close();
  }
});

test("追读P1：单元与章纲采用、证据记账、十章建议进入规划，旧正文修改后停用旧账", async () => {
  let nextPosition = 1;
  const quote = "他在门缝里摸到了另一张票。";
  const pursuit = {
    payoffs: [{ type: "解谜", quote }],
    terms: [{ name: "另一张票", action: "introduced", quote }],
    characters: [
      { name: "林川", tag: "取票者", action: "debut", quote: "林川把手里的车票递到窗口。" },
    ],
    threads: [{ name: "另一张票来历", span: "short", action: "open", due: 13, quote }],
  };
  const f = await fixture(
    (call) => {
      const contents = packet(call),
        input = stageInput(contents);
      if (contents.includes('返回 {"units"'))
        return {
          text: JSON.stringify({
            units: [
              {
                id: "u1",
                title: "归站",
                from: 1,
                to: 12,
                question: "票从何来",
                payoffs: ["取票"],
                settlement: "拿到票",
                next: "票的来历",
              },
              {
                id: "u2",
                title: "启程",
                from: 13,
                to: 24,
                question: "列车去向",
                payoffs: ["登车"],
                settlement: "找到列车",
                next: "下一站",
              },
            ],
          }),
        };
      if (contents.includes("只细化未来3至5章"))
        return {
          text: JSON.stringify({
            chapters: [0, 1, 2].map((offset) => {
              const position = nextPosition + offset;
              return {
                id: `c${String(position).padStart(3, "0")}`,
                ...plan,
                function: "冲突",
                unit: position <= 12 ? "u1" : "u2",
                unitPos: position <= 12 ? position : position - 12,
                hookType: "悬念",
                pressure: 1,
                newTerms: [],
                newCharacters: [],
                threadsOpen: [],
                threadsClose: [],
              };
            }),
          }),
        };
      if (input?.body && Array.isArray(input.previous))
        return {
          text: JSON.stringify({ facts: [], summary: "取回票", hook: "悬念", emotion: 3, pursuit }),
        };
      if (contents.includes('返回 {"risks"'))
        return {
          text: JSON.stringify({
            risks: [],
            forgotten: [],
            rhythm: ["钩子需要变化"],
            constraints: ["后3章安排一次主角主导兑现"],
          }),
        };
      return respondStage(call, {});
    },
    { fanqie: { pursuit: { enabled: true } } },
  );
  try {
    const { dir, target } = await fanqieWork(f, "pursuit", []);
    await f.host.workflows.start(target, request("book", ""));
    let result = await f.done(target);
    assert.equal(result.state, "awaiting-author", result.error);
    await f.host.workflows.apply(target);
    assert.equal((await readChapter(dir, "c001")).outline.unit, "u1");
    assert.deepEqual((await readChapter(dir, "c001")).outline.newTerms, []);
    assert.equal((await readWorkMeta(dir)).planning.units.length, 2);
    for (let n = 4; n <= 10; n++)
      await setOutline(dir, `c${String(n).padStart(3, "0")}`, { ...plan, unit: "u1" }, "归站");
    for (let n = 1; n <= 10; n++) await finalize(dir, `c${String(n).padStart(3, "0")}`);
    await f.host.workflows.start(target, request("ledger", "c009"));
    assert.equal((await f.done(target)).state, "awaiting-author");
    await f.host.workflows.start(target, request("ledger", "c010"));
    result = await f.done(target);
    assert.equal(result.state, "awaiting-author", result.error);
    let ledger = await f.host.workflows.continuity(target);
    assert.deepEqual(ledger.chapters.find((row) => row.id === "c010").pursuit, pursuit);
    assert.equal(ledger.chapters.find((row) => row.id === "c010").position, 10);
    assert.deepEqual(ledger.audit.constraints, ["后3章安排一次主角主导兑现"]);
    await f.host.workflows.start(target, request("ledger", "c010"));
    result = await f.done(target);
    assert.equal(result.state, "awaiting-author", result.error);
    ledger = await f.host.workflows.continuity(target);
    assert.equal(ledger.chapters.length, 2, "重跑记账不重复累加");
    nextPosition = 11;
    let calls = f.model.calls.length;
    await f.host.workflows.start(target, request("book", ""));
    result = await f.done(target);
    assert.equal(result.state, "awaiting-author", result.error);
    const planning = JSON.stringify(f.model.calls.slice(calls).map((call) => call.messages));
    assert.match(planning, /后3章安排一次主角主导兑现/);
    assert.match(planning, /chaptersSince.*1/);
    assert.match(planning, /另一张票来历/);
    assert.match(planning, /unitPayoffs/);
    const file = path.join(dir, "chapters/c009.md");
    await writeFile(file, (await readFile(file, "utf8")) + "\n灯还亮着。");
    calls = f.model.calls.length;
    await f.host.workflows.start(target, request("book", ""));
    result = await f.done(target);
    assert.equal(result.state, "awaiting-author", result.error);
    const refreshed = JSON.stringify(f.model.calls.slice(calls).map((call) => call.messages));
    assert.doesNotMatch(refreshed, /后3章安排一次主角主导兑现/);
    assert.match(refreshed, /recorded.*1/);
    await f.host.workflows.start(target, request("ledger", "c009"));
    result = await f.done(target);
    assert.equal(result.state, "awaiting-author", result.error);
    calls = f.model.calls.length;
    await f.host.workflows.start(target, request("book", ""));
    result = await f.done(target);
    assert.equal(result.state, "awaiting-author", result.error);
    assert.doesNotMatch(
      JSON.stringify(f.model.calls.slice(calls).map((call) => call.messages)),
      /后3章安排一次主角主导兑现/,
    );
  } finally {
    await f.close();
  }
});

test("追读P1：假引文不落盘，旧版同正文记账可以补齐新账本", async () => {
  let valid = false;
  const f = await fixture(
    (call) => {
      const input = stageInput(packet(call));
      if (input?.body && Array.isArray(input.previous))
        return {
          text: JSON.stringify({
            facts: [],
            summary: "取回票",
            hook: "悬念",
            emotion: 3,
            pursuit: {
              payoffs: [
                { type: "解谜", quote: valid ? "他在门缝里摸到了另一张票。" : "正文里没有这句话" },
              ],
              terms: [],
              characters: [],
              threads: [],
            },
          }),
        };
      return respondStage(call, {});
    },
    { fanqie: { pursuit: { enabled: true } } },
  );
  try {
    const { dir, target } = await fanqieWork(f, "pursuit-evidence", ["c001"]);
    await finalize(dir, "c001");
    const old = {
      schema: 1,
      facts: [],
      pending: [],
      chapters: [{ id: "c001", hash: hash(body), summary: "旧记账", hook: "悬念", emotion: 3 }],
    };
    const file = path.join(dir, "writer-continuity.json");
    await writeFile(file, JSON.stringify(old));
    await f.host.workflows.start(target, request("ledger", "c001"));
    let result = await f.done(target);
    assert.equal(result.state, "failed");
    assert.match(result.error, /证据不在定稿正文/);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), old);
    valid = true;
    await f.host.workflows.start(target, request("ledger", "c001"));
    result = await f.done(target);
    assert.equal(result.state, "awaiting-author", result.error);
    const recorded = (await f.host.workflows.continuity(target)).chapters;
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].pursuit.payoffs.length, 1);
    assert.equal(recorded[0].revision, (await readChapter(dir, "c001")).revision);
  } finally {
    await f.close();
  }
});

test("追读P2/P3：写手规则与四账摘要受限，前章1500字加摘要，读者与审读拿到数值", async () => {
  const f = await fixture(
    (call) => {
      const input = stageInput(packet(call));
      if (input?.sections)
        return {
          text: JSON.stringify({
            rules: input.sections.map((row) => ({ id: row.id, text: "保留因果、声线与边界" })),
          }),
        };
      return respondStage(call, {});
    },
    { fanqie: { pursuit: { enabled: true, radar: true } } },
  );
  try {
    const { dir, target } = await fanqieWork(f, "pursuit-cards", ["c001", "c002"]);
    const previous =
      "开头独有的旧事。" +
      "街上的风掀起纸票，他顺着站牌找到了旧窗。".repeat(140) +
      "末尾的锁还没打开。";
    await updateChapter(dir, { id: "c001", body: previous });
    await updateChapter(dir, {
      id: "c001",
      status: "reviewed",
      expectedRevision: (await readChapter(dir, "c001")).revision,
    });
    await updateChapter(dir, { id: "c001", status: "final" });
    await writeFile(
      path.join(dir, "writer-continuity.json"),
      JSON.stringify({
        schema: 1,
        facts: [],
        pending: [],
        chapters: [
          { id: "c001", hash: hash(previous), summary: "有效前章摘要", hook: "危机", emotion: 3 },
        ],
      }),
    );
    await f.host.workflows.start(target, { ...request("chapter", "c002"), grade: "economy" });
    const result = await f.done(target);
    assert.equal(result.state, "awaiting-author", result.error);
    const drafting = f.model.calls.find((call) => stageInput(packet(call))?.scenePlan);
    const prompt = packet(drafting);
    const card = prompt.split("## 本阶段方法\n")[1].split("\n\n## 本阶段输入")[0];
    assert.ok([...card].length <= 2500);
    assert.match(card, /prose:/);
    assert.match(card, /rhythm:/);
    assert.match(card, /开篇规格/);
    assert.match(card, /四账摘要/);
    const full = JSON.stringify(drafting.messages);
    assert.match(full, /有效前章摘要/);
    assert.ok(full.includes(previous.slice(-1500)));
    assert.ok(!full.includes("开头独有的旧事"));
    const review = f.model.calls.find((call) => {
      const input = stageInput(packet(call));
      return input?.draft && !input.report;
    });
    assert.equal(stageInput(packet(review)).reading.metrics.characters > 0, true);
    const delivered = result.steps.find((step) => step.id === "delivery").output;
    assert.ok(delivered.reading.metrics.characters > 0);
    assert.ok(Array.isArray(delivered.reading.warnings));
  } finally {
    await f.close();
  }
});
