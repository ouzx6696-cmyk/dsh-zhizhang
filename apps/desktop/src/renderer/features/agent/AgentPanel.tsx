import { writerResult } from "../../../writer-result";
import { TaskProgress } from "./TaskProgress";
import React, { useEffect, useRef, useState } from "react";
import { Send, Plus, History, Feather, ArrowRight } from "lucide-react";
import { Markdown } from "../../../Markdown";
import { humanVersion, actionTitle } from "../../../commands";
import { scopeId, focusLabel, promptContext, toolLabel } from "../../../context";
import type { ChatMessage } from "../../state/store";
import { useChatSelector } from "../../state/chatStore";
import { ARTICLE_STEPS } from "../../../../../../packages/ui/src/status";
import { desktop } from "../../state/desktop";
import type { DesktopController } from "../../app/useDesktopController";

function messageBody(message: ChatMessage) {
  return typeof message.content === "string"
    ? message.content
    : (message.content || [])
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
}

function ChatStream({
  hasMessages,
  listRef,
  stickToBottom,
}: {
  hasMessages: boolean;
  listRef: React.RefObject<HTMLDivElement | null>;
  stickToBottom: React.MutableRefObject<boolean>;
}) {
  const stream = useChatSelector((chat) => chat.stream);
  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [stream, listRef, stickToBottom]);
  if (stream)
    return (
      <article className="chat-message assistant">
        <small>Agent</small>
        <Markdown text={stream} />
      </article>
    );
  if (hasMessages) return null;
  return (
    <div className="chat-empty">
      <Feather size={24} />
      <p>从一句想法开始，或选择下方动作。稿件、候选与作者决定都会保留在作品里。</p>
    </div>
  );
}

const drafts = new Map<string, string>();

