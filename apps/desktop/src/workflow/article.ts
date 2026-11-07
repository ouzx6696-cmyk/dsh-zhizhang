import { readability } from "./readability";
import path from "node:path";
import { emptyUsage } from "../../../../packages/core/src/workflow";
import { sha256 } from "../../../../packages/core/src/fsx";
import { ArticleStore } from "../../../../packages/toutiao/src/store";
import { CLASSICS } from "../../../../packages/toutiao/src/classics";
import { checkCard } from "../../../../packages/toutiao/src/card";
import { loadLimits } from "../../../../packages/toutiao/src/rule-limits";
import { createToutiaoTools } from "../../../../packages/toutiao/src/tools";
import { createGateEngine } from "../../../../packages/core/src/gates";
import { executeTool } from "../../../../packages/core/src/execute";
import { toutiaoGateRules } from "../../../../packages/toutiao/src/gates";
import { readSource } from "../network";
import {
  draft,
  jsonOutput,
  record,
  text,
  list,
  review,
  normalizeDraft,
  type Draft,
} from "./schema";
import { stageCard } from "./methods";
import { selectDraft, editDraft } from "./editor";
import type { WorkflowRun } from "./run";
import type { Target } from "../context";

export async function productionQa(
  run: WorkflowRun,
  store: ArticleStore,
  id: string,
  card: Record<string, unknown>,
  value: Draft,
) {
  await store.writeCard(id, card);
  await store.update(id, (meta) => {
    meta.headlines = {
      main: value.title,
      alts: Array.isArray(card["备选标题"])
        ? card["备选标题"].filter((value): value is string => typeof value === "string")
        : [],
    };
  });
  const meta = await store.get(id),
    cur = store.currentDraft(meta);
  if (!cur || cur.sha256 !== sha256(value.body))
    await store.stageDraft(id, value.body, "editor", "流水线工作稿");
  const config = { ...run.host.options.toutiao, storageRoot: store.root, python: run.host.python },
    gates = createGateEngine(toutiaoGateRules(config), { requireApproval: true });
  const definitions = await createToutiaoTools({ config, role: "editor", gates: () => gates });
  const tool = definitions.find((tool) => tool.name === "toutiao_qa_check");
  if (!tool) throw new Error("文章质检工具不可用");
  const args = { id };
  const result = await executeTool(
    tool,
    args,
    { cwd: store.root, role: "editor", name: tool.name, arguments: args, signal: run.signal },
    { gates, bind: (execute) => execute(), confirm: () => Promise.resolve(false) },
  );
  return record(result.value);
}
export async function articlePipeline(run: WorkflowRun, target: Target) {
  if (!target.article) throw new Error("请先新建或选择文章");
  const request = run.journal.record.request,
    real = new ArticleStore(target.root),
    initial = await real.get(target.article);
  const limits = await loadLimits(run.host.options.toutiao);
  const source = await run.journal.step(
    "sources",
    "准备来源",
    (value) => {
      const r = record(value);
      return { text: text(r.text, "来源原文"), attribution: text(r.attribution, "来源说明") };
    },
    async () => {
      let material = request.source.trim(),
        attribution = "作者提供的素材";
      if (request.line === "story" && !material) {
        const classic = CLASSICS.find((item) => request.instruction.includes(item.title));
        if (!classic)
          throw new Error("本地原典库没有匹配题材，请选择内置原典或提供原文；不消耗新闻抓取额度");
        material = classic.text;
        attribution = classic.source;
      } else if (/^https?:\/\/\S+$/.test(material)) {
        if (request.line === "story")
          throw new Error("故事线请提供原文或选择本地原典，不抓取新闻链接");
        const value = await readSource(material, run.signal);
        material = value.text;
        attribution = value.url + " " + value.date;
      }
      if (!material) throw new Error("资讯与微头条需要真实来源原文或链接");
      return { value: { text: material, attribution }, usage: emptyUsage() };
    },
    run.signal,
    0,
  );
  const cardMethod = await stageCard(run, "toutiao", "s2-selection");
  const oldCard = await real.readCard(initial.id);
  const parseCard = (value: unknown) => {
    const r = jsonOutput(value),
      issues = checkCard(r, limits.titleMax).filter((issue) => issue.level === "fail");
    if (issues.length)
      throw new Error("立项卡未过预检：" + issues.map((issue) => issue.message).join("；"));
    if (
      r["内容线"] !== (request.line === "story" ? "故事线" : "资讯线") ||
      (request.line === "micro" && r["体裁"] !== "微头条")
    )
      throw new Error("立项卡与所选线路不一致");
    if (oldCard === undefined)
      for (const raw of list(r["出处"], "出处")) {
        const link = text(record(raw)["链接"], "出处链接");
        if (link !== "作者素材" && !(source.text + source.attribution).includes(link))
          throw new Error("立项卡引入了未提供的来源链接");
      }
    return r;
  };
  const card = oldCard
    ? await run.journal.step(
        "article-card",
        "核对既有立项卡",
        parseCard,
        async () => ({ value: oldCard, usage: emptyUsage() }),
        run.signal,
        0,
      )
    : await run.model(
        "article-card",
        "生成立项卡",
        "planner",
        cardMethod,
        { source, line: request.line },
        "返回合法立项卡 JSON，包含 内容线（资讯线/故事线）、体裁（长图文/短图文/微头条）、垂类、主驱动、人群、情绪、主问题、延伸（起始小标题/接的问题）、出处（事实/链接）、主标题、备选标题；故事线还包含故事、母题、改编方式、所用版本。来源按给定原文，不伪造核实记录。",
        parseCard,
      );
  const headlineCard = await stageCard(run, "toutiao", "s3-headline");
  const matrix = await run.model(
    "headlines",
    "准备标题矩阵",
    "writer",
    headlineCard,
    { card, source },
    `返回 {"titles":["标题"]}，至少5个不同切入的标题，每个不超过${limits.titleMax}字；不承诺正文或来源中不存在的事实。`,
    (value) => {
      const titles = list(jsonOutput(value).titles, "标题", 20).map((item) =>
        text(item, "标题", limits.titleMax),
      );
      if (titles.length < 5 || new Set(titles).size !== titles.length)
        throw new Error("标题矩阵需要至少5个不同标题");
      return { titles };
    },
  );
  const writing = await stageCard(
    run,
    "toutiao",
    request.line === "story" ? "s4-story" : request.line === "micro" ? "s4-micro" : "s4-news",
  );
  const blueprint = await run.model(
    "blueprint",
    "准备文章结构",
    "planner",
    writing,
    { card, source, titles: matrix.titles },
    '返回 {"opening":"开篇三段的具体内容和信息推进","structure":"主稿结构与每段所得","extension":"延伸四条或微头条收束方式"}。',
    (value) => {
      const r = jsonOutput(value);
      return {
        opening: text(r.opening, "开篇"),
        structure: text(r.structure, "结构"),
        extension: text(r.extension, "延伸"),
      };
    },
  );
  const count = request.grade === "economy" ? 1 : request.grade === "premium" ? 3 : 2,
    drafts: Draft[] = [];
  for (let index = 0; index < count; index++)
    drafts.push(
      await run.model(
        `draft-${index}`,
        `文章起稿 ${index + 1}/${count}`,
        "writer",
        writing,
        {
          card,
          source,
          blueprint,
          titles: matrix.titles,
          entry: ["从人物处境切入", "从具体事实影响切入", "从读者的问题切入"][index],
        },
        '返回 {"title":"主标题","body":"完整正文（含主标题、必要来源标注与AI参与声明；故事演绎明确标注）"}。只采用来源支持的事实，不伪造采访和人物。',
        (value) => {
          const result = draft(value);
          if ([...result.title].length > limits.titleMax) throw new Error("主标题超过硬上限");
          result.body = normalizeDraft(result.body);
          return result;
        },
      ),
    );
  const edit = await stageCard(run, "toutiao", "s5-editing");
  const selection = await selectDraft(run, drafts, edit);
  await run.journal.step(
    "selection",
    "保留选稿报告",
    record,
    async () => ({ value: selection, usage: emptyUsage() }),
    run.signal,
    0,
  );
  let checked = await editDraft(run, drafts[selection.winner], edit, writing);
  const working = new ArticleStore(
    path.join(run.host.home, "workflow-working", run.journal.record.id),
  );
  let workingMeta;
  const all = await working.list();
  if (all.length) workingMeta = all[0];
  else
    workingMeta = await working.create("working", {
      line: request.line === "story" ? "故事线" : "资讯线",
      genre: String(card["体裁"]),
    });
  for (let round = 0; round <= 2; round++) {
    const qa = await run.journal.step(
      `qa-${round}`,
      "质检硬闸",
      record,
      async () => ({
        value: await productionQa(
          run,
          working,
          workingMeta.id,
          {
            ...card,
            主标题: checked.draft.title,
            备选标题: matrix.titles.filter((title) => title !== checked.draft.title).slice(0, 4),
          },
          checked.draft,
        ),
        usage: emptyUsage(),
      }),
      run.signal,
      0,
    );
    if (qa.pass === true) break;
    if (round === 2) throw new Error("文章两轮精修后仍未通过现有质检硬闸，工作稿与报告已保留");
    const refined = await run.model(
      `qa-revise-${round}`,
      "按质检精修",
      "writer",
      writing,
      { draft: checked.draft, qa, source },
      '只处理给定质检失败与对应段落，禁止堆数字和口语词刷分；返回 {"title":"标题","body":"完整正文"}。',
      draft,
    );
    refined.body = normalizeDraft(refined.body);
    checked = { ...checked, draft: refined };
  }
  const facts = await run.model(
    "facts",
    "核对事实与原文",
    "editor",
    edit,
    { draft: checked.draft, source },
    '逐条列出正文中的外部事实或原典引文及其来源证据。返回 {"claims":[{"claim":"正文原文","quote":"来源原文","kind":"fact或quotation或fiction"}]}。没有来源的事实不能省略；fiction只用于已明确标注的故事演绎。',
    (value) => {
      const claims = list(jsonOutput(value).claims, "事实链", 100).map((raw) => {
        const r = record(raw),
          claim = text(r.claim, "正文声明"),
          quote = text(r.quote, "来源证据");
        if (!checked.draft.body.includes(claim) || !source.text.includes(quote))
          throw new Error("事实链的正文或来源证据不匹配");
        if (
          !["fact", "quotation", "fiction"].includes(String(r.kind)) ||
          (r.kind === "fiction" && request.line !== "story")
        )
          throw new Error("事实分类无效");
        return { claim, quote, kind: String(r.kind) };
      });
      if (!claims.length) throw new Error("未提供可核对的事实链");
      return { claims };
    },
  );
  const finalHash = sha256(checked.draft.body);
  const finalReview = await run.model(
    "final-review",
    "核对最终精修稿",
    "editor",
    edit,
    { draft: checked.draft, bodyHash: finalHash },
    '返回 {"bodyHash":"给定指纹","hard":[{"location":"位置","quote":"正文原文","impact":"读者影响","fix":"局部改法"}],"suggestions":["建议"]}。只报告真正影响阅读或事实信任的硬伤。',
    (value) => review(value, checked.draft.body, finalHash),
  );
  if (finalReview.hard.length) throw new Error("最终稿仍有硬伤，工作稿保留，未交付");
  const finalCard = {
    ...card,
    主标题: checked.draft.title,
    备选标题: matrix.titles.filter((title) => title !== checked.draft.title).slice(0, 4),
  };
  const recent = (await real.list()).slice(0, 30);
  const duplicates = recent
    .filter((meta) => meta.id !== initial.id && meta.headlines.main === checked.draft.title)
    .map((meta) => meta.id);
  if (duplicates.length) throw new Error("标题与近期文章重复，请调整切入后新建任务");
  const prepared = await run.journal.step(
    "prepared",
    "保存交付依据",
    record,
    async () => ({
      value: {
        body: checked.draft.body,
        article: initial.id,
        selection,
        readability: readability(checked.draft.body),
        facts,
        card: finalCard,
        title: checked.draft.title,
        previousCardHash: oldCard === undefined ? null : sha256(JSON.stringify(oldCard)),
        headlines: matrix.titles.slice(0, 3),
        workingQa: workingMeta.id,
        note: "已保存工作稿；未替作者交稿。拟采用立项卡与标题见报告",
      },
      usage: emptyUsage(),
    }),
    run.signal,
    0,
  );
  return run.journal.step(
    "delivery",
    "交付文章工作稿",
    record,
    async () => {
      await run.context.assertCurrent();
      const prior = (await real.get(initial.id)).drafts.find(
        (row) => row.note === `workflow:${run.journal.record.id}`,
      );
      if (prior) {
        if (
          prior.sha256 !== sha256(checked.draft.body) ||
          sha256(await real.readDraft(initial.id, prior.rev)) !== prior.sha256
        )
          throw new Error("已交付工作稿被改变，未覆盖");
        return {
          value: { ...prepared, body: undefined, revision: prior.rev },
          usage: emptyUsage(),
        };
      }
      const value = await real.stageDraft(
        initial.id,
        checked.draft.body,
        "editor",
        `workflow:${run.journal.record.id}`,
        { rev: initial.current_rev, sha256: real.currentDraft(initial)?.sha256 ?? "" },
      );
      return {
        value: { ...prepared, body: undefined, revision: value.current_rev },
        usage: emptyUsage(),
      };
    },
    run.signal,
    0,
  );
}
