/** writer_revision_learn / writer_revision_decide：改稿学习（learn.enabled 开关，默认关）。
 * 从作品内的作者改稿记录归纳偏好候选，写作品根下 learn-pending.json；
 * 作者在对话里逐条决定后由 decide 落盘：番茄进 foundation.style，头条进 feedback.md。
 * 工具只归纳与转述作者决定，不自动改正文。 */
import { Type } from "typebox";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { AgentSession, ToolDefinition } from "./pi-adapter";
import { promptWithSignal } from "./pi-adapter";
import type { Target } from "../context";
import { accumulateChildUsage } from "./editor-task";
import { resolveFanqieWork } from "../main/storage";
import { AUTHOR_PANEL_SAVE_SUMMARY } from "../../../../packages/fanqie/src/workbench/api";
import {
  atomicWrite,
  localDay,
  nowIso,
  readJson,
  readText,
  sha256,
} from "../../../../packages/core/src/fsx";
import { errorText } from "../../../../packages/core/src/errors";
import { isRecord, str } from "../../../../packages/core/src/parse";
import { executeTool } from "../../../../packages/core/src/execute";
import type { ToolDefinition as WriterToolDefinition } from "../../../../packages/core/src/tool";
import type { ToolExecution } from "../../../../packages/core/src/tool";
import type { createGateEngine } from "../../../../packages/core/src/gates";
import { createToutiaoTools } from "../../../../packages/toutiao/src/tools";
import { withPluginConfig } from "../../../../packages/fanqie/src/engine/tools/context";
import {
  findChapter,
  listCandidates,
  readCandidate,
  readLedger,
  readWorkMeta,
} from "../../../../packages/fanqie/src/engine/work-store";
import { FoundationPort } from "../../../../packages/fanqie/src/engine/ports/foundation";
import {
  ArticleStore,
  formatFeedbackLine,
  parseFeedbackEntries,
  type FeedbackEntry,
} from "../../../../packages/toutiao/src/store";
import type { Sessions } from "./manager";
import type { SessionEntry } from "./types";

type LearnMode = "fanqie" | "toutiao";
type Gates = ReturnType<typeof createGateEngine>;
type SessionConfig = import("../../../../packages/fanqie/src/config").FanqieConfig &
  import("../../../../packages/toutiao/src/config").ToutiaoConfig;

const PENDING_FILE = "learn-pending.json";
const LEARN_DEFAULT_LIMIT = 10;
const MODE_LABELS: Record<LearnMode, string> = { fanqie: "番茄长篇", toutiao: "今日头条" };

/** 一对改稿记录：前后两版正文与出处（learn 的原始输入，子会话按对归组）。 */
export interface LearnPair {
  source: string;
  how: string;
  before: string;
  after: string;
}

/** 归纳出的偏好候选：id = condition+change 哈希，example 留前后各一句。 */
export interface LearnItem {
  id: string;
  condition: string;
  change: string;
  why: string;
  example: { before: string; after: string };
  source: string;
  at: string;
  count: number;
}

/** learn-pending.json 的落盘结构（作品根下，待作者确认的候选）。 */
export interface LearnPending {
  mode: LearnMode;
  items: LearnItem[];
}

export function pendingId(condition: string, change: string): string {
  return sha256(`${condition}\n${change}`);
}

/** 已有 pending 与新归纳候选合并：同 id 视为同一偏好的再次印证（count+1 并刷新证据），不同 id 追加。 */
export function mergePending(
  existing: LearnPending | undefined,
  mode: LearnMode,
  incoming: LearnItem[],
): LearnPending {
  if (!existing) return { mode, items: incoming.map((item) => ({ ...item })) };
  const items = existing.items.map((item) => ({ ...item }));
  for (const item of incoming) {
    const hit = items.find((row) => row.id === item.id);
    if (hit) {
      hit.count += 1;
      hit.why = item.why;
      hit.example = item.example;
      hit.source = item.source;
      hit.at = item.at;
    } else items.push({ ...item });
  }
  return { ...existing, mode, items };
}

