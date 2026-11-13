import { Type } from "typebox";
import type { AgentSession, SessionManager, ToolDefinition } from "./pi-adapter";
import type { Focus, Target } from "../context";
import { focusLabel } from "../context";
import { promptWithSignal } from "./pi-adapter";
import { reviewResult, taskPrompt } from "./prompt";
import type { Sessions } from "./manager";
import type { SessionEntry } from "./types";
import {
  ArticleStore,
  nowIso,
  parseReaderReview,
  READER_RUBRIC,
} from "../../../../packages/toutiao/src/store";

/** 子会话用量回加：SDK 统计累加进父任务的用量与成本（writer_review/plan 与抽卡共用）。 */
export function accumulateChildUsage(entry: SessionEntry, child: AgentSession) {
  const stats = child.getSessionStats();
  entry.task.tokens += stats.tokens.total;
  entry.task.cost += stats.cost;
  entry.task.usage.input += stats.tokens.input;
  entry.task.usage.output += stats.tokens.output;
  entry.task.usage.cacheRead += stats.tokens.cacheRead;
  entry.task.usage.cacheWrite += stats.tokens.cacheWrite;
}

/** qa.judge 开启时追加给头条编辑子会话的读者评审任务。
 * 这是文章工作流内的读者建议，不参与软件发布验收。 */
const TOUTIAO_READER_REVIEW_TASK = `【读者评审】红笔与质检完成后，换成一个在信息流里刷到这篇文章的普通读者，只依据这篇稿件本身，按九项标尺逐项 1–5 分（1 很差，5 很好）并各给一句依据稿件原意的证据，不复述内容代替判断：${READER_RUBRIC.join("、")}。读完意愿 ≤2 时明确建议作者“回 S4 调骨架”（是否回由作者决定，不要自动回，也不要自行改状态）。最后单独输出一个 JSON 对象（不要代码围栏、不要解释、不要多余键）：
{"scores":{"标题":3,"开篇三段":4,"人物":3,"引语":2,"延伸":4,"节奏":4,"结尾":3,"不像模板":3,"读完意愿":4},"evidences":{"标题":"一句证据","开篇三段":"一句证据","人物":"一句证据","引语":"一句证据","延伸":"一句证据","节奏":"一句证据","结尾":"一句证据","不像模板":"一句证据","读完意愿":"一句证据"}}`;

/** 编辑回报里的读者评审 JSON 落到 meta.qa 最近一条；没解析到或没质检记录时如实返回说明。 */
async function attachReaderReviewNote(
  target: Target,
  articleId: string,
  child: AgentSession,
): Promise<string> {
  const store = new ArticleStore(target.root);
  const meta = await store.get(articleId);
  const review = parseReaderReview(child.getLastAssistantText() || "", meta.current_rev, nowIso());
  if (!review)
    return "读者评审未落盘：编辑回报里没有可解析的九项 JSON（qa.judge 已开启），可让编辑补一次或忽略。";
  const attached = await store.attachReaderReview(articleId, review);
  return attached
    ? `读者评审已记入 meta.qa 最近一条（rev ${review.rev}）：读完意愿 ${review.scores["读完意愿"]} 分。`
    : "读者评审未落盘：这篇文章还没有与当前版本匹配的质检记录，先重跑 toutiao_qa_check 再评审。";
}