export function AgentPanel({ app }: { app: DesktopController }) {
  const { state, selected, focus, context, fail, set, input } = app;
  const messages = useChatSelector((chat) => chat.messages);
  const candidateNumbers = new Map<number, number>();
  const chapterCounts = new Map<string, number>();
  messages.forEach((message, index) => {
    const result = message.role === "toolResult" ? writerResult(message) : null;
    if (result?.kind !== "candidate") return;
    const key = [result.target?.root, result.target?.work, result.focus?.chapter].join("|");
    const number = (chapterCounts.get(key) || 0) + 1;
    chapterCounts.set(key, number);
    candidateNumbers.set(index, number);
  });
  const busy = useChatSelector((chat) => chat.busy);
  const phase = useChatSelector((chat) => chat.phase);
  const task = useChatSelector((chat) => chat.task);
  const total = useChatSelector((chat) => chat.total);
  const archive = useChatSelector((chat) => chat.archive);
  const archives = useChatSelector((chat) => chat.archives);
  const draftKey = scopeId(selected);
  const [draft, updateDraft] = useState(drafts.get(draftKey) || "");
  const setDraft = (value: string | ((current: string) => string)) => {
    updateDraft((current) => {
      const next = typeof value === "function" ? value(current) : value;
      drafts.set(draftKey, next);
      return next;
    });
  };
  useEffect(() => updateDraft(drafts.get(draftKey) || ""), [draftKey]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    stickToBottom.current = true;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [selected]);
  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [messages]);
  const submit = async (event?: { preventDefault(): void }) => {
    event?.preventDefault();
    if (!draft.trim()) return;
    const value = draft;
    stickToBottom.current = true;
    if (await app.submit(value)) setDraft((current) => (current === value ? "" : current));
  };
  const steps =
    selected?.mode === "toutiao"
      ? ARTICLE_STEPS
      : ["读材料", "规划", "起草", "自检", "出候选", "送审"];
  const quick =
    context.kind === "article"
      ? context.article?.status === "已交稿"
        ? [
            ["续写", "继续推进"],
            ["交稿", "准备交稿"],
          ]
        : [
            ["续写", "继续推进"],
            ["派编辑", "派编辑红笔"],
            ["质检", "质检"],
          ]
      : context.chapter && !context.outlineReady
        ? [
            ["补全章纲", "补全章纲"],
            ["拆书", "参考拆书"],
          ]
        : context.hasCandidate
          ? [
              ["对照采纳", "对照采纳"],
              ["派编辑", "派编辑审"],
              ["改本章", "按回报修改"],
            ]
          : context.review?.verdict && context.review.verdict !== "通过"
            ? [
                ["改本章", "按回报修改"],
                ["派编辑", "重新审读"],
              ]
            : context.chapter?.status === "final"
              ? [
                  ["续写", "续写下一章"],
                  ["导出", "导出定稿"],
                ]
              : [
                  ["续写", "继续写作"],
                  ["派编辑", "派编辑审"],
                  ["质检", "检查本章"],
                ];
  function resultCard(
    result: import("../../../renderer-contracts").WriterResult,
    candidateNumber?: number,
  ) {
    const title =
      result.kind === "candidate"
        ? result.draftLabel
          ? `候选稿「${result.draftLabel}」`
          : `候选稿${candidateNumber ? " " + candidateNumber : ""}`
        : (
            {
              review: "审读回报",
              qa: "质检结果",
              delivery: "交稿单",
              planning: "规划回报",
            } as Record<string, string>
          )[result.kind] || "任务回报";
    return (
      <div
        className={"result-card " + (result.failed ? "failed" : "")}
        data-kind={result.kind || "review"}
      >
        <strong>{title}</strong>
        <p>{result.summary}</p>
        <button onClick={() => app.jump(result.target, result.focus).catch(fail)}>
          对照查看 <ArrowRight size={14} />
        </button>
      </div>
    );
  }
  function renderMessage(message: ChatMessage, index: number) {
    const original = messageBody(message);
    if (!original) return null;
    if (message.role === "custom" && message.display === false) return null;
    if (message.role === "toolResult") {
      const result = writerResult(message);
      if (result) return <div key={index}>{resultCard(result, candidateNumbers.get(index))}</div>;
      if (message.isError)
        return (
          <div className="result-card failed" key={index} role="alert">
            <strong>{toolLabel(message.toolName || "")}未完成</strong>
            <Markdown text={original} />
          </div>
        );
      return (
        <div className="tool-action" key={index}>
          {toolLabel(message.toolName || "")}
        </div>
      );
    }
    const parsed =
      message.role === "user" ? promptContext(original) : { text: original, context: null };
    if (message.role === "user" && parsed.text.startsWith("【写作台】")) {
      return (
        <article className="chat-message user action-capsule" key={index}>
          <small>你 · 发起动作</small>
          <details>
            <summary>
              <span>{actionTitle(parsed.text) || "已发起写作动作"}</span>
              <span className="action-capsule-more">查看指令</span>
            </summary>
            <div className="action-capsule-body">
              <Markdown text={parsed.text} />
            </div>
          </details>
        </article>
      );
    }
    return (
      <article className={"chat-message " + message.role} key={index}>
        <small>
          {message.role === "user" ? "你" : message.role === "custom" ? "作者操作" : "Agent"}
          {parsed.context?.focus?.title ? " · " + parsed.context.focus.title : ""}
          {parsed.context?.focus?.revision
            ? " · " + humanVersion(parsed.context.focus.revision)
            : ""}
        </small>
        <Markdown text={parsed.text} />
      </article>
    );
  }
  return (
    <div className="agent-panel">
      <TaskProgress
        task={task}
        busy={busy}
        phase={phase}
        steps={steps}
        onStop={() => void app.stop().catch(app.fail)}
      />
      <div className="conversation-tools">
        <button
          onClick={async () => {
            try {
              app.setChat({ archives: await desktop.conversations(selected!) });
              set({ palette: false });
            } catch (error) {
              fail(error);
            }
          }}
        >
          <History size={13} />
          历史
        </button>
        <select
          aria-label="历史对话"
          value={archive ?? "current"}
          onChange={async (event) => {
            const value = event.target.value === "current" ? undefined : Number(event.target.value);
            app.archived.current = value;
            app.setChat({ archive: value });
            await app.loadView(selected!, 80, value);
          }}
        >
          <option value="current">当前对话</option>
          {archives.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button title="新对话，保留作品" onClick={() => app.command("新对话").catch(fail)}>
          <Plus size={14} />
        </button>
      </div>
      <div
        className="chat-messages"
        ref={listRef}
        onScroll={(event) => {
          const list = event.currentTarget;
          stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
        }}
      >
        {messages.length < total && (
          <button
            onClick={() => {
              app.limit.current += 80;
              void app.loadView(selected!, app.limit.current, archive).catch(fail);
            }}
          >
            查看更早记录
          </button>
        )}
        {messages.map((message, index) => {
          const plainTool = (m: ChatMessage) =>
            m.role === "toolResult" && !writerResult(m) && !m.isError;
          if (!plainTool(message)) return renderMessage(message, index);
          if (
            index > 0 &&
            writerResult(messages[index - 1]) &&
            messages[index - 1].toolName === message.toolName
          )
            return null;
          if (index > 0 && plainTool(messages[index - 1])) return null;
          const names = new Set<string>();
          for (let i = index; i < messages.length && plainTool(messages[i]); i++)
            names.add(toolLabel(messages[i].toolName || ""));
          return (
            <details className="lamp-tool-summary" key={index}>
              <summary>已完成 {names.size} 项准备与检查</summary>
              {[...names].map((name) => (
                <p key={name}>{name}</p>
              ))}
            </details>
          );
        })}
        <ChatStream
          hasMessages={messages.length > 0}
          listRef={listRef}
          stickToBottom={stickToBottom}
        />
      </div>
      <div className="agent-input-area">
        <div className="quick-actions">
          {quick.map(([id, label]) => (
            <button
              disabled={archive !== undefined || state.system?.access?.readOnly || !selected}
              key={id}
              onClick={() => app.command(id).catch(fail)}
            >
              {label}
            </button>
          ))}
          <button onClick={() => set({ palette: true, query: "" })}>/ 更多命令</button>
        </div>
        <form onSubmit={submit}>
          <div className="input-target">
            {selected ? focusLabel(selected, focus) : "尚未选择作品"}
            {focus.revision !== undefined ? " · " + humanVersion(focus.revision) : ""}
          </div>
          {busy && task && <small className="running-target">运行任务仍处理发送时的对象</small>}
          {focus.dirty && (
            <small className="form-warning">段落尚未保存；Agent 使用已保存稿件。</small>
          )}
          <textarea
            ref={input}
            aria-label="写作要求"
            placeholder="继续说要求，Enter 发送 · Shift+Enter 换行"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "/" && !draft) {
                event.preventDefault();
                set({ palette: true, query: "" });
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <footer>
            <span>
              {task?.tokens ? task.tokens.toLocaleString() + " tokens" : "本地作品 · 由你决定"}
              {task?.tokens
                ? " · " + (task.cost > 0 ? "$" + task.cost.toFixed(4) : "费用以服务商账单为准")
                : ""}
            </span>
            <button
              className="primary"
              disabled={!selected || archive !== undefined}
              aria-label="发送"
            >
              <Send size={14} />
              {busy ? "排队" : "发送"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