/** 番茄采纳写入 foundation.style 的条目（带日期与来源“改稿学习”）；text 是作者编辑后的内容。 */
export function styleEntryOf(item: LearnItem, text: string | undefined): string {
  return `【改稿学习 ${localDay()}】适用：${item.condition}。改法：${text?.trim() || item.change}。缘由：${item.why}。（来源：${item.source}）`;
}

/** 头条采纳写入 feedback.md 的结构化条目：病型按适用条件归类；text 是作者编辑后的改后内容。 */
export function feedbackEntryOf(item: LearnItem, text: string | undefined): FeedbackEntry {
  return {
    date: localDay(),
    original: item.example.before,
    revised: text?.trim() || item.example.after,
    motive: item.why === "inferred" ? "改稿学习归纳（作者未给理由）" : item.why,
    病型: item.condition,
    改法: item.change,
  };
}

/** 子会话归纳输出的 schema 校验：JSON 数组，同类满 3 次的组才由模型输出（count≥3）。 */
export function parseLearnOutput(raw: string): LearnItem[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("归纳失败：模型输出没有 JSON 数组");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    throw new Error(`归纳失败：模型输出不是合法 JSON（${errorText(error)}）`);
  }
  if (!Array.isArray(parsed)) throw new Error("归纳失败：模型输出不是数组");
  return parsed.map((row, index) => {
    const record = isRecord(row) ? row : null;
    const example = record && isRecord(record["example"]) ? record["example"] : null;
    const condition = record ? str(record["condition"]) : "";
    const change = record ? str(record["change"]) : "";
    const why = record ? str(record["why"]) : "";
    const source = record ? str(record["source"]) : "";
    const before = example ? str(example["before"]) : "";
    const after = example ? str(example["after"]) : "";
    const count = record?.["count"];
    if (
      !record ||
      !condition ||
      !change ||
      !why ||
      !source ||
      !before ||
      !after ||
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 3
    )
      throw new Error(
        `归纳失败：第 ${index + 1} 条不符合 schema（condition/change/why/source/example 前后句/count≥3）`,
      );
    return {
      id: pendingId(condition, change),
      condition,
      change,
      why,
      example: { before, after },
      source,
      at: nowIso(),
      count,
    };
  });
}

/** learn-pending.json 的边界解析：文件损坏或缺字段时如实报错，不静默清空。 */
export function parsePending(value: unknown, file: string): LearnPending {
  const record = isRecord(value) ? value : null;
  const rows = record && Array.isArray(record["items"]) ? record["items"] : null;
  if (!record || (record["mode"] !== "fanqie" && record["mode"] !== "toutiao") || !rows)
    throw new Error(`改稿学习候选文件损坏：${file}`);
  const items = rows.map((row, index) => {
    const item = isRecord(row) ? row : null;
    const example = item && isRecord(item["example"]) ? item["example"] : null;
    if (
      !item ||
      typeof item["id"] !== "string" ||
      !str(item["condition"]) ||
      !str(item["change"]) ||
      !str(item["why"]) ||
      typeof item["source"] !== "string" ||
      typeof item["at"] !== "string" ||
      typeof item["count"] !== "number" ||
      !Number.isInteger(item["count"]) ||
      item["count"] < 1 ||
      !example ||
      !str(example["before"]) ||
      !str(example["after"])
    )
      throw new Error(`改稿学习候选文件第 ${index + 1} 条损坏：${file}`);
    return {
      id: item["id"],
      condition: str(item["condition"]),
      change: str(item["change"]),
      why: str(item["why"]),
      example: { before: str(example["before"]), after: str(example["after"]) },
      source: item["source"],
      at: item["at"],
      count: item["count"],
    } satisfies LearnItem;
  });
  return { mode: record["mode"], items };
}

// —— 改稿对收集 ——

/** 番茄作者改稿的识别标记（fanqie 写作台阅读面板保存正文的 ledgerEntry 原文，
 * 见 packages/fanqie/src/workbench/api.ts 的 saveChapter 路由）。 */
