import { readability } from "./readability";
import { emptyUsage } from "../../../../packages/core/src/workflow";
import { sha256 } from "../../../../packages/core/src/fsx";
import { ArticleStore } from "../../../../packages/toutiao/src/store";
import { checkCard, titleLength } from "../../../../packages/toutiao/src/card";
import { loadLimits } from "../../../../packages/toutiao/src/rule-limits";
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
import { runTaskPool } from "../session/task-pool";
import { factChain } from "./article-facts";
import { qaGate } from "./article-qa";
import { articleSource } from "./article-source";
import { selectDraft, editDraft } from "./editor";
import type { WorkflowRun } from "./run";
import type { Target } from "../context";

export async function articlePipeline(run: WorkflowRun, target: Target) {
  if (!target.article) throw new Error("请先新建或选择文章");
  const request = run.journal.record.request,
    real = new ArticleStore(target.root),
    initial = await real.get(target.article);
  const limits = await loadLimits(run.host.options.toutiao);
  const source = await articleSource(run);
  // The source rides in the run-constant material (cached prefix) instead of each stage's input;
  // stage inputs point at it, and every code-side check below still uses the real source.
  const material = [
    ...run.context.material,
    { name: "来源原文", text: `${source.attribution}\n${source.text}`, required: true },
  ];
  const sourceRef = { attribution: source.attribution, text: "见材料「来源原文」" };
  const shared = { sourceRef, material };
  const cardMethod = await stageCard(run, "toutiao", "s2-selection");
  const oldCard = await real.readCard(initial.id);
  const parseCard = (value: unknown) => {
    const r = jsonOutput(value),
      issues = checkCard(r, limits.titleMax, limits.drivers).filter(
        (issue) => issue.level === "fail",
      );
    if (issues.length)
      throw new Error("立项卡未过预检：" + issues.map((issue) => issue.message).join("；"));
    if (
      r["内容线"] !== (request.line === "story" ? "故事线" : "资讯线") ||
      (request.line === "micro" && r["体裁"] !== "微头条")
    )
      throw new Error("立项卡与所选线路不一致");
    return r;
  };
  // A generated card may cite only the source this run was given.
  const acceptCard = (r: Record<string, unknown>) => {
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
        { parse: parseCard },
        async () => ({ value: oldCard, usage: emptyUsage() }),
        run.signal,
        0,
      )
    : await run.model(
        "article-card",
        "生成立项卡",
        "planner",
        cardMethod,
        { source: sourceRef, line: request.line },
        "返回合法立项卡 JSON，包含 内容线（资讯线/故事线）、体裁（长图文/短图文/微头条）、垂类、主驱动、人群、情绪、主问题、延伸（起始小标题/接的问题）、出处（事实/链接）、主标题、备选标题；故事线还包含故事、母题、改编方式、所用版本。来源按给定原文，不伪造核实记录。",
        parseCard,
        { material, accept: acceptCard },
      );
  const headlineCard = await stageCard(run, "toutiao", "s3-headline");
  // Recent titles are excluded up front so a finished run is never rejected for a duplicate title.
  const skippedHistory: { root: string; id?: string; error: string }[] = [];
  const recentArticles = async () => {
    const issues: { root: string; id?: string; error: string }[] = [];
    const rows = await real.list(issues);
    for (const issue of issues)
      if (!skippedHistory.some((prior) => prior.id === issue.id && prior.error === issue.error)) {
        skippedHistory.push(issue);
        run.host.emit({
          error: `标题历史已跳过损坏文章 ${issue.id ?? issue.root}：${issue.error}`,
        });
        run.host.extras.log?.("workflow_history_unavailable", { id: issue.id, error: issue.error });
      }
    return rows;
  };
  const recentTitles = (await recentArticles())
    .slice(0, 30)
    .filter((meta) => meta.id !== initial.id)
    .map((meta) => meta.headlines.main)
    .filter(Boolean);
  const matrix = await run.model(
    "headlines",
    "准备标题矩阵",
    "writer",
    headlineCard,
    { card, source: sourceRef, avoid: recentTitles },
    `返回 {"titles":["标题"]}，至少5个不同切入的标题，每个不超过${limits.titleMax}字；不承诺正文或来源中不存在的事实；不得与 avoid 中的近期标题相同。`,
    (value) => ({
      titles: list(jsonOutput(value).titles, "标题", 20).map((item) => {
        const title = text(item, "标题", limits.titleMax * 2);
        if (titleLength(title) > limits.titleMax) throw new Error("标题超过硬上限");
        return title;
      }),
    }),
    {
      material,
      accept: ({ titles }) => {
        const fresh = titles.filter((title) => !recentTitles.includes(title));
        if (fresh.length < 5 || new Set(fresh).size !== fresh.length)
          throw new Error("标题矩阵需要至少5个不同标题");
        return { titles: fresh };
      },
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
    { card, source: sourceRef, titles: matrix.titles },
    '返回 {"opening":"开篇三段的具体内容和信息推进","structure":"主稿结构与每段所得","extension":"延伸四条或微头条收束方式"}。',
    (value) => {
      const r = jsonOutput(value);
      return {
        opening: text(r.opening, "开篇"),
        structure: text(r.structure, "结构"),
        extension: text(r.extension, "延伸"),
      };
    },
    { material },
  );
  const count = request.grade === "economy" ? 1 : request.grade === "premium" ? 3 : 2;
  const outcomes = await runTaskPool(
    count,
    count,
    (index) =>
      run.model(
        `draft-${index}`,
        `文章起稿 ${index + 1}/${count}`,
        "writer",
        writing,
        {
          card,
          source: sourceRef,
          blueprint,
          titles: matrix.titles,
          entry: ["从人物处境切入", "从具体事实影响切入", "从读者的问题切入"][index],
        },
        '返回 {"title":"主标题","body":"完整正文（含主标题；不写 AI 参与声明，发布时在平台勾选；来源标注只写媒体名与日期，不贴链接；故事演绎明确标注）"}。只采用来源支持的事实，不伪造采访和人物。',
        (value) => {
          const result = draft(value);
          if (titleLength(result.title) > limits.titleMax) throw new Error("主标题超过硬上限");
          result.body = normalizeDraft(result.body);
          return result;
        },
        {
          material,
          accept: (result) => {
            if (recentTitles.includes(result.title)) throw new Error("主标题与近期文章重复");
            return result;
          },
        },
      ),
    run.poolOptions,
  );
  const drafts: Draft[] = outcomes.map((outcome) => {
    if (outcome.status === "failed") throw outcome.error;
    return outcome.value;
  });
  const edit = await stageCard(run, "toutiao", "s5-editing");
  const selection = await selectDraft(run, drafts, "toutiao", [
    { name: "立项卡", text: JSON.stringify(card), required: true },
  ]);
  await run.journal.step(
    "selection",
    "保留选稿报告",
    { parse: record },
    async () => ({ value: selection, usage: emptyUsage() }),
    run.signal,
    0,
  );
  let checked = await editDraft(run, drafts[selection.winner], edit, writing);
  // Fact chain runs before the QA gate so a fact repair is itself checked by the gate.
  let facts = await factChain(run, "facts", edit, checked.draft, source, shared);
  const unsupported = facts.claims.filter((claim) => claim.kind === "unsupported");
  if (unsupported.length) {
    const repaired = await run.model(
      "facts-revise",
      "删改无来源事实",
      "writer",
      writing,
      { draft: checked.draft, unsupported, source: sourceRef },
      '删除或改写 unsupported 中的每一条：改为来源支持的表述、明确的观点或删去；其他段落不动。返回 {"title":"标题","body":"完整正文"}。',
      draft,
      { material },
    );
    repaired.body = normalizeDraft(repaired.body);
    checked = { ...checked, draft: repaired };
    facts = await factChain(run, "facts-1", edit, checked.draft, source, shared);
  }
  const factsHash = sha256(checked.draft.body);
  const gated = await qaGate(run, card, matrix.titles, checked, writing, sourceRef, material);
  checked = gated.checked;
  const finalHash = sha256(checked.draft.body);
  if (finalHash !== factsHash)
    facts = await factChain(run, "facts-final", edit, checked.draft, source, shared);
  const unverified = [
    ...facts.claims.filter((claim) => claim.kind === "unsupported"),
    ...facts.unverified,
  ];
  // When neither fact repair nor QA refinement touched the body since the last review in
  // editDraft, that review already covers this exact text; reuse it instead of paying again.
  const finalReview =
    checked.review.bodyHash === finalHash
      ? checked.review
      : await run.model(
          "final-review",
          "核对最终精修稿",
          "editor",
          edit,
          { draft: checked.draft },
          '返回 {"hard":[{"location":"位置","quote":"正文原文","impact":"读者影响","fix":"局部改法"}],"suggestions":["建议"]}。只报告真正影响阅读或事实信任的硬伤。',
          (value) => review(value, checked.draft.body),
        );
  // Remaining issues travel with the working draft to the author; nothing is submitted for them.
  const open = finalReview.hard.length > 0 || checked.unresolved || unverified.length > 0;
  const finalCard = {
    ...card,
    主标题: checked.draft.title,
    备选标题: matrix.titles.filter((title) => title !== checked.draft.title).slice(0, 4),
  };
  const recent = (await recentArticles()).slice(0, 30);
  const duplicates = recent
    .filter((meta) => meta.id !== initial.id && meta.headlines.main === checked.draft.title)
    .map((meta) => meta.id);
  if (duplicates.length) throw new Error("标题与近期文章重复，请调整切入后新建任务");
  const prepared = await run.journal.step(
    "prepared",
    "保存交付依据",
    { parse: record },
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
        workingQa: gated.workingId,
        finalReview,
        unverified,
        skippedHistory,
        unresolved: open,
        note: open
          ? "已保存工作稿，但仍有硬伤或无来源事实待作者处理，见报告；未替作者交稿"
          : "已保存工作稿；未替作者交稿。拟采用立项卡与标题见报告",
      },
      usage: emptyUsage(),
    }),
    run.signal,
    0,
  );
  return run.journal.step(
    "delivery",
    "交付文章工作稿",
    { parse: record },
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
