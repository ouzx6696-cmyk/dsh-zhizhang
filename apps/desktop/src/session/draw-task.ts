import { runTaskPool } from "./task-pool";
export { runTaskPool } from "./task-pool";
import {
  draftLaneTask,
  toutiaoTitleLaneTask,
  toutiaoTitleEvaluateTask,
  evaluateTask,
  parseRanking,
  filterRanking,
  drawReport,
  SCENARIO_LABELS,
  type DrawScenario,
  type DrawDraft,
  type DrawResult,
} from "./draw-prompts";
/** writer_draw：抽卡——并发起草多版开头/章末/书名简介（番茄）或标题五母体（头条），编辑子会话打分排序，作者选定后再采纳。 */
import { Type } from "typebox";
import type { AgentSession, ToolDefinition } from "./pi-adapter";
import { promptWithSignal } from "./pi-adapter";
import type { Focus, Target } from "../context";
import { taskPrompt } from "./prompt";
import { accumulateChildUsage } from "./editor-task";
import { resolveFanqieWork } from "../main/storage";
import { readCandidate } from "../../../../packages/fanqie/src/engine/work-store";
import { errorText } from "../../../../packages/core/src/errors";
import { isRecord } from "../../../../packages/core/src/parse";
import { ArticleStore } from "../../../../packages/toutiao/src/store";
import type { Sessions } from "./manager";
import type { SessionEntry } from "./types";

const DRAW_CONCURRENCY = 2;
const DRAFT_CONSTRAINT =
  "本会话是抽卡起草会话：只按任务起草这一版，写完立即按要求暂存（书名简介场景只输出文本），不采纳、不定稿、不写 chapters/、不派编辑子会话、不推进任何后续流程，不询问作者。";
const TOUTIAO_DRAFT_CONSTRAINT =
  "本会话是标题抽卡起草会话：只按任务出一版标题并原样输出，不调用工具、不采纳、不定稿、不推进任何流程，不询问作者。";

/** 头条标题抽卡的单批缺省版数与上限（ToutiaoConfig.draw.max 未配置时用 5：五母体各一版）。 */
const TOUTIAO_TITLE_DEFAULT_N = 5;

