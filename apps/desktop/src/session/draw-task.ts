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

type DrawScenario = "opening" | "chapter-end" | "title-brief";

/** 一路起草的产物：开头/章末落为候选（candidateId），书名简介与标题只回文本（无章可挂）。 */
interface DrawDraft {
  label: string;
  candidateId?: string;
  body?: string;
  wordCount?: number;
}
/** 工具回执 details.draws 的单版：有评估带分数与理由，评估失败只按起草顺序列 label。 */
type DrawResult = { label: string; score?: number; reasons?: string };

/** 并发池单路结果：失败作为值返回而不是中断整批，调用方决定降级或整单报错。 */
type PoolOutcome<T> = { status: "ok"; value: T } | { status: "failed"; error: unknown };

/**
 * 并发池：最多 limit 路同时在跑，完成一路就补位下一路；结果按输入顺序排列。
 * 纯函数：只管调度与单路失败隔离，任务内容与失败的含义都由调用方决定。
 */
export async function runTaskPool<T>(
  count: number,
  limit: number,
  worker: (index: number) => Promise<T>,
): Promise<PoolOutcome<T>[]> {
  const outcomes: PoolOutcome<T>[] = new Array(count);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, count) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= count) return;
        try {
          outcomes[index] = { status: "ok", value: await worker(index) };
        } catch (error) {
          // allow-catch: 池契约就是单路失败进结果，由调用方决定降级或整单报错。
          outcomes[index] = { status: "failed", error };
        }
      }
    }),
  );
  return outcomes;
}

const DRAW_CONCURRENCY = 2;
const SCENARIO_LABELS: Record<DrawScenario, string> = {
  opening: "本章开头",
  "chapter-end": "本章章末",
  "title-brief": "书名与简介",
};

const DRAFT_CONSTRAINT =
  "本会话是抽卡起草会话：只按任务起草这一版，写完立即按要求暂存（书名简介场景只输出文本），不采纳、不定稿、不写 chapters/、不派编辑子会话、不推进任何后续流程，不询问作者。";
const TOUTIAO_DRAFT_CONSTRAINT =
  "本会话是标题抽卡起草会话：只按任务出一版标题并原样输出，不调用工具、不采纳、不定稿、不推进任何流程，不询问作者。";

/** 头条标题抽卡的单批缺省版数与上限（ToutiaoConfig.draw.max 未配置时用 5：五母体各一版）。 */
const TOUTIAO_TITLE_DEFAULT_N = 5;

/** S3 标题五母体（原文：packages/toutiao/skill/references/s3-headline.md 第一节，任务文本按线取例）。 */
const TOUTIAO_MATRICES = [
  {
    name: "数字反差式",
    formula: "[大数/长周期] + 却/才/只 + [小数/意外结果]",
    news: "交了二十多年社保，我到退休才发现少算了一笔钱",
    story: "一只鸟衔了一辈子石头，原典没写海填没填平",
  },
  {
    name: "身份点名式",
    formula: "[具体处境的人群] + [变化] + [利好或提醒]",
    news: "家里有六十岁以上老人的，月底前这件事别忘了办",
    story: "小时候背过精卫填海的人，可能都漏看了一句",
  },
  {
    name: "悬念缺口式",
    formula: "[大家以为的常规] + [当事人反常举动或卡住]",
    news: "房租能全额提公积金了，他看完细则却把手机合上了",
    story: "后羿射完太阳以后，第一个疏远他的是谁",
  },
  {
    name: "原话现场式",
    formula: "“[带情绪的原话]” + [说话人与现场]",
    news: "“早说啊，我白跑三趟！”去办这事前先看清这一条",
    story: "“我不是来填海的，我是来讨一句话的”",
  },
  {
    name: "时间坐标式",
    formula: "[节点] + [变化] + [不行动的代价]",
    news: "明年元旦以后，回收旧手机得先清数据",
    story: "中秋前再读一遍嫦娥：原典里她拿的是什么药",
  },
];

const SCORING_DIMS = [
  "局面改变（是否把人物推入新的局面）",
  "本章变化（信息、关系或目标的推进量）",
  "钩子信息量（留下多少值得追的具体钩子）",
  "档位刻度（爽点或张力是否到位且不越档）",
  "病型命中（万能套话、空转连接等病型越少越高）",
].join("；");

function draftLaneTask(scenario: DrawScenario, label: string, chapter?: string) {
  if (scenario === "title-brief")
    return [
      `【抽卡起草 ${label}】为本书起草一版书名与简介：`,
      "- 书名一行（尽量不超过 12 字），简介一段（120–200 字），只输出这两样，不要解释。",
      "- 本会话不调用任何工具，写完即止。",
    ].join("\n");
  const ask =
    scenario === "opening"
      ? "起草“本章开头”一版：300–500 字，从当前局面直接进入有阻力的一幕，不写完整章、不复述前情。"
      : "起草“本章章末”一版：300–500 字，承接本章已有进展直接写结尾段落，落到具体的残局、物品、威胁或钩子，不写完整章。";
  return [
    `【抽卡起草 ${label}】${ask}`,
    `写完立即调用 fanqie_candidate_stage 暂存：chapter=${chapter}，content=这段正文，draft_label=${label}，note=抽卡起草（${SCENARIO_LABELS[scenario]}）。`,
    "只起草这一版，不采纳、不定稿、不派编辑。",
  ].join("\n");
}

