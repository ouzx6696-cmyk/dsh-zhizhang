/** Explicit real-model acceptance. Credentials stay in env; missing results stay pending. */
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  aggregateLogs,
  blindAssign,
  bookOfCase,
  casePlan,
  describeMode,
  finalizeSummary,
  normalizeMode,
  pacePromptLine,
  profileMetric,
  resolveMode,
} from "./acceptance-lib.mjs";
import { buildJudgePrompt, judgeSummary, parseJudgeOutput } from "../packages/core/eval/score.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const output = path.resolve(flag("--output") || "acceptance-results");
const headCases = [
  ["资讯线长图文", "解释新闻对普通人的实际影响"],
  ["资讯线长图文", "围绕真实新闻中的一个核心问题成文"],
  ["资讯线长图文", "用另一读者处境解释给定新闻"],
  ["故事线长图文", "以愚公移山为题材，明确虚构演绎"],
  ["故事线长图文", "以神话中的守门人为题材，明确虚构演绎"],
  ["微头条", "围绕第一条给定新闻写微头条"],
  ["微头条", "围绕第二条给定新闻写微头条"],
];
let mode = resolveMode({
  matrix: process.argv.includes("--matrix"),
  long: process.argv.includes("--long"),
  finalizeTrack: process.argv.includes("--finalize-track"),
  judge: process.argv.includes("--judge"),
  ab: process.argv.includes("--ab"),
  v2: process.argv.includes("--v2"),
});
let plan = casePlan(mode);
if (mode.v2 && !mode.ab) throw new Error("--v2 只在 --ab 下有意义：它是 A/B 的 RC3 臂开关");
let TASK_TIMEOUT_MS = (mode.long ? 30 : 15) * 60 * 1000;
const template = {
  models: {
    writer: {
      provider: "deepseek",
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKeyEnv: "WRITER_ACCEPTANCE_KEY",
      contextWindow: 128000,
      maxTokens: 8192,
      reasoning: false,
      thinkingLevel: "off",
    },
    editor: {
      provider: "deepseek",
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-reasoner",
      apiKeyEnv: "WRITER_ACCEPTANCE_KEY",
      contextWindow: 128000,
      maxTokens: 8192,
      reasoning: true,
      thinkingLevel: "medium",
    },
    planner: null,
  },
  newsUrls: [],
  novelIdea: "一个守夜人在即将停用的车站，接到了明天才会发生的求救电话。",
};
await mkdir(output, { recursive: true });
const json = async (file) => JSON.parse(await readFile(path.join(output, file), "utf8"));
const save = async (file, value) =>
  writeFile(path.join(output, file), JSON.stringify(value, null, 2));