/** 子会话收尾：最后一条 assistant 是错误或中断就如实报错。 */
function requireFinished(child: AgentSession, what: string) {
  const last = child.messages.findLast((message) => message.role === "assistant");
  if (last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted"))
    throw new Error(last.errorMessage || `${what}没有完成`);
}

/** 这一路的候选 id：从子会话自己的 fanqie_candidate_stage 工具回执里取
 * （business 工具把暂存结果写进 details.writerResult.focus.candidate），
 * 不依赖模型回显的标签——标签以落盘候选为准。 */
function stagedCandidateId(child: AgentSession): string | undefined {
  for (let index = child.messages.length - 1; index >= 0; index--) {
    const message = child.messages[index];
    if (message.role !== "toolResult" || message.toolName !== "fanqie_candidate_stage") continue;
    const writer = isRecord(message.details) ? message.details["writerResult"] : undefined;
    const focus = isRecord(writer) ? writer["focus"] : undefined;
    const candidate = isRecord(focus) ? focus["candidate"] : undefined;
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}

/** 子会话注册进停止级联；返回解除注册的闭包，并发的路互不误删。 */
function registerChild(host: Sessions, parent: AgentSession, child: AgentSession) {
  host.children.set(parent, child);
  return () => {
    if (host.children.get(parent) === child) host.children.delete(parent);
  };
}

/** 头条标题抽卡：五母体各一版 → 按 s3 四问排序；不落候选，作者选定后自己 toutiao_headline_set。 */
async function runToutiaoTitleDraw(deps: {
  host: Sessions;
  target: Target;
  getEntry: () => SessionEntry;
  getSession: () => AgentSession;
  request: { scenario: DrawScenario; n?: number };
  signal: AbortSignal | undefined;
  drawMax: number;
  createDraft: (constraint: string) => Promise<AgentSession>;
}) {
  const { host, target, getEntry, getSession, request, signal } = deps;
  if (request.scenario !== "title-brief")
    throw new Error("头条抽卡只有 title-brief（标题五母体）场景；开头/章末抽卡是番茄长篇的");
  if (!target.article) throw new Error("标题抽卡需要先选择文章");
  const store = new ArticleStore(target.root);
  const article = await store.get(target.article);
  const n = Math.min(request.n ?? TOUTIAO_TITLE_DEFAULT_N, deps.drawMax);
  const focus: Focus = { intent: "write" };
  const entry = getEntry();
  const session = getSession();
  entry.phase = "标题抽卡起草中…";
  let done = 0;
  const outcomes = await runTaskPool<DrawDraft>(n, DRAW_CONCURRENCY, async (index) => {
    const child = await deps.createDraft(TOUTIAO_DRAFT_CONSTRAINT);
    const releaseChild = registerChild(host, session, child);
    try {
      await promptWithSignal(
        child,
        () => taskPrompt(host, target, toutiaoTitleLaneTask(index, article.line), focus),
        signal,
      );
      requireFinished(child, "起草会话");
      const body = (child.getLastAssistantText() || "").trim();
      if (!body) throw new Error("起草会话没有返回标题文本");
      return { label: `抽卡-${index + 1}`, body };
    } finally {
      accumulateChildUsage(entry, child);
      releaseChild();
      child.dispose();
      entry.phase = `标题抽卡起草中（完成 ${++done}/${n}）…`;
    }
  });
  signal?.throwIfAborted();
  const drafts = outcomes.flatMap((outcome) => (outcome.status === "ok" ? [outcome.value] : []));
  const failures = outcomes.flatMap((outcome, index) =>
    outcome.status === "failed" ? [`抽卡-${index + 1}：${errorText(outcome.error)}`] : [],
  );
  if (drafts.length === 0) throw new Error(`抽卡全部失败，未产出草稿：\n${failures.join("\n")}`);
  const opening =
    article.current_rev > 0
      ? (await store.readDraft(article.id, article.current_rev))
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#") && !line.startsWith("【配图"))
          .slice(0, 2)
          .join("\n")
      : undefined;
  entry.phase = "标题抽卡评估中…";
  let ranked: { label: string; score: number; reason: string }[] | undefined;
  let rankError: string | undefined;
  const evaluator = await host.open(target, true, false);
  const releaseEvaluator = registerChild(host, session, evaluator);
  try {
    await promptWithSignal(
      evaluator,
      async () => toutiaoTitleEvaluateTask(drafts, opening),
      signal,
    );
    requireFinished(evaluator, "评估会话");
    ranked = filterRanking(parseRanking(evaluator.getLastAssistantText() || ""), drafts);
  } catch (error) {
    if (signal?.aborted) throw error;
    // allow-catch: 评估只是排序辅助，失败时回退为未排序草稿清单，起草成果照常交回。
    rankError = errorText(error);
  } finally {
    accumulateChildUsage(entry, evaluator);
    releaseEvaluator();
    evaluator.dispose();
  }
  const draws: DrawResult[] = ranked
    ? ranked.map((row) => ({ label: row.label, score: row.score, reasons: row.reason }))
    : drafts.map((draft) => ({ label: draft.label }));
  return {
    content: [
      {
        type: "text" as const,
        text:
          drawReport(
            "标题五母体",
            drafts,
            ranked,
            rankError,
            failures,
            "本场景没有候选落盘；作者选定后自己调用 toutiao_headline_set 落主标题与备选，不要代作者选。",
          ) +
          "\n\n【草稿原文】\n" +
          drafts.map((draft) => `${draft.label}：${draft.body}`).join("\n---\n"),
      },
    ],
    details: {
      draws,
      ...(failures.length ? { failed: failures } : {}),
      ...(rankError ? { rankError } : {}),
    },
  };
}

export function createDrawTools(options: {
  host: Sessions;
  target: Target;
  getEntry: () => SessionEntry;
  getSession: () => AgentSession;
  /** 番茄抽卡单批上限（create.ts 传 draw.max ?? 3） */
  drawMax: number;
  /** 头条标题抽卡单批上限（draw.max ?? 5）；只在 toutiao 模式用 */
  toutiaoDrawMax?: number;
  /** 开关关闭时不注册（头条与番茄的开关独立，create.ts 按模式判断） */
  drawEnabled?: boolean;
  /** 起草子会话工厂由 create.ts 注入（createDraftSession），避免 create ↔ draw-task 依赖环。 */
  createDraft: (constraint: string) => Promise<AgentSession>;
}): ToolDefinition[] {
  const { host, target, getEntry, getSession } = options;
  if (options.drawEnabled === false) return [];
  if (target.mode === "toutiao")
    return [
      {
        name: "writer_draw",
        label: "标题抽卡",
        description:
          "头条标题抽卡：并发按 s3-headline 五母体各出一版标题（只此 title-brief 一种场景），编辑子会话按 CTR 四问（画得出来吗/有缺口吗/接得住吗/认得出是谁吗）打分排序交回。不落候选，作者选定后自己调用 toutiao_headline_set。",
        parameters: Type.Object({
          scenario: Type.Literal("title-brief", {
            description: "头条抽卡只有 title-brief（标题五母体）",
          }),
          article: Type.Optional(Type.String({ description: "头条文章 id，缺省用当前文章" })),
          n: Type.Optional(
            Type.Integer({ minimum: 1, description: "本批版数，缺省 5（五母体各一版）" }),
          ),
        }),
        execute: async (_id, args, signal) => {
          const request = args as { scenario: DrawScenario; article?: string; n?: number };
          if (request.article && request.article !== target.article)
            throw new Error("抽卡只能处理当前文章");
          return runToutiaoTitleDraw({
            host,
            target,
            getEntry,
            getSession,
            request,
            signal,
            drawMax: options.toutiaoDrawMax ?? TOUTIAO_TITLE_DEFAULT_N,
            createDraft: options.createDraft,
          });
        },
      },
    ];
  return [
    {
      name: "writer_draw",
      label: "抽卡",
      description:
        "抽卡：并发起草多版本章开头/章末（暂存为候选，标签 抽卡-<序>）或多版书名与简介，再派编辑子会话按局面改变/本章变化/钩子信息量/档位刻度/病型命中五项打分排序交回。只起草与排序，不自动采纳。",
      parameters: Type.Object({
        scenario: Type.Union(
          [Type.Literal("opening"), Type.Literal("chapter-end"), Type.Literal("title-brief")],
          {
            description:
              "抽卡位置：opening 本章开头 / chapter-end 本章章末 / title-brief 书名与简介",
          },
        ),
        work: Type.Optional(Type.String({ description: "作品 key" })),
        chapter: Type.Optional(
          Type.String({ description: "章节 id；开头/章末抽卡缺省用当前任务章节" }),
        ),
        n: Type.Optional(Type.Integer({ minimum: 1, description: "本批版数，缺省为配置上限" })),
      }),
      execute: async (_id, args, signal) => {
        const entry = getEntry();
        const session = getSession();
        const request = args as {
          scenario: DrawScenario;
          work?: string;
          chapter?: string;
          n?: number;
        };
        if (request.work && request.work !== target.work) throw new Error("抽卡只能处理当前小说");
        if (!target.work) throw new Error("抽卡需要先选择作品");
        const n = Math.min(request.n ?? options.drawMax, options.drawMax);
        const scenario = request.scenario;
        const chapter = request.chapter ?? entry.focus.chapter;
        if (scenario !== "title-brief" && !chapter) throw new Error("开头与章末抽卡需要指明章节");
        const dir = await resolveFanqieWork(host.options, target);
        const focus: Focus = {
          ...(chapter ? { chapter, source: "chapter" as const } : {}),
          intent: "write",
        };
        entry.phase = "抽卡起草中…";
        let done = 0;
        const outcomes = await runTaskPool<DrawDraft>(n, DRAW_CONCURRENCY, async (index) => {
          const intended = `抽卡-${index + 1}`;
          const child = await options.createDraft(DRAFT_CONSTRAINT);
          const releaseChild = registerChild(host, session, child);
          try {
            await promptWithSignal(
              child,
              () => taskPrompt(host, target, draftLaneTask(scenario, intended, chapter), focus),
              signal,
            );
            requireFinished(child, "起草会话");
            if (scenario === "title-brief") {
              const body = (child.getLastAssistantText() || "").trim();
              if (!body) throw new Error("起草会话没有返回书名与简介文本");
              return { label: intended, body };
            }
            const candidateId = stagedCandidateId(child);
            if (!candidateId) throw new Error("起草会话没有暂存候选");
            const cand = await readCandidate(dir, candidateId);
            if (cand.chapterId !== chapter)
              throw new Error(`起草会话把候选暂存到了其他章节（${cand.chapterId}）`);
            return {
              label: cand.draftLabel || intended,
              candidateId,
              body: cand.body,
              wordCount: cand.wordCount,
            };
          } finally {
            accumulateChildUsage(entry, child);
            releaseChild();
            child.dispose();
            entry.phase = `抽卡起草中（完成 ${++done}/${n}）…`;
          }
        });
        signal?.throwIfAborted();
        const drafts = outcomes.flatMap((outcome) =>
          outcome.status === "ok" ? [outcome.value] : [],
        );
        const failures = outcomes.flatMap((outcome, index) =>
          outcome.status === "failed" ? [`抽卡-${index + 1}：${errorText(outcome.error)}`] : [],
        );
        if (drafts.length === 0)
          throw new Error(`抽卡全部失败，未产出草稿：\n${failures.join("\n")}`);
        entry.phase = "抽卡评估中…";
        let ranked: { label: string; score: number; reason: string }[] | undefined;
        let rankError: string | undefined;
        const evaluator = await host.open(target, true, false);
        const releaseEvaluator = registerChild(host, session, evaluator);
        try {
          await promptWithSignal(evaluator, async () => evaluateTask(scenario, drafts), signal);
          requireFinished(evaluator, "评估会话");
          ranked = filterRanking(parseRanking(evaluator.getLastAssistantText() || ""), drafts);
        } catch (error) {
          if (signal?.aborted) throw error;
          // allow-catch: 评估只是排序辅助，失败时回退为未排序草稿清单，起草成果照常交回。
          rankError = errorText(error);
        } finally {
          accumulateChildUsage(entry, evaluator);
          releaseEvaluator();
          evaluator.dispose();
        }
        const draws: DrawResult[] = ranked
          ? ranked.map((row) => ({ label: row.label, score: row.score, reasons: row.reason }))
          : drafts.map((draft) => ({ label: draft.label }));
        return {
          content: [
            {
              type: "text",
              text:
                drawReport(
                  SCENARIO_LABELS[scenario],
                  drafts,
                  ranked,
                  rankError,
                  failures,
                  scenario === "title-brief"
                    ? "本场景没有候选落盘，把各版书名与简介原文交给作者挑选。"
                    : "各版正文在候选区：用 fanqie_chapter_drafts 查看，采纳走 candidate_accept（multiDraft 开启时也可 unify 合并）。",
                ) +
                (scenario === "title-brief"
                  ? "\n\n【草稿原文】\n" +
                    drafts.map((draft) => `${draft.label}：${draft.body}`).join("\n---\n")
                  : ""),
            },
          ],
          details: {
            draws,
            ...(failures.length ? { failed: failures } : {}),
            ...(rankError ? { rankError } : {}),
          },
        };
      },
    },
  ];
}