function toutiaoTitleLaneTask(index: number, line: string): string {
  const matrix = TOUTIAO_MATRICES[index];
  const story = line === "故事线";
  return [
    `【抽卡起草 抽卡-${index + 1}】为这篇${story ? "故事线" : "资讯线"}头条出一版标题，只用母体「${matrix.name}」。`,
    `公式：${matrix.formula}。参考：${story ? matrix.story : matrix.news}。`,
    "- 只输出标题一行，18~28 字最好、34 字硬上限；不用绝对化与标题党词（最好/第一/震惊/必看…），单字“最”不禁。",
    ...(story ? ["- 不写“真实/揭秘/史书不敢写/考古证实”这类把传说当史实的词。"] : []),
    "- 本会话不调用任何工具，写完即止。",
  ].join("\n");
}

/** s3-headline 第三节的 CTR 自评四问（排序用，每问过或不过）。 */
const TOUTIAO_CTR_QUESTIONS = [
  "1 画得出来吗——读完标题，脑子里有没有一个具体的人（或神、或鸟）在一个具体的地方；",
  "2 有缺口吗——有没有一个让人想问“为什么”“后来呢”的反常；",
  "3 接得住吗——标题里的人、数、悬念，正文前两段兑现了吗（下面没有正文时跳过这一问）；",
  "4 认得出是谁吗——目标读者一眼能对号入座（“我”“我爸妈”“我小时候听过的那个故事”）。",
].join("\n");

function toutiaoTitleEvaluateTask(drafts: DrawDraft[], opening: string | undefined) {
  return [
    `你是标题抽卡评估编辑。下面是同一次抽卡的 ${drafts.length} 版头条标题（标签 抽卡-N），互为备选。`,
    `按 s3-headline 的 CTR 四问逐问判断（过/不过）：\n${TOUTIAO_CTR_QUESTIONS}`,
    "score = 通过的问题数（0–4），同分再看标题具体度。只输出一个 JSON 数组，按 score 从高到低排序，不要输出其他文字：",
    '[{"label":"抽卡-1","score":3,"reason":"一句理由"}]',
    ...(opening ? ["", "【正文前两段】", opening] : []),
    "",
    "【标题草稿】",
    ...drafts.flatMap((draft) => [`=== ${draft.label} ===`, draft.body?.trim() || "（空）", ""]),
  ].join("\n");
}

function evaluateTask(scenario: DrawScenario, drafts: DrawDraft[]) {
  return [
    `你是抽卡评估编辑。下面是同一次抽卡的 ${drafts.length} 版${SCENARIO_LABELS[scenario]}草稿（标签 抽卡-N），互为备选。`,
    `按五项各打 1–5 分并加总为 score：${SCORING_DIMS}。`,
    "只输出一个 JSON 数组，按 score 从高到低排序，不要输出其他文字：",
    '[{"label":"抽卡-1","score":19,"reason":"一句理由"}]',
    "",
    "【草稿】",
    ...drafts.flatMap((draft) => [`=== ${draft.label} ===`, draft.body?.trim() || "（空）", ""]),
  ].join("\n");
}

function parseRanking(raw: string): { label: string; score: number; reason: string }[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("评估输出没有 JSON 数组");
  const items: unknown = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(items) || items.length === 0) throw new Error("评估数组为空");
  return items.map((item) => {
    const row = isRecord(item) ? item : null;
    if (
      !row ||
      typeof row["label"] !== "string" ||
      typeof row["score"] !== "number" ||
      typeof row["reason"] !== "string"
    )
      throw new Error("评估条目缺少 label/score/reason");
    return { label: row["label"], score: row["score"], reason: row["reason"] };
  });
}

/** 评估标签与草稿对不上的条目丢弃；一条都对不上视为评估失败。 */
function filterRanking(
  ranking: { label: string; score: number; reason: string }[],
  drafts: DrawDraft[],
) {
  const labels = new Set(drafts.map((draft) => draft.label));
  const rows = ranking.filter((row) => labels.has(row.label));
  if (rows.length === 0) throw new Error("评估结果与草稿标签对不上");
  return rows;
}

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

function drawReport(
  label: string,
  drafts: DrawDraft[],
  ranking: { label: string; score: number; reason: string }[] | undefined,
  rankError: string | undefined,
  failures: string[],
  whereNext: string,
) {
  const lines: string[] = [];
  if (ranking) {
    lines.push(`【抽卡评估 · ${label}】${drafts.length} 版已按总分排序：`);
    ranking.forEach((row, index) =>
      lines.push(`${index + 1}. ${row.label} · ${row.score} 分：${row.reason}`),
    );
  } else {
    lines.push(`【抽卡评估失败，未排序 · ${label}】${rankError}`);
    lines.push(
      "各版草稿按起草顺序如下，请作者自行比较：",
      ...drafts.map(
        (draft, index) =>
          `${index + 1}. ${draft.label}${draft.wordCount ? `（约 ${draft.wordCount} 字）` : ""}`,
      ),
    );
  }
  if (failures.length) lines.push("失败的路：", ...failures.map((row) => `- ${row}`));
  lines.push(whereNext, "把排序、分数与理由汇报给作者，等作者选定后再采纳，不要自动采纳。");
  return lines.join("\n");
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