const readOptional = async (file) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const list = async (folder) => {
  try {
    return await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};
const scores = () =>
  Object.fromEntries(
    ["default", "original"].map((profile) => [
      profile,
      {
        cases: plan.caseIds
          .filter((id) => !id.endsWith("-plan"))
          .map((id) => ({ id, readability: null, voice: null })),
        continuityErrors: null,
        resumedWithoutExtraSetup: null,
        actualCost: null,
        currency: "CNY",
      },
    ]),
  );
let readers;
async function artifact(profile, row) {
  readers ||= await Promise.all([
    import("../apps/desktop/out-test/work-store.mjs"),
    import("../apps/desktop/out-test/review.mjs"),
    import("../apps/desktop/out-test/article-store.mjs"),
  ]);
  const [store, review, { ArticleStore }] = readers;
  if (row.caseId.startsWith("head-")) {
    const index = Number(row.caseId.slice(5)) - 1;
    const articles = new ArticleStore(path.join(output, profile, "toutiao"));
    const meta = await articles.get(row.article);
    const draft = articles.currentDraft(meta);
    if (!draft || draft.rev !== row.revision) throw new Error("文章当前版本与任务记录不一致");
    const digest = (text) => createHash("sha256").update(text).digest("hex");
    const draftText = await articles.readDraft(meta.id, draft.rev);
    if (digest(draftText) !== draft.sha256) throw new Error("文章正文指纹不一致");
    const line = index === 3 || index === 4 ? "故事线" : "资讯线";
    const genre = index >= 5 ? "微头条" : "长图文";
    if (meta.line !== line || meta.genre !== genre) throw new Error("文章类别与指定任务不一致");
    // 交稿单文件由 S7 toutiao_delivery_save 写入（不需作者确认）；delivered 标志是作者采用，
    // 标准轨 confirm 恒 false 不会置位，不能作为验收判据
    const delivery = await readFile(articles.deliveryPath(meta.id), "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (!delivery.trim()) throw new Error("缺少本轮交稿单");
    const qa = articles.latestQaFor(meta),
      cardSha = await articles.cardSha(meta.id);
    if (!qa || !qa.pass || qa.card_sha256 !== cardSha)
      throw new Error("缺少当前稿件与立项卡对应的质检");
    // 首次／两次内过线统计保留真实尝试顺序；各次须对应实际存留的稿件和立项卡。
    const attempts = await Promise.all(
      meta.qa.slice(0, 2).map(async (q) => {
        const prior = meta.drafts.find((d) => d.rev === q.rev);
        return prior &&
          prior.sha256 === q.sha256 &&
          q.card_sha256 === cardSha &&
          digest(await articles.readDraft(meta.id, q.rev)) === q.sha256
          ? q
          : null;
      }),
    );
    return { article: meta, attempts, text: draftText };
  }
  const book = bookOfCase(plan.books, row.caseId);
  if (!book) throw new Error("任务编号不属于任何长篇任务组：" + row.caseId);
  if (!row.work) throw new Error("任务没有对应作品");
  const dir = await store.resolveWorkDir(
    { works: path.join(output, profile, "novels", "works") },
    row.work,
  );
  if (row.caseId === book.prefix + "-plan") {
    for (const id of book.chapterIds) {
      const chapter = await store.readChapter(dir, id);
      if (
        ![
          "pov",
          "targetWords",
          "locks",
          "knowledge",
          "synopsis",
          "conflict",
          "beats",
          "ending",
        ].every((key) =>
          typeof chapter.outline[key] === "number"
            ? chapter.outline[key] > 0
            : !!chapter.outline[key]?.trim(),
        )
      )
        throw new Error(id + " 章纲不完整");
    }
    return { work: path.basename(dir) };
  }
  const id = row.caseId.slice(book.prefix.length + 1);
  if (row.chapter !== id) throw new Error("章节与任务编号不一致");
  const chapter = await store.readChapter(dir, id);
  if (!chapter.body.trim()) throw new Error("章节没有正文");
  const report = await review.latestReview(dir, id);
  if (
    !report ||
    report.chapter !== id ||
    report.by !== "editor" ||
    !report.reread_full ||
    report.body_sha256 !== review.bodyFingerprint(chapter.body)
  )
    throw new Error("缺少独立编辑对当前正文的完整审读回报");
  return { review: report, title: chapter.title, text: chapter.body };
}
async function instrumentationFor(profile) {
  const folder = path.join(output, profile, ".agent", "logs");
  const names = (await list(folder))
    .filter((row) => row.isFile() && row.name.endsWith(".jsonl"))
    .map((row) => row.name)
    .sort();
  if (!names.length) return null;
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      lines: (await readFile(path.join(folder, name), "utf8")).split(/\r?\n/),
    })),
  );
  return aggregateLogs(files);
}
async function judgeFor(profile) {
  const judge = await readOptional(path.join(output, profile, "judge.json"));
  return judge ? judgeSummary(judge.results) : null;
}
async function summarize() {
  const records = await json("run-records.json"),
    subjective = await json("subjective-scores.json"),
    metrics = [];
  const texts = {};
  for (const profile of mode.ab ? ["default"] : ["default", "original"]) {
    const rows = records.filter((row) => row.profile === profile),
      articles = [],
      reviews = [],
      issues = [];
    let firstQaPass = 0,
      twoQaPass = 0,
      editorPass = 0,
      hardIssues = 0;
    const textsByCase = new Map(),
      seenArticles = new Set();
    const pass = (q) => q?.pass && q.score >= 84 && q.fail_count === 0 && q.hard_gates.length === 0;
    for (const id of plan.caseIds) {
      const matches = rows.filter((row) => row.caseId === id);
      if (matches.length !== 1 || matches[0].state !== "completed") {
        issues.push(id + "：任务缺失、重复或未完成");
        continue;
      }
      const row = matches[0];
      try {
        const book = bookOfCase(plan.books, row.caseId);
        const planRow = book ? rows.find((other) => other.caseId === book.prefix + "-plan") : null;
        if (book && row.caseId !== book.prefix + "-plan" && row.work !== planRow?.work)
          throw new Error("章节不属于本轮规划的同一本书");
        const result = await artifact(profile, row);
        if (result.article) {
          if (seenArticles.has(row.article)) throw new Error("同一文章被用于多个任务");
          seenArticles.add(row.article);
          articles.push(result);
          if (pass(result.attempts[0])) firstQaPass++;
          if (result.attempts.some(pass)) twoQaPass++;
        }
        if (result.review) {
          reviews.push(result.review);
          if (result.review.verdict === "通过" && result.review.reread_full) editorPass++;
          hardIssues += result.review.hard_issues.length;
        }
        if (result.text)
          textsByCase.set(id, {
            kind: id.startsWith("head-") ? "article" : "chapter",
            ...(result.title ? { title: result.title } : {}),
            text: result.text,
          });
      } catch (error) {
        issues.push(id + "：" + error.message);
      }
    }
    if (
      rows.length !== plan.caseIds.length ||
      rows.some((row) => !plan.caseIds.includes(row.caseId))
    )
      issues.push("任务集合与所选模式约定不符（应为 " + plan.caseIds.length + " 项）");
    texts[profile] = textsByCase;
    const instrumentation = await instrumentationFor(profile),
      judge = await judgeFor(profile);
    metrics.push(
      profileMetric({
        profile,
        plan,
        author: subjective[profile],
        issues,
        articles: articles.length,
        firstQaPass,
        twoQaPass,
        reviews: reviews.length,
        editorPass,
        hardIssues,
        rows,
        instrumentation,
        judge,
      }),
    );
  }
  await save("metrics.json", metrics);
  const { complete, human, passed } = finalizeSummary(metrics, records, plan);
  // 盲评配对需要 default/original 两份文本；ab 臂每题只有一份，配对交给两臂对比报告
  const pairable = mode.ab
    ? []
    : plan.caseIds.filter(
        (id) => !id.endsWith("-plan") && texts.default.has(id) && texts.original.has(id),
      );
  if (pairable.length) {
    const assignments = blindAssign(pairable, mode.round ?? "default");
    await save(
      "BLIND-PAIRS.json",
      assignments.map(({ caseId, pairId, a, b }) => ({
        pairId,
        caseId,
        A: texts[a].get(caseId),
        B: texts[b].get(caseId),
      })),
    );
    await save("BLIND-KEY.json", {
      seed: mode.round ?? "default",
      pairs: assignments.map(({ caseId, pairId, a, b }) => ({ pairId, caseId, A: a, B: b })),
    });
  }
  const notes = [];
  if (mode.finalizeTrack)
    notes.push("本轨启用模拟作者确认（confirm 全部放行），run-records 各条已标 finalizeTrack。");
  if (metrics.some((row) => row.instrumentation))
    notes.push("方法交接、工具调用与上下文压缩的仪器统计见 metrics.json 的 instrumentation 节。");
  if (metrics.some((row) => row.judge))
    notes.push("读者评审分项见 metrics.json 的 judge 节与各方案 judge.json。");
  if (pairable.length)
    notes.push("成对盲评见 BLIND-PAIRS.json（A/B 匿名）；请评完再对照 BLIND-KEY.json 开 key。");
  await writeFile(
    path.join(output, "COMPARISON.md"),
    "# 默认与原版：真实执行记录\n\n|方案|文章数|首次质检过线|两次内过线|审读回报|编辑通过|平均硬伤|tokens|作者均分|\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n" +
      metrics
        .map(
          (row) =>
            `|${row.profile}|${row.articles}|${(row.firstQaPassRate * 100).toFixed(1)}%|${(row.twoQaPassRate * 100).toFixed(1)}%|${row.chapterReviews}|${(row.editorPassRate * 100).toFixed(1)}%|${row.averageHardIssues ?? "无数据"}|${row.tokens}|${row.authorAverage ?? "待评分"}|`,
        )
        .join("\n") +
      `\n\n记录完整：${complete ? "是" : "否"}；作者核验及实际费用完整：${human ? "是" : "否"}。${passed ? "达到计划建议线，仍由作者作最终判断。" : "尚不能判为通过，详见 metrics.json 中的缺项或未达线指标。"}\n\n单篇／单章用量见 run-records.json；费用由作者按服务商账单填写，不以 0 冒充未知费用。第 6 章前自动新对话，是否无需补充设定、连续性错误数由作者抽查。方法内容不因脚本结果自动改写。\n` +
      (notes.length ? "\n" + notes.join("\n") + "\n" : ""),
  );
  console.log("真实记录汇总完成：" + output);
}
if (process.argv.includes("--summarize")) {
  // 汇总不重跑模型，模式以 --run 写下的 mode.json 为准；旧输出目录没有该文件，沿用本次参数。
  const saved = await readOptional(path.join(output, "mode.json"));
  if (saved) {
    mode = normalizeMode(saved);
    plan = casePlan(mode);
  }
  await summarize();
  process.exit(0);
}
if (!process.argv.includes("--run")) {
  await save("acceptance-config.example.json", template);
  await save("subjective-scores.json", scores());
  await save("mode.json", { ...mode, round: null });
  await writeFile(
    path.join(output, "STATUS.md"),
    "# 真实模型验收\n\n状态：未执行。\n\n默认与原版各完成 7 篇头条、一本 " +
      plan.books[0].chapters +
      " 章长篇（第 6 章前开新对话）。" +
      describeMode(mode) +
      "\n\n填入至少两个真实新闻链接，配置模型 Key 环境变量，然后显式执行：\n\n```sh\nnode scripts/acceptance.mjs --run --config 配置文件 --output 输出目录\n```\n\n可选模式：--matrix 另加快爽／稳推／慢燃三本 10 章对照长篇；--finalize-track 模拟作者确认定稿与交稿；--long 主书 30 章定稿轨（含定稿轨行为，单任务超时 30 分钟）；--judge 任务完成后由评审模型按读者标尺为每篇头条稿与每章正文打分。\n\n作者填写 subjective-scores.json 中的每篇评分、连续性错误数、接续判断和账单费用后，使用 --summarize --output 输出目录重新汇总（模式从输出目录的 mode.json 读取），不重跑模型。未填或未完成的项目不视为通过。请使用新的输出目录，避免覆盖先前验收。\n",
  );
  console.log("已生成未执行的验收任务与评分模板：" + output);
  process.exit(0);
}
const configFile = flag("--config");
if (!configFile) throw new Error("真实验收须显式提供 --config");
// --resume 断点续跑：输出目录是上一轮（可能因端点故障中断）的同一轮，已完成任务不重跑，
// 失败任务重试；无 --resume 时保持"必须空目录"防混入旧记录
const resume = process.argv.includes("--resume");
if (!resume)
  for (const scope of ["default", "original"]) {
    if ((await list(path.join(output, scope))).length)
      throw new Error(`输出目录已有验收作品（${scope}），请使用新的 --output，避免混入旧记录`);
  }