const AUTHOR_PANEL_SAVE = AUTHOR_PANEL_SAVE_SUMMARY;
/** ledger 条目与 revisionImpacts 留底按时间对齐的容差（同一保存事务内的两次 nowIso）。 */
const IMPACT_MATCH_MS = 2000;

/** 修订留底里真正用到的字段。 */
interface Impact {
  chapterId: string;
  history: string;
  at: string;
}

/** 番茄改稿对：优先取有明确作者标记的阅读面板直改（前版=revisions 留底，后版=下一版留底或现行正文）。
 * 数据缺口：修订记录不含操作者，写手/编辑的保存无法与作者区分，故只取有作者标记的对；
 * 没有作者直改时降级为采纳候选差异（候选正文 vs 采纳前的章节留底）。 */
async function fanqiePairs(dir: string, limit: number): Promise<LearnPair[]> {
  const [meta, ledger, candidates] = await Promise.all([
    readWorkMeta(dir),
    readLedger(dir),
    listCandidates(dir),
  ]);
  const byChapter = new Map<string, Impact[]>();
  for (const impact of meta.revisionImpacts ?? []) {
    const rows = byChapter.get(impact.chapterId) ?? [];
    rows.push({ chapterId: impact.chapterId, history: impact.history, at: impact.at });
    byChapter.set(impact.chapterId, rows);
  }
  for (const rows of byChapter.values()) rows.sort((a, b) => a.at.localeCompare(b.at));
  const nearImpact = (chapterId: string, at: string) =>
    (byChapter.get(chapterId) ?? [])
      .map((impact) => ({ impact, diff: Math.abs(Date.parse(impact.at) - Date.parse(at)) }))
      .filter((row) => Number.isFinite(row.diff) && row.diff <= IMPACT_MATCH_MS)
      .sort((a, b) => a.diff - b.diff)[0]?.impact;
  const beforeOf = async (impact: Impact) => readText(path.join(dir, impact.history));
  const afterOf = async (chapterId: string, at: string) => {
    const next = byChapter.get(chapterId)?.find((impact) => impact.at > at);
    if (next) return beforeOf(next);
    const chapter = await findChapter(dir, chapterId);
    return chapter?.body;
  };
  const pairs: LearnPair[] = [];
  for (const entry of [...ledger.entries].reverse()) {
    if (entry.summary !== AUTHOR_PANEL_SAVE) continue;
    const chapterId = str(entry.chapterId);
    const impact = chapterId ? nearImpact(chapterId, entry.at) : undefined;
    if (!impact) continue;
    const before = await beforeOf(impact);
    const after = await afterOf(chapterId, impact.at);
    if (before && after && before.trim() !== after.trim())
      pairs.push({ source: `章节 ${chapterId}`, how: "作者在阅读面板改稿", before, after });
    if (pairs.length >= limit) return pairs;
  }
  if (pairs.length === 0)
    for (const row of [...candidates].reverse()) {
      if (!row.acceptedAt || row.unavailable) continue;
      const candidate = await readCandidate(dir, row.id);
      if (!candidate.acceptedAt) continue;
      const impact = nearImpact(candidate.chapterId, candidate.acceptedAt);
      if (!impact) continue;
      const before = await beforeOf(impact);
      if (before && candidate.body.trim() && before.trim() !== candidate.body.trim())
        pairs.push({
          source: `章节 ${candidate.chapterId} 候选 ${candidate.id}`,
          how: "采纳候选差异",
          before,
          after: candidate.body,
        });
      if (pairs.length >= limit) break;
    }
  return pairs.slice(0, limit);
}

