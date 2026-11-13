import { Type } from "typebox";
import { atomicWrite } from "../../../../packages/core/src/fsx";
import { resolveFanqieWork } from "../main/storage";
import { accumulateChildUsage } from "./editor-task";
import { promptWithSignal, type AgentSession, type ToolDefinition } from "./pi-adapter";
import {
  mergePending,
  parseLearnOutput,
  fanqiePairs,
  toutiaoPairs,
  learnPrompt,
  learnReport,
  type LearnMode,
  type LearnItem,
} from "./learning-data";
import { learningFile, readLearning, decideLearning } from "./learning-store";
import type { Sessions } from "./manager";
import type { SessionEntry } from "./types";
import type { Target } from "../context";
import type { FeedbackEntry } from "../../../../packages/toutiao/src/store";
const LEARN_DEFAULT_LIMIT = 10;
const MODE_LABELS: Record<LearnMode, string> = { fanqie: "番茄长篇", toutiao: "今日头条" };
// Public learning helpers stay available from the established module.
export {
  pendingId,
  mergePending,
  parseLearnOutput,
  styleEntryOf,
  feedbackEntryOf,
} from "./learning-data";
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
}): ToolDefinition[] {
  const { host, target, getEntry, getSession } = options;
  const pendingFile = () => learningFile(host, target);
  const loadPending = () => readLearning(host, target);
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
        const releaseChild = host.registerChild(session, child);
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
          releaseChild();
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
        const { chosen, remaining, written } = await decideLearning(
          host,
          target,
          args.id,
          args.action,
          args.text,
        );
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