const config = JSON.parse(await readFile(path.resolve(configFile), "utf8"));
if (!Array.isArray(config.newsUrls) || config.newsUrls.length < 2)
  throw new Error("请提供至少两个真实新闻链接");
// 中转端点可能有冷启动失败与零星空响应，单任务预算按端点实况放宽（默认仍 15/30 分钟）
if (config.taskTimeoutMinutes !== undefined) {
  if (
    typeof config.taskTimeoutMinutes !== "number" ||
    !Number.isFinite(config.taskTimeoutMinutes) ||
    config.taskTimeoutMinutes <= 0
  )
    throw new Error("taskTimeoutMinutes 须为正数（分钟）");
  TASK_TIMEOUT_MS = config.taskTimeoutMinutes * 60 * 1000;
}
// --only 冒烟/连通性检查：只跑 default 方案下单个任务；任务分发按 caseId 门控，集合校验仍按完整模式算
const only = flag("--only");
// ab 模式只跑 default 方案；两臂差异全部由 --v2 注入的 handoff.v2 承担
const profiles = only || mode.ab ? ["default"] : ["default", "original"];
if (only && !plan.caseIds.includes(only)) throw new Error(`--only 没有匹配到任务：${only}`);
for (const model of Object.values(config.models))
  if (model) {
    model.apiKey = process.env[model.apiKeyEnv];
    if (!model.apiKey) throw new Error("缺少模型凭据环境变量：" + model.apiKeyEnv);
  }