/** 头条改稿对：role=author 的稿件版本与其紧邻前版（写手/编辑最后版）；feedback.md 条目作为已带动机的证据。 */
async function toutiaoPairs(
  root: string,
  limit: number,
): Promise<{ pairs: LearnPair[]; feedback: FeedbackEntry[] }> {
  const store = new ArticleStore(root);
  const [articles, feedbackText] = await Promise.all([store.list(), readText(store.feedbackPath)]);
  const feedback = parseFeedbackEntries(feedbackText ?? "").slice(-limit);
  const pairs: LearnPair[] = [];
  for (const meta of articles) {
    for (const draft of [...meta.drafts].reverse()) {
      if (draft.role !== "author") continue;
      const prior = [...meta.drafts].reverse().find((row) => row.rev < draft.rev);
      if (!prior) continue;
      const [before, after] = await Promise.all([
        store.readDraft(meta.id, prior.rev),
        store.readDraft(meta.id, draft.rev),
      ]);
      pairs.push({
        source: `${meta.id} 第 ${draft.rev} 版`,
        how: "作者改稿（author 版）",
        before,
        after,
      });
      if (pairs.length >= limit) return { pairs, feedback };
    }
  }
  return { pairs, feedback };
}

// —— 归纳子会话 ——

const PAIR_EXCERPT = 600;

function excerpt(text: string): string {
  const body = text.trim();
  if (body.length <= PAIR_EXCERPT) return body;
  const half = PAIR_EXCERPT / 2;
  return `${body.slice(0, half)}\n……（中略）……\n${body.slice(-half)}`;
}

const LEARN_OUTPUT_SPEC =
  '[{"condition":"适用条件（什么情况下这么改）","change":"改什么（一句话）","why":"作者的动机；作者没说理由就写 inferred","example":{"before":"前版里的一句","after":"后版里对应的一句"},"source":"章或文章 id","count":同类出现次数}]';

function learnPrompt(pairs: LearnPair[], feedback: FeedbackEntry[]): string {
  return [
    "你是改稿学习编辑。下面是作者改稿的前后版本对（前版 → 后版）" +
      (feedback.length ? "，以及作者写明动机的反馈条目" : "") +
      "。把语义相近的改法归为一组并统计出现次数，只有同类（适用条件与改法相近）出现 3 次及以上的才纳入输出。",
    `只输出一个 JSON 数组（不要代码围栏、不要解释、不要多余键），每条形如：\n${LEARN_OUTPUT_SPEC}`,
    "没有凑满 3 次的同类改法就输出 []。",
    "",
    "【改稿对】",
    ...pairs.flatMap((pair) => [
      `=== ${pair.source}（${pair.how}）===`,
      `【前】${excerpt(pair.before)}`,
      `【后】${excerpt(pair.after)}`,
      "",
    ]),
    ...(feedback.length
      ? ["【作者反馈（已写明动机）】", ...feedback.map((entry) => `- ${formatFeedbackLine(entry)}`)]
      : []),
  ].join("\n");
}

function learnReport(items: LearnItem[], file: string): string {
  return [
    `【改稿学习候选 · ${items.length} 条】已写入 ${file}`,
    ...items.map(
      (item, index) =>
        `${index + 1}. id=${item.id} 适用：${item.condition} ｜ 改法：${item.change} ｜ 缘由：${item.why} ｜ 例：${item.example.before} → ${item.example.after} ｜ 出处：${item.source}（同类 ${item.count} 次）`,
    ),
    "请作者决定：告诉我采纳哪几条（说编号或“都要”）、哪些不要，或直接给出某条编辑后的文案。作者明确确认前不要调用 writer_revision_decide。",
  ].join("\n");
}

// —— 工具 ——

const NO_AUTHOR_EDITS: Record<LearnMode, string> = {
  fanqie:
    "没有找到作者改稿记录：作品里既没有阅读面板的作者保存（改前与改后的成对修订），也没有可降级的采纳候选差异。作者在阅读面板改过正文或采纳过候选之后再来学习。",
  toutiao:
    "没有找到作者改稿记录：头条数据里没有 role=author 的稿件版本（作者在写作台保存一版后才有），feedback.md 也还没有结构化条目。",
};

