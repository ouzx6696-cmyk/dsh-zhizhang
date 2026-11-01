/** Explicit real-model acceptance. Credentials stay in env; missing results stay pending. */
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
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
const json = async (file) =>
  JSON.parse(await readFile(path.join(output, file), "utf8"));
const save = async (file, value) =>
  writeFile(path.join(output, file), JSON.stringify(value, null, 2));
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
        cases: [
          ...headCases.map((_, i) => "head-" + (i + 1)),
          ...Array.from(
            { length: 10 },
            (_, i) => "novel-c" + String(i + 1).padStart(3, "0"),
          ),
        ].map((id) => ({ id, readability: null, voice: null })),
        continuityErrors: null,
        resumedWithoutExtraSetup: null,
        actualCost: null,
        currency: "CNY",
      },
    ]),
  );
const chapterIds = Array.from(
  { length: 10 },
  (_, i) => "c" + String(i + 1).padStart(3, "0"),
);
const caseIds = [
  ...headCases.map((_, i) => "head-" + (i + 1)),
  "novel-plan",
  ...chapterIds.map((id) => "novel-" + id),
];
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
    if (!draft || draft.rev !== row.revision)
      throw new Error("文章当前版本与任务记录不一致");
    const digest = (text) => createHash("sha256").update(text).digest("hex");
    if (digest(await articles.readDraft(meta.id, draft.rev)) !== draft.sha256)
      throw new Error("文章正文指纹不一致");
    const line = index === 3 || index === 4 ? "故事线" : "资讯线";
    const genre = index >= 5 ? "微头条" : "长图文";
    if (meta.line !== line || meta.genre !== genre)
      throw new Error("文章类别与指定任务不一致");
    if (
      !meta.delivered ||
      !(await readFile(articles.deliveryPath(meta.id), "utf8")).trim()
    )
      throw new Error("缺少本轮交稿单");
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
    return { article: meta, attempts };
  }
  if (!row.work) throw new Error("任务没有对应作品");
  const dir = await store.resolveWorkDir(
    { works: path.join(output, profile, "novels", "works") },
    row.work,
  );
  if (row.caseId === "novel-plan") {
    for (const id of chapterIds) {
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
  const id = row.caseId.slice(6);
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
  return { review: report };
}
async function summarize() {
  const records = await json("run-records.json"),
    subjective = await json("subjective-scores.json"),
    metrics = [];
  for (const profile of ["default", "original"]) {
    const rows = records.filter((row) => row.profile === profile),
      articles = [],
      reviews = [],
      issues = [];
    const plan = rows.find((row) => row.caseId === "novel-plan");
    const seenArticles = new Set();
    for (const id of caseIds) {
      const matches = rows.filter((row) => row.caseId === id);
      if (matches.length !== 1 || matches[0].state !== "completed") {
        issues.push(id + "：任务缺失、重复或未完成");
        continue;
      }
      const row = matches[0];
      try {
        if (id.startsWith("novel-c") && row.work !== plan?.work)
          throw new Error("章节不属于本轮规划的同一本书");
        const result = await artifact(profile, row);
        if (result.article) {
          if (seenArticles.has(row.article))
            throw new Error("同一文章被用于多个任务");
          seenArticles.add(row.article);
          articles.push(result);
        }
        if (result.review) reviews.push(result.review);
      } catch (error) {
        issues.push(id + "：" + error.message);
      }
    }
    if (
      rows.length !== caseIds.length ||
      rows.some((row) => !caseIds.includes(row.caseId))
    )
      issues.push("任务集合不等于约定的 18 项");
    const pass = (q) =>
      q?.pass &&
      q.score >= 84 &&
      q.fail_count === 0 &&
      q.hard_gates.length === 0;
    const author = subjective[profile],
      graded = caseIds
        .filter((id) => id !== "novel-plan")
        .flatMap((id) => {
          const matches = author.cases.filter((row) => row.id === id);
          return matches.length === 1 &&
            [matches[0].readability, matches[0].voice].every(
              (score) => Number.isFinite(score) && score >= 1 && score <= 5,
            )
            ? matches
            : [];
        });
    const item = {
      profile,
      issues,
      articles: articles.length,
      firstQaPassRate:
        articles.filter((article) => pass(article.attempts[0])).length / 7,
      twoQaPassRate:
        articles.filter((article) => article.attempts.some(pass)).length / 7,
      chapterReviews: reviews.length,
      editorPassRate:
        reviews.filter(
          (review) => review.verdict === "通过" && review.reread_full,
        ).length / 10,
      averageHardIssues: reviews.length
        ? reviews.reduce((sum, review) => sum + review.hard_issues.length, 0) /
          reviews.length
        : null,
      tokens: records
        .filter((row) => row.profile === profile)
        .reduce((sum, row) => sum + (row.tokens || 0), 0),
      cost: author.actualCost ?? null,
      currency: author.currency,
      authorScored: graded.length,
      authorAverage:
        graded.length === 17
          ? graded.reduce(
              (sum, row) => sum + (row.readability + row.voice) / 2,
              0,
            ) / 17
          : null,
      continuityErrors: author.continuityErrors,
      resumedWithoutExtraSetup: author.resumedWithoutExtraSetup,
    };
    item.automaticThresholdsMet =
      !item.issues.length &&
      item.articles === 7 &&
      item.chapterReviews === 10 &&
      item.firstQaPassRate >= 0.6 &&
      item.twoQaPassRate >= 0.9 &&
      item.editorPassRate >= 0.7 &&
      item.averageHardIssues <= 1;
    metrics.push(item);
  }
  await save("metrics.json", metrics);
  const complete =
      records.length === 36 &&
      records.every((row) => row.state === "completed") &&
      metrics.every((row) => !row.issues.length),
    human = metrics.every(
      (row) =>
        row.authorAverage !== null &&
        Number.isInteger(row.continuityErrors) &&
        row.continuityErrors <= 2 &&
        row.resumedWithoutExtraSetup === true &&
        row.cost !== null,
    );
  const passed =
    complete &&
    human &&
    metrics.every((row) => row.automaticThresholdsMet) &&
    metrics[0].authorAverage >= metrics[1].authorAverage;
  await writeFile(
    path.join(output, "COMPARISON.md"),
    "# 默认与原版：真实执行记录\n\n|方案|文章数|首次质检过线|两次内过线|审读回报|编辑通过|平均硬伤|tokens|作者均分|\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n" +
      metrics
        .map(
          (row) =>
            `|${row.profile}|${row.articles}|${(row.firstQaPassRate * 100).toFixed(1)}%|${(row.twoQaPassRate * 100).toFixed(1)}%|${row.chapterReviews}|${(row.editorPassRate * 100).toFixed(1)}%|${row.averageHardIssues ?? "无数据"}|${row.tokens}|${row.authorAverage ?? "待评分"}|`,
        )
        .join("\n") +
      `\n\n记录完整：${complete ? "是" : "否"}；作者核验及实际费用完整：${human ? "是" : "否"}。${passed ? "达到计划建议线，仍由作者作最终判断。" : "尚不能判为通过，详见 metrics.json 中的缺项或未达线指标。"}\n\n单篇／单章用量见 run-records.json；费用由作者按服务商账单填写，不以 0 冒充未知费用。第 6 章前自动新对话，是否无需补充设定、连续性错误数由作者抽查。方法内容不因脚本结果自动改写。\n`,
  );
  console.log("真实记录汇总完成：" + output);
}
if (process.argv.includes("--summarize")) {
  await summarize();
  process.exit(0);
}
if (!process.argv.includes("--run")) {
  await save("acceptance-config.example.json", template);
  await save("subjective-scores.json", scores());
  await writeFile(
    path.join(output, "STATUS.md"),
    "# 真实模型验收\n\n状态：未执行。\n\n填入至少两个真实新闻链接，配置模型 Key 环境变量，然后显式执行：\n\n```sh\nnode scripts/acceptance.mjs --run --config 配置文件 --output 输出目录\n```\n\n默认与原版各完成 7 篇头条、一本 10 章长篇；第 6 章前开新对话。作者填写 subjective-scores.json 中的每篇评分、连续性错误数、接续判断和账单费用后，使用 --summarize --output 输出目录重新汇总，不重跑模型。未填或未完成的项目不视为通过。请使用新的输出目录，避免覆盖先前验收。\n",
  );
  console.log("已生成未执行的验收任务与评分模板：" + output);
  process.exit(0);
}
const configFile = flag("--config");
if (!configFile) throw new Error("真实验收须显式提供 --config");
if ((await list(path.join(output, "default"))).length)
  throw new Error("输出目录已有验收作品，请使用新的 --output，避免混入旧记录");
const config = JSON.parse(await readFile(path.resolve(configFile), "utf8"));
if (!Array.isArray(config.newsUrls) || config.newsUrls.length < 2)
  throw new Error("请提供至少两个真实新闻链接");
for (const model of Object.values(config.models))
  if (model) {
    model.apiKey = process.env[model.apiKeyEnv];
    if (!model.apiKey)
      throw new Error("缺少模型凭据环境变量：" + model.apiKeyEnv);
  }
const { Sessions } = await import("../apps/desktop/out-test/session.mjs");
const { normalizeModels } = await import("../apps/desktop/out-test/models.mjs");
const models = normalizeModels(config.models),
  all = [];
await save("subjective-scores.json", scores());
process.env.WRITER_TOUTIAO_SKILL_DIR = path.join(
  repo,
  "packages/toutiao/skill",
);
process.env.WRITER_FANQIE_SKILL_DIR = path.join(repo, "packages/fanqie/skill");
process.env.WRITER_TOUTIAO_DEFAULT_DIR = path.join(
  repo,
  "packages/toutiao/profiles/default",
);
process.env.WRITER_FANQIE_DEFAULT_DIR = path.join(
  repo,
  "packages/fanqie/profiles/default",
);
for (const profile of ["default", "original"]) {
  const base = path.join(output, profile),
    home = path.join(base, ".agent"),
    novels = path.join(base, "novels"),
    toutiao = path.join(base, "toutiao");
  await Promise.all(
    [home, novels, toutiao].map((folder) => mkdir(folder, { recursive: true })),
  );
  process.env.DSH_HOME = home;
  let finish,
    target = { mode: "fanqie", root: novels };
  const sessions = new Sessions(
    home,
    process.env.WRITER_PYTHON || "python3",
    () => models,
    (event) => {
      if (event.event?.type === "agent_settled" && !event.editor) finish?.();
    },
    async () => false,
    { fanqie: { profile }, toutiao: { profile } },
    async (_previous, next) => {
      target = next;
    },
  );
  async function run(caseId, name, scope, text, focus = {}) {
    const before =
      scope.mode === "toutiao"
        ? new Set(
            (await list(toutiao))
              .filter((row) => row.isDirectory())
              .map((row) => row.name),
          )
        : null;
    let timer;
    const start = Date.now(),
      done = new Promise((resolve, reject) => {
        finish = resolve;
        timer = setTimeout(
          () => reject(new Error("任务超过 15 分钟，请核对保留的作品")),
          15 * 60 * 1000,
        );
      });
    try {
      await sessions.send(scope, text, focus);
      await done;
      const actual =
          scope.mode === "toutiao" ? scope : scope.work ? scope : target,
        view = await sessions.view(actual, 1000),
        last = view.messages
          .filter((message) => message.role === "assistant")
          .at(-1);
      if (last?.stopReason === "error") throw new Error(last.errorMessage);
      const record = {
        profile,
        caseId,
        name,
        state: "completed",
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
            row.isDirectory() &&
            /^\d{4}-\d{2}-\d{2}-/.test(row.name) &&
            !before.has(row.name),
        );
        if (created.length !== 1)
          throw new Error("每个头条任务须对应一篇新建文章");
        record.article = created[0].name;
        record.revision = JSON.parse(
          await readFile(
            path.join(toutiao, record.article, "meta.json"),
            "utf8",
          ),
        ).current_rev;
      }
      await artifact(profile, record);
      all.push(record);
    } catch (error) {
      await sessions.stop(scope);
      all.push({
        profile,
        caseId,
        name,
        state: "failed",
        reason: String(error.message),
        durationMs: Date.now() - start,
      });
      throw error;
    } finally {
      clearTimeout(timer);
      finish = undefined;
      await save("run-records.json", all);
      await writeFile(
        path.join(output, "STATUS.md"),
        `# 真实模型验收\n\n已记录 ${all.length} 项任务，其中失败 ${all.filter((item) => item.state === "failed").length} 项。未完成部分不得视为通过。作者评分、连续性抽查、真实费用待填写。\n`,
      );
    }
  }
  try {
    for (const [index, [genre, idea]] of headCases.entries())
      await run(
        "head-" + (index + 1),
        `头条 ${index + 1} ${genre}`,
        { mode: "toutiao", root: toutiao },
        `新建并完成一篇${genre}：${idea}。本次新闻来源：${config.newsUrls.join("、")}。资讯事实须读取原网页，按当前方法方案推进至质检和交稿单；保留全部真实质检记录，不标记已交稿。`,
        { intent: "write" },
      );
    await run(
      "novel-plan",
      "长篇开书",
      target,
      `创建一本长篇，题材：${config.novelIdea}。使用规划角色完成根基与前十章章纲，章号 c001 到 c010；本轮只规划。`,
      { intent: "plan" },
    );
    for (let index = 1; index <= 10; index++) {
      if (index === 6) await sessions.newConversation(target);
      const chapter = "c" + String(index).padStart(3, "0");
      await run(
        "novel-" + chapter,
        `长篇第 ${index} 章`,
        target,
        `完成第 ${index} 章（${chapter}）：读实际前文与章纲，出候选、采纳为草稿并派独立编辑，运行 fanqie_ledger_check，以实际审读回报收尾，不替作者定稿。`,
        { chapter, intent: "write" },
      );
    }
  } finally {
    await sessions.dispose();
  }
}
await summarize();
console.log("真实任务结束，待作者审阅、评分和费用核对。");