const { Sessions } = await import("../apps/desktop/out-test/session.mjs");
const { normalizeModels } = await import("../apps/desktop/out-test/models.mjs");
const { Diagnostics } = await import("../apps/desktop/out-test/diagnostics.mjs");
// 续跑一致性：模式参数必须与上一轮一致，已完成任务跳过，失败任务重试并替换旧失败记录
const prior = resume ? ((await readOptional(path.join(output, "run-records.json"))) ?? []) : [];
if (resume) {
  const savedMode = await readOptional(path.join(output, "mode.json"));
  // 只比四个模式布尔：round 是写入时的日期，不参与一致性判定
  const modeKeys = ["matrix", "long", "finalizeTrack", "judge", "ab", "v2"];
  if (savedMode && modeKeys.some((key) => normalizeMode(savedMode)[key] !== mode[key]))
    throw new Error("--resume 的输出目录 mode.json 与本次参数不一致，请用新 --output");
}
const completedKeys = new Set(
  prior.filter((row) => row.state === "completed").map((row) => `${row.profile}:${row.caseId}`),
);
const models = normalizeModels(config.models),
  all = prior;
await save("subjective-scores.json", scores());
await save("mode.json", { ...mode, round: new Date().toISOString().slice(0, 10) });
process.env.WRITER_TOUTIAO_SKILL_DIR = path.join(repo, "packages/toutiao/skill");
process.env.WRITER_FANQIE_SKILL_DIR = path.join(repo, "packages/fanqie/skill");
process.env.WRITER_TOUTIAO_DEFAULT_DIR = path.join(repo, "packages/toutiao/profiles/default");
process.env.WRITER_FANQIE_DEFAULT_DIR = path.join(repo, "packages/fanqie/profiles/default");
for (const profile of profiles) {
  const base = path.join(output, profile),
    home = path.join(base, ".agent"),
    novels = path.join(base, "novels"),
    toutiao = path.join(base, "toutiao");
  await Promise.all([home, novels, toutiao].map((folder) => mkdir(folder, { recursive: true })));
  process.env.WRITER_STATE_ROOT = home;
  const diagnostics = new Diagnostics(home);
  await diagnostics.init();
  let finish,
    target = { mode: "fanqie", root: novels };
  const sessions = new Sessions({
    home,
    python: process.env.WRITER_PYTHON || "python3",
    settings: () => models,
    emit: (event) => {
      if (event.event?.type === "agent_settled" && !event.editor) finish?.();
    },
    confirm: async () => mode.finalizeTrack,
    options: {
      fanqie: { profile, ...(mode.v2 ? { handoff: { v2: true } } : {}) },
      toutiao: { profile, ...(mode.v2 ? { handoff: { v2: true } } : {}) },
    },
    // 头条任务也会回调 created；target 只跟踪长篇，避免头条作品顶掉后续长篇任务的落点。
    created: async (_previous, next) => {
      if (next.mode === "fanqie") target = next;
    },
    extras: {
      log: (event, fields) => {
        void diagnostics.write(event, fields);
      },
    },
  });
  let consecutiveFailures = 0;
  const breaker = () => {
    if (consecutiveFailures >= 3)
      throw new Error("连续 3 个任务失败，停止本轮验收：请检查模型端点与配置后用新 --output 重跑");
  };
  const replaceStale = (caseId, entry) => {
    const stale = all.findIndex(
      (row) => row.profile === profile && row.caseId === caseId && row.state === "failed",
    );
    if (stale >= 0) all.splice(stale, 1);
    all.push(entry);
  };
  async function run(caseId, name, scope, text, focus = {}) {
    const before =
      scope.mode === "toutiao"
        ? new Set((await list(toutiao)).filter((row) => row.isDirectory()).map((row) => row.name))
        : null;
    let timer;
    const start = Date.now(),
      done = new Promise((resolve, reject) => {
        finish = resolve;
        timer = setTimeout(
          () => reject(new Error(`任务超过 ${TASK_TIMEOUT_MS / 60000} 分钟，请核对保留的作品`)),
          TASK_TIMEOUT_MS,
        );
      });
    try {
      await sessions.send(scope, text, focus);
      await done;
      const actual = scope.mode === "toutiao" ? scope : scope.work ? scope : target,
        view = await sessions.view(actual, 1000),
        last = view.messages.filter((message) => message.role === "assistant").at(-1);
      if (last?.stopReason === "error") throw new Error(last.errorMessage);
      const record = {
        profile,
        caseId,
        name,
        state: "completed",
        ...(mode.finalizeTrack ? { finalizeTrack: true } : {}),
        scope: actual,
        work: actual.work,
        chapter: focus.chapter,
        durationMs: Date.now() - start,
        tokens: view.task?.tokens ?? null,
        cost: view.task?.cost > 0 ? view.task.cost : null,
      };
      if (before) {
        const created = (await list(toutiao)).filter(
          (row) =>
            row.isDirectory() && /^\d{4}-\d{2}-\d{2}-/.test(row.name) && !before.has(row.name),
        );
        if (!created.length) throw new Error("每个头条任务须对应一篇新建文章");
        // 模型可能因校验摩擦弃稿重建：落点选内容最多的一篇（qa×10+草稿数加权），
        // 多篇行为如实记进 multiCreated，不静默也不误杀整段工作量
        const withData = await Promise.all(
          created.map(async (name) => {
            try {
              const meta = JSON.parse(
                await readFile(path.join(toutiao, name, "meta.json"), "utf8"),
              );
              return {
                name,
                rev: meta.current_rev,
                weight: (meta.qa?.length ?? 0) * 10 + (meta.drafts?.length ?? 0),
              };
            } catch (error) {
              if (error.code === "ENOENT") return { name, rev: null, weight: -1 };
              throw error;
            }
          }),
        );
        withData.sort((a, b) => b.weight - a.weight);
        if (created.length > 1) record.multiCreated = created.length;
        record.article = withData[0].name;
        record.revision = withData[0].rev;
      }
      await artifact(profile, record);
      replaceStale(caseId, record);
      consecutiveFailures = 0;
    } catch (error) {
      await sessions.stop(scope);
      replaceStale(caseId, {
        profile,
        caseId,
        name,
        state: "failed",
        reason: String(error.message),
        durationMs: Date.now() - start,
      });
      consecutiveFailures += 1;
      // 单任务失败记录后继续（基线要的是成功率与失败形态）；连续失败说明端点或配置坏了，熔断止损
    } finally {
      clearTimeout(timer);
      finish = undefined;
      await save("run-records.json", all);
      await writeFile(
        path.join(output, "STATUS.md"),
        `# 真实模型验收\n\n已记录 ${all.length} 项任务，其中失败 ${all.filter((item) => item.state === "failed").length} 项。${describeMode(mode)}未完成部分不得视为通过。作者评分、连续性抽查、真实费用待填写。\n`,
      );
    }
  }
  try {
    for (const [index, [genre, idea]] of headCases.entries()) {
      if (!plan.caseIds.includes("head-" + (index + 1))) continue;
      if (only && only !== "head-" + (index + 1)) continue;
      if (completedKeys.has(profile + ":head-" + (index + 1))) continue;
      await run(
        "head-" + (index + 1),
        `头条 ${index + 1} ${genre}`,
        { mode: "toutiao", root: toutiao },
        `新建并完成一篇${genre}：${idea}。本次新闻来源：${config.newsUrls.join("、")}。资讯事实须读取原网页，按当前方法方案推进至质检和交稿单；保留全部真实质检记录，不标记已交稿。`,
        { intent: "write" },
      );
      breaker();
    }
    const planScope = { mode: "fanqie", root: novels };
    for (const book of plan.books) {
      if (only && !(only === book.prefix + "-plan" || only.startsWith(book.prefix + "-c")))
        continue;
      const previousWork = target.work;
      let planRan = false;
      if (
        (!only || only === book.prefix + "-plan") &&
        !completedKeys.has(profile + ":" + book.prefix + "-plan")
      ) {
        await run(
          book.prefix + "-plan",
          `长篇开书${book.pace ? "（" + book.pace + "档）" : ""}`,
          planScope,
          `创建一本长篇，题材：${config.novelIdea}。${book.pace ? pacePromptLine(book.pace) : ""}使用规划角色完成根基与前 ${book.chapters} 章章纲，章号 ${book.chapterIds[0]} 到 ${book.chapterIds[book.chapterIds.length - 1]}；本轮只规划。`,
          { intent: "plan" },
        );
        breaker();
        planRan = true;
      } else if (completedKeys.has(profile + ":" + book.prefix + "-plan")) {
        // 续跑跳过开书：从上一轮记录恢复本书落点，避免章节写进别的作品
        const planRecord = prior.find(
          (row) =>
            row.profile === profile &&
            row.caseId === book.prefix + "-plan" &&
            row.state === "completed",
        );
        if (planRecord?.work) target = { mode: "fanqie", root: novels, work: planRecord.work };
      }
      // 每本书必须落到新作品；否则下一本的章节会写进上一本书，必须当场失败而不是混书。
      if (planRan && !only && target.work === previousWork)
        throw new Error("开书任务没有创建新作品：" + book.prefix);
      for (const [position, chapter] of book.chapterIds.entries()) {
        if (only && only !== book.prefix + "-" + chapter) continue;
        if (completedKeys.has(profile + ":" + book.prefix + "-" + chapter)) continue;
        // 中途换会话的位置随书长缩放：10 章在第 6 章前，3 章在第 2 章前
        const sessionBreak = Math.min(5, book.chapters - 2);
        if (position === sessionBreak && !only) await sessions.newConversation(target);
        await run(
          book.prefix + "-" + chapter,
          `长篇第 ${position + 1} 章${book.pace ? "（" + book.pace + "档）" : ""}`,
          target,
          `完成第 ${position + 1} 章（${chapter}）：读实际前文与章纲，出候选、采纳为草稿并派独立编辑，运行 fanqie_ledger_check，以实际审读回报收尾，${mode.finalizeTrack ? "审读通过后将本章定稿（final）。" : "不替作者定稿。"}`,
          { chapter, intent: "write" },
        );
        breaker();
      }
    }
  } finally {
    await sessions.dispose();
  }
}
async function runJudge() {
  if (!models.editor.apiKey)
    throw new Error("读者评审需要 editor 模型凭据：请在 --config 中配置 models.editor");
  const { runtimeModel } = await import("../apps/desktop/out-test/pi.mjs");
  const rubrics = {
    chapter: await readFile(path.join(repo, "packages/core/eval/judge-fanqie-chapter.md"), "utf8"),
    article: await readFile(path.join(repo, "packages/core/eval/judge-toutiao-article.md"), "utf8"),
  };
  const settings = models.editor,
    { runtime, model } = await runtimeModel(
      settings,
      path.join(output, ".judge-auth.json"),
      "judge",
    );
  for (const profile of mode.ab ? ["default"] : ["default", "original"]) {
    const results = [],
      failures = [];
    for (const row of all.filter(
      (item) => item.profile === profile && item.state === "completed",
    )) {
      if (row.caseId.endsWith("-plan")) continue;
      const kind = row.caseId.startsWith("head-") ? "article" : "chapter";
      const judged = await artifact(profile, row);
      const answer = await runtime.completeSimple(
        model,
        {
          messages: [
            {
              role: "user",
              content: buildJudgePrompt(
                kind === "chapter" ? rubrics.chapter : rubrics.article,
                kind,
                judged.title,
                judged.text,
              ),
              timestamp: Date.now(),
            },
          ],
        },
        { maxTokens: settings.maxTokens },
      );
      if (answer.stopReason === "error") {
        failures.push({ caseId: row.caseId, reason: answer.errorMessage || "评审模型返回错误" });
        continue;
      }
      const text = answer.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      try {
        results.push({ caseId: row.caseId, kind, ...parseJudgeOutput(text, kind) });
      } catch (error) {
        // 评审输出解析失败是明确认识的降级：记录该 case 的失败原因并继续其余，不影响任务验收本身。
        failures.push({ caseId: row.caseId, reason: String(error.message) });
      }
    }
    await writeFile(
      path.join(output, profile, "judge.json"),
      JSON.stringify(
        {
          judgedAt: new Date().toISOString(),
          model: { provider: settings.provider, model: settings.model },
          results,
          failures,
        },
        null,
        2,
      ),
    );
    console.log(
      `读者评审完成（${profile}）：成功 ${results.length} 项，失败 ${failures.length} 项`,
    );
  }
}
if (mode.judge) await runJudge();
await summarize();
console.log("真实任务结束，待作者审阅、评分和费用核对。");
