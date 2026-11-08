import { readability } from "./readability";
import { sha256, nowIso } from "../../../../packages/core/src/fsx";
import {
  findChapter,
  readChapter,
  setOutline,
} from "../../../../packages/fanqie/src/engine/storage/chapters";
import {
  stageCandidate,
  listCandidates,
  readCandidate,
} from "../../../../packages/fanqie/src/engine/storage/candidates";
import { withResourceLock } from "../../../../packages/fanqie/src/engine/storage/process-lock";
import { countWords } from "../../../../packages/fanqie/src/engine/storage/primitives";
import { resolveFanqieWork } from "../main/storage";
import { emptyUsage } from "../../../../packages/core/src/workflow";
import { draft, outline, scenes, record, normalizeDraft, type Draft } from "./schema";
import { selectDraft, editDraft } from "./editor";
import { stageCard } from "./methods";
import { runTaskPool } from "../session/task-pool";
import type { WorkflowRun } from "./run";
import type { Target } from "../context";

/** Parallel candidate drafts; bounded so provider rate limits are not tripped. */
const DRAFT_CONCURRENCY = 3;
export async function chapterPipeline(run: WorkflowRun, target: Target) {
  const request = run.journal.record.request,
    dir = await resolveFanqieWork(run.host.options, target);
  const existing = await findChapter(dir, request.chapter);
  if (!existing) throw new Error("请先在规划流水线中采用章纲，或建立本章章纲后开始写作");
  if (existing.status === "final") throw new Error("本章已定稿，请先由作者明确开启修订");
  const planCard = await stageCard(run, "fanqie", "plan-outline");
  const required = [
    "pov",
    "locks",
    "knowledge",
    "synopsis",
    "conflict",
    "beats",
    "ending",
  ] as const;
  const complete =
    existing.outline.targetWords >= 300 && required.every((key) => existing.outline[key].trim());
  const plan = complete
    ? await run.journal.step(
        "outline",
        "采用作者章纲",
        outline,
        async () => ({
          value: { ...existing.outline, title: existing.title },
          usage: emptyUsage(),
        }),
        run.signal,
        0,
      )
    : await run.model(
        "outline",
        "补全章纲",
        "planner",
        planCard,
        { chapter: existing },
        "返回完整章纲 JSON：title,pov,targetWords（整数）,locks,knowledge,synopsis,conflict,beats,ending。只能补空白，原有字段逐字保留；缺少关键事实时明确报错。",
        (value) => {
          const result = outline(value);
          if (existing.title !== existing.id && result.title !== existing.title)
            throw new Error("补全章纲改变了作者章名");
          for (const key of required)
            if (existing.outline[key].trim() && result[key] !== existing.outline[key])
              throw new Error("补全章纲修改了作者已有字段");
          if (
            existing.outline.targetWords >= 300 &&
            result.targetWords !== existing.outline.targetWords
          )
            throw new Error("补全章纲改变了作者目标篇幅");
          return result;
        },
      );
  const scenePlan = await run.model(
    "scenes",
    "准备场景",
    "planner",
    planCard,
    plan,
    '返回 {"scenes":[{"purpose":"目的","conflict":"阻力","information":"信息增量","change":"结尾状态变化"}]}，1至6场；单场完整收束不机械拆分。',
    scenes,
  );
  const writeCard = await stageCard(run, "fanqie", "write-chapter");
  const editCard = await stageCard(run, "fanqie", "edit"),
    reviseCard = await stageCard(run, "fanqie", "revise");
  const count =
    request.grade === "economy"
      ? 1
      : run.context.chapterPosition <= 3
        ? request.grade === "premium"
          ? 8
          : 5
        : request.grade === "premium"
          ? 3
          : 2;
  const entries = [
    "从动作进入主场面",
    "从冲突对白进入",
    "从反常的具体细节进入",
    "从视角人物的当下困境进入",
    "从选择及其代价进入",
    "从他人主动一招进入",
    "从具有后果的物件进入",
    "从一项误判进入",
  ];
  // Candidates are independent fresh requests with distinct entries; run them side by side.
  const outcomes = await runTaskPool(count, DRAFT_CONCURRENCY, (index) =>
    run.model(
      `draft-${index}`,
      `起稿 ${index + 1}/${count}`,
      "writer",
      writeCard,
      { plan, scenePlan, entry: entries[index] },
      (run.context.chapterPosition <= 3
        ? `这是黄金前三章的第${run.context.chapterPosition}章。第一章前300字进入人物处境和异常、章末留具体钩子；第三章交还一次明确兑现。`
        : "") + '一次写完整章，不写工具调用或审读标签，返回 {"title":"章名","body":"完整正文"}。',
      (value) => {
        const result = draft(value);
        result.body = normalizeDraft(result.body);
        const length = countWords(result.body);
        if (length < plan.targetWords * 0.6 || length > plan.targetWords * 1.5)
          throw new Error("正文篇幅与章纲目标不匹配，未交付候选");
        if (/\[(?:待补|占位|TODO)|【(?:待补|占位)/i.test(result.body))
          throw new Error("正文仍有占位符");
        return result;
      },
    ),
  );
  const drafts: Draft[] = outcomes.map((outcome) => {
    if (outcome.status === "failed") throw outcome.error;
    return outcome.value;
  });
  // Readers judge the prose against the chapter's own promise, not the whole book file.
  const readerMaterial = [
    ...run.context.material.filter((block) => block.name === "前章结尾"),
    { name: "本章章纲", text: JSON.stringify(plan), required: true },
  ];
  const selection = await selectDraft(run, drafts, editCard, "fanqie", readerMaterial);
  await run.journal.step(
    "selection",
    "保留选稿报告",
    record,
    async () => ({ value: selection, usage: emptyUsage() }),
    run.signal,
    0,
  );
  const checked = await editDraft(run, drafts[selection.winner], editCard, reviseCard);
  await run.journal.step(
    "prepared",
    "保存交付依据",
    record,
    async () => ({
      value: {
        original: {
          body: existing.body,
          position: existing.position,
          outline: existing.outline,
          title: existing.title,
        },
        plan,
      },
      usage: emptyUsage(),
    }),
    run.signal,
    0,
  );
  return run.journal.step(
    "delivery",
    "交付待采纳候选",
    record,
    async () => {
      await run.context.assertCurrent();
      return withResourceLock(dir, async () => {
        await run.context.assertCurrent();
        const current = await readChapter(dir, request.chapter);
        if (JSON.stringify(current.outline) !== JSON.stringify(existing.outline))
          throw new Error("章纲已改变，未覆盖作者改动");
        // Only incomplete outlines are filled; a complete author outline remains the source of truth.
        if (
          current.outline.targetWords <= 0 ||
          required.some((key) => !current.outline[key].trim())
        )
          await setOutline(dir, request.chapter, { ...plan }, plan.title);
        const revision = (await readChapter(dir, request.chapter)).revision;
        const rows = await listCandidates(dir),
          receipts: { id: string; selected: boolean; hash: string }[] = [];
        const all = drafts.map((value, index) =>
          index === selection.winner ? checked.draft : value,
        );
        for (const [index, value] of all.entries()) {
          const marker = `workflow:${run.journal.record.id}:${index}`;
          const prior = rows.find((row) => row.note === marker);
          if (prior) {
            if (
              prior.targetRevision !== revision ||
              sha256((await readCandidate(dir, prior.id)).body) !== sha256(value.body)
            )
              throw new Error("已交付候选被修改，未重复保存或覆盖");
            receipts.push({
              id: prior.id,
              selected: index === selection.winner,
              hash: sha256(value.body),
            });
            continue;
          }
          const candidate = await stageCandidate(dir, {
            chapterId: request.chapter,
            body: value.body,
            expectedRevision: revision,
            source: "workflow",
            note: marker,
            variantGroup: run.journal.record.id,
            draftLabel:
              index !== selection.winner
                ? "对照候选（待审）"
                : checked.unresolved
                  ? "推荐稿（仍有待作者判断的硬伤）"
                  : "已审读推荐稿",
          });
          receipts.push({
            id: candidate.id,
            selected: index === selection.winner,
            hash: sha256(value.body),
          });
        }
        return {
          value: {
            at: nowIso(),
            candidates: receipts,
            selection,
            readability: readability(checked.draft.body),
            review: checked.review,
            rounds: checked.rounds,
            unresolved: checked.unresolved,
            note: checked.unresolved
              ? "候选已保存；两轮定向修订后仍有硬伤，见审读报告，由作者判断是否采纳或修改"
              : "候选已保存，作者选择采纳；未替作者定稿",
          },
          usage: emptyUsage(),
        };
      });
    },
    run.signal,
    0,
  );
}