export function createDelegateTools(options: {
  host: Sessions;
  target: Target;
  manager: SessionManager;
  getEntry: () => SessionEntry;
  getSession: () => AgentSession;
}): ToolDefinition[] {
  const { host, target, getEntry, getSession } = options;
  const tools: ToolDefinition[] = [];
  for (const delegate of ["editor", "planner"] as const)
    tools.push({
      name: delegate === "editor" ? "writer_review" : "writer_plan",
      label: delegate === "editor" ? "编辑审读" : "规划与拆书",
      description:
        delegate === "editor"
          ? "派独立编辑审读指定文章或章节，交回审读回报或编辑稿。"
          : "派规划角色处理开书、卷幕、章纲或拆书任务，交回规划结果，不自动推进正文。",
      parameters: Type.Object({
        task: Type.String({ description: "审读任务说明" }),
        work: Type.Optional(Type.String({ description: "作品 key" })),
        chapter: Type.Optional(Type.String({ description: "章节 id" })),
        article: Type.Optional(Type.String({ description: "头条文章 id" })),
      }),
      execute: async (_id, args, signal) => {
        const entry = getEntry();
        const session = getSession();
        const request = args as {
          task: string;
          work?: string;
          chapter?: string;
          article?: string;
        };
        if (request.work && request.work !== target.work) throw new Error("委派只能处理当前小说");
        if (request.article && request.article !== target.article)
          throw new Error("委派只能处理当前文章");
        const childTarget = {
          ...target,
          ...(request.work ? { work: request.work } : {}),
        };
        const focus: Focus = {
          ...(request.work && request.work !== target.work ? {} : entry.focus),
          ...(request.chapter && request.chapter !== entry.focus.chapter
            ? { title: undefined, revision: undefined }
            : {}),
          ...(request.article && request.article !== entry.focus.article
            ? { title: undefined, revision: undefined }
            : {}),
          ...(request.chapter
            ? {
                chapter: request.chapter,
                candidate: undefined,
                source: "chapter" as const,
              }
            : {}),
          ...(request.article ? { article: request.article } : {}),
          intent: delegate === "editor" ? "review" : "plan",
        };
        entry.phase = delegate === "editor" ? "编辑审读中…" : "规划任务进行中…";
        const saved: { tool: string; receipt: string }[] = [];
        const child = await host.open(
          childTarget,
          delegate === "editor",
          delegate === "planner",
          async (work) => {
            if (target.mode === "toutiao") childTarget.article = work;
            else childTarget.work = work;
            if (!(target.mode === "toutiao" ? target.article : target.work))
              await host.attachCreated(entry, work);
          },
          (tool, receipt) => saved.push({ tool, receipt }),
        );
        const releaseChild = host.registerChild(session, child);
        const judgeOn =
          delegate === "editor" &&
          target.mode === "toutiao" &&
          host.options.toutiao?.qa?.judge === true;
        try {
          await promptWithSignal(
            child,
            () =>
              taskPrompt(
                host,
                childTarget,
                judgeOn ? `${request.task}\n\n${TOUTIAO_READER_REVIEW_TASK}` : request.task,
                focus,
              ),
            signal,
          );
          const last = child.messages.findLast((message) => message.role === "assistant");
          if (
            last?.role === "assistant" &&
            (last.stopReason === "error" || last.stopReason === "aborted")
          )
            throw new Error(last.errorMessage || "编辑已停止，未交回完整结论");
          const result =
            delegate === "editor"
              ? {
                  ...(await reviewResult(host, childTarget, focus, true)),
                  kind: "review",
                }
              : {
                  target: childTarget,
                  focus,
                  label: focusLabel(childTarget, focus),
                  summary: saved.length
                    ? `规划执行了 ${saved.length} 次保存操作，请核对以下工具回执。`
                    : "规划建议已返回；没有确认的保存回执，不代表规划已落盘。",
                  status: saved.length ? "saved" : "discussion",
                  saved,
                  kind: "planning",
                };
          if (judgeOn && childTarget.article)
            result.summary += `\n${await attachReaderReviewNote(target, childTarget.article, child)}`;
          return {
            content: [
              {
                type: "text",
                text:
                  result.summary +
                  ("saved" in result
                    ? "\n" + result.saved?.map((item) => `${item.tool}: ${item.receipt}`).join("\n")
                    : "") +
                  "\n\n" +
                  (child.getLastAssistantText() || "编辑未返回文字结论。"),
              },
            ],
            details: { writerResult: result },
          };
        } finally {
          accumulateChildUsage(entry, child);
          releaseChild();
          child.dispose();
          entry.phase =
            delegate === "editor" ? "编辑任务结束，正在整理结果…" : "规划任务结束，正在整理结果…";
        }
      },
    });
  return tools;
}