export function createLearnTools(options: {
  host: Sessions;
  target: Target;
  getEntry: () => SessionEntry;
  getSession: () => AgentSession;
  config: SessionConfig;
  gates: Gates;
}): ToolDefinition[] {
  const { host, target, getEntry, getSession, config, gates } = options;
  const pendingFile = async () =>
    target.mode === "fanqie"
      ? path.join(await resolveFanqieWork(host.options, target), PENDING_FILE)
      : path.join(target.root, PENDING_FILE);
  const loadPending = async () => {
    const file = await pendingFile();
    const raw = await readJson<unknown>(file);
    return raw === undefined ? undefined : parsePending(raw, file);
  };
  /** 头条采纳复用 toutiao_feedback_append 的唯一落盘实现（结构化行式与首条表头都由它负责）。 */
  let feedbackAppend: WriterToolDefinition | undefined;
  const appendToutiaoFeedback = async (item: LearnItem, text: string | undefined) => {
    if (!feedbackAppend) {
      const tools = await createToutiaoTools({ config, role: "writer", gates: () => gates });
      feedbackAppend = tools.find((tool) => tool.name === "toutiao_feedback_append");
    }
    if (!feedbackAppend) throw new Error("toutiao_feedback_append 工具不可用，无法写改稿学习");
    const entry = feedbackEntryOf(item, text);
    const exec: ToolExecution = {
      cwd: target.root,
      role: "writer",
      callId: "writer_revision_decide",
      name: "toutiao_feedback_append",
      arguments: {},
    };
    await executeTool(
      feedbackAppend,
      {
        original: entry.original,
        revised: entry.revised,
        motive: entry.motive,
        病型: entry.病型,
        改法: entry.改法,
      },
      exec,
      { gates, bind: (run) => withPluginConfig(config, run), confirm: host.confirm },
    );
  };

  return [
    {
      name: "writer_revision_learn",
      label: "改稿学习",
      description:
        "从作者改稿记录归纳偏好候选：番茄取阅读面板作者保存的成对修订（没有作者直改时降级为采纳候选差异），头条取 role=author 版本与前版的正文对加 feedback.md 条目。开编辑子会话归组计数，同类满 3 次的写入 learn-pending.json，交作者在对话里决定；不自动改正文或文风。",
      parameters: Type.Object({
        mode: Type.Optional(
          Type.Union([Type.Literal("fanqie"), Type.Literal("toutiao")], {
            description: "数据源模式，缺省用当前会话模式（只能学当前会话的数据源）",
          }),
        ),
        limit: Type.Optional(
          Type.Integer({ minimum: 1, description: "每次最多取的改稿对数，缺省 10" }),
        ),
      }),
      execute: async (_id, raw, signal) => {
        const args = raw as { mode?: LearnMode; limit?: number };
        const mode = args.mode ?? target.mode;
        if (mode !== target.mode)
          throw new Error(
            `改稿学习只能学当前会话的数据源（当前 ${MODE_LABELS[target.mode]}；${MODE_LABELS[mode]}的数据不在本会话目录下）`,
          );
        const limit = args.limit ?? LEARN_DEFAULT_LIMIT;
        const entry = getEntry();
        const session = getSession();
        entry.phase = "收集改稿记录…";
        const collected =
          target.mode === "fanqie"
            ? {
                pairs: await fanqiePairs(await resolveFanqieWork(host.options, target), limit),
                feedback: [] as FeedbackEntry[],
              }
            : await toutiaoPairs(target.root, limit);
        if (!collected.pairs.length && !collected.feedback.length)
          return {
            content: [{ type: "text" as const, text: NO_AUTHOR_EDITS[target.mode] }],
            details: {},
          };
        entry.phase = "改稿归纳中…";
        const child = await host.open(target, true, false);
        host.children.set(session, child);
        let items: LearnItem[];
        try {
          await promptWithSignal(
            child,
            async () => learnPrompt(collected.pairs, collected.feedback),
            signal,
          );
          const last = child.messages.findLast((message) => message.role === "assistant");
          if (
            last?.role === "assistant" &&
            (last.stopReason === "error" || last.stopReason === "aborted")
          )
            throw new Error(last.errorMessage || "改稿归纳没有完成");
          items = parseLearnOutput(child.getLastAssistantText() || "");
        } finally {
          accumulateChildUsage(entry, child);
          host.children.delete(session);
          child.dispose();
        }
        if (!items.length)
          return {
            content: [
              {
                type: "text" as const,
                text: "改稿归纳完成：这次没有凑满 3 次的同类改法，未写候选。",
              },
            ],
            details: {
              learn: {
                pairs: collected.pairs.length,
                feedback: collected.feedback.length,
                items: [],
              },
            },
          };
        const file = await pendingFile();
        const pending = mergePending(await loadPending(), target.mode, items);
        await atomicWrite(file, JSON.stringify(pending, null, 2) + "\n");
        return {
          content: [{ type: "text" as const, text: learnReport(pending.items, file) }],
          details: {
            learn: {
              pairs: collected.pairs.length,
              feedback: collected.feedback.length,
              items: pending.items,
            },
          },
        };
      },
    },
    {
      name: "writer_revision_decide",
      label: "改稿学习确认",
      description:
        "把作者对改稿学习候选的决定落盘。必须转述作者的原话决定（采纳哪几条/都要/都不要，或作者给的编辑后文案），不得自行采纳、不得自行改写候选内容。accept：番茄写入 foundation.style（来源“改稿学习”），头条经 toutiao_feedback_append 写入 feedback.md；reject 从待确认候选删除。",
      parameters: Type.Object({
        id: Type.String({
          description: "候选 id（learn 回执里的 id=…），或字面量 all 表示全部候选",
        }),
        action: Type.Union([Type.Literal("accept"), Type.Literal("reject")], {
          description: "accept 按作者决定落盘 / reject 拒绝并删除",
        }),
        text: Type.Optional(
          Type.String({ description: "作者编辑后的内容；只在采纳单个候选时提供，替换默认内容" }),
        ),
      }),
      execute: async (_id, raw) => {
        const args = raw as { id: string; action: "accept" | "reject"; text?: string };
        const pending = await loadPending();
        if (!pending || !pending.items.length)
          throw new Error("当前没有待确认的改稿学习候选；先跑 writer_revision_learn");
        const chosen = args.id === "all" ? [...pending.items] : [];
        if (args.id !== "all") {
          const hit = pending.items.find((item) => item.id === args.id);
          if (!hit)
            throw new Error(
              `没有这个改稿学习候选：${args.id}（现有：${pending.items.map((item) => item.id).join("、")}）`,
            );
          chosen.push(hit);
        }
        if (args.text !== undefined && args.id === "all")
          throw new Error("text 编辑后的内容只适用于单个候选（id 传具体 id，不能用 all）");
        const written: string[] = [];
        if (args.action === "accept") {
          if (target.mode === "fanqie") {
            const dir = await resolveFanqieWork(host.options, target);
            for (const item of chosen)
              await FoundationPort.appendStyleCard(dir, styleEntryOf(item, args.text));
            written.push(`作品 foundation.style（${dir}）`);
          } else {
            for (const item of chosen) await appendToutiaoFeedback(item, args.text);
            written.push("feedback.md");
          }
        }
        const chosenIds = new Set(chosen.map((item) => item.id));
        const remaining = pending.items.filter((item) => !chosenIds.has(item.id));
        const file = await pendingFile();
        if (remaining.length)
          await atomicWrite(file, JSON.stringify({ ...pending, items: remaining }, null, 2) + "\n");
        else await rm(file, { force: true });
        const head =
          args.action === "accept"
            ? `已按作者决定采纳 ${chosen.length} 条改稿学习候选，写入${written.join("、")}：`
            : `已按作者决定拒绝 ${chosen.length} 条改稿学习候选：`;
        const lines = chosen.map(
          (item, index) => `${index + 1}. ${item.condition} → ${item.change}（id=${item.id}）`,
        );
        const tail = remaining.length
          ? `剩余待确认 ${remaining.length} 条。`
          : "待确认候选已清空。";
        return {
          content: [{ type: "text" as const, text: [head, ...lines, tail].join("\n") }],
          details: {},
        };
      },
    },
  ];
}
