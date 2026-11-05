import { ContextPanel } from "./ContextPanel";
import { COPY as viewCopy, t as viewText } from "../../../../../../packages/ui/src/copy.js";
import { writerResult } from "../../../writer-result";
import { TaskProgress } from "./TaskProgress";
import React, { useEffect, useRef, useState } from "react";
import { Send, Plus, History, Feather, ArrowRight } from "lucide-react";
import { Markdown } from "../../../Markdown";
import { humanVersion, actionTitle } from "../../format";
import { getCommand } from "../../../commands";
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
      <p>{viewCopy.agentPanelText1}</p>
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
      : [
          viewCopy.agentPanelText2,
          viewCopy.tabInspiration,
          viewCopy.agentPanelText3,
          viewCopy.agentPanelText4,
          viewCopy.agentPanelText5,
          viewCopy.agentPanelText6,
        ];
  const quickChoices =
    context.kind === "article"
      ? context.article?.status === viewCopy.toutiaoAppText4
        ? [
            [viewCopy.agentPanelText7, viewCopy.ttContinue],
            [viewCopy.agentPanelText8, viewCopy.agentPanelText9],
          ]
        : [
            [viewCopy.agentPanelText7, viewCopy.ttContinue],
            [viewCopy.agentPanelText10, viewCopy.ttReview],
            [viewCopy.ttQa, viewCopy.ttQa],
          ]
      : context.chapter && !context.outlineReady
        ? [
            [viewCopy.agentPanelText11, viewCopy.agentPanelText11],
            [viewCopy.agentPanelText12, viewCopy.agentPanelText13],
          ]
        : context.hasCandidate
          ? [
              [viewCopy.agentPanelText14, viewCopy.agentPanelText14],
              [viewCopy.agentPanelText10, viewCopy.agentPanelText15],
              [viewCopy.agentPanelText16, viewCopy.deliverRevise],
            ]
          : context.review?.verdict && context.review.verdict !== viewCopy.reviewPass
            ? [
                [viewCopy.agentPanelText16, viewCopy.deliverRevise],
                [viewCopy.agentPanelText10, viewCopy.agentPanelText17],
              ]
            : context.chapter?.status === "final"
              ? [
                  [viewCopy.agentPanelText7, viewCopy.deliverContinue],
                  [viewCopy.agentPanelText18, viewCopy.agentPanelText19],
                ]
              : [
                  [viewCopy.agentPanelText7, viewCopy.agentPanelText20],
                  [viewCopy.agentPanelText10, viewCopy.agentPanelText15],
                  [viewCopy.ttQa, viewCopy.agentPanelText21],
                ];
  const quick = quickChoices.map(([id, label]) => ({ ...getCommand(id), label }));
  function resultCard(
    result: import("../../../renderer-contracts").WriterResult,
    candidateNumber?: number,
  ) {
    const title =
      result.kind === "candidate"
        ? result.draftLabel
          ? viewText("agentPanelText22", { value0: result.draftLabel })
          : viewText("agentPanelText23", { value0: candidateNumber ? " " + candidateNumber : "" })
        : (
            {
              review: viewCopy.agentPanelText24,
              qa: viewCopy.agentPanelText25,
              delivery: viewCopy.ttViewDelivery,
              planning: viewCopy.agentPanelText26,
            } as Record<string, string>
          )[result.kind] || viewCopy.agentPanelText27;
    return (
      <div
        className={"result-card " + (result.failed ? "failed" : "")}
        data-kind={result.kind || "review"}
      >
        <strong>{title}</strong>
        <p>{result.summary}</p>
        <button onClick={() => app.jump(result.target, result.focus).catch(fail)}>
          {viewCopy.agentPanelText28}
          <ArrowRight size={14} />
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
            <strong>
              {toolLabel(message.toolName || "")}
              {viewCopy.agentPanelText29}
            </strong>
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
    if (message.role === "user" && parsed.text.startsWith(viewCopy.agentPanelText30)) {
      return (
        <article className="chat-message user action-capsule" key={index}>
          <small>{viewCopy.agentPanelText31}</small>
          <details>
            <summary>
              <span>{actionTitle(parsed.text) || viewCopy.agentPanelText32}</span>
              <span className="action-capsule-more">{viewCopy.agentPanelText33}</span>
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
          {message.role === "user"
            ? viewCopy.agentPanelText34
            : message.role === "custom"
              ? viewCopy.agentPanelText35
              : "Agent"}
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
      {state.system && (
        <ContextPanel
          key={`${draftKey}:${app.conversationId ?? "new"}`}
          target={selected ?? undefined}
          busy={busy || archive !== undefined}
          task={task}
          initialSettings={state.system.context}
          onSaved={app.syncState}
        />
      )}
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
          {viewCopy.agentPanelText36}
        </button>
        <select
          aria-label={viewCopy.agentPanelText37}
          value={archive ?? "current"}
          onChange={async (event) => {
            const value = event.target.value === "current" ? undefined : Number(event.target.value);
            app.archived.current = value;
            app.setChat({ archive: value });
            await app.loadView(selected!, 80, value);
          }}
        >
          <option value="current">{viewCopy.agentPanelText38}</option>
          {archives.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button
          title={viewCopy.agentPanelText39}
          onClick={() => app.command(viewCopy.agentPanelText40).catch(fail)}
        >
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
            {viewCopy.agentPanelText41}
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
              <summary>
                {viewCopy.agentPanelText42}
                {names.size}
                {viewCopy.agentPanelText43}
              </summary>
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
          {quick.map(({ id, label }) => (
            <button
              disabled={
                archive !== undefined ||
                state.system?.access?.readOnly ||
                !selected ||
                (selected.mode === "toutiao" && !selected.article && !focus.article)
              }
              key={id}
              onClick={() => app.command(id).catch(fail)}
            >
              {label}
            </button>
          ))}
          <button onClick={() => set({ palette: true, query: "" })}>
            {viewCopy.agentPanelText44}
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="input-target">
            {selected ? focusLabel(selected, focus) : viewCopy.agentPanelText45}
            {focus.revision !== undefined ? " · " + humanVersion(focus.revision) : ""}
          </div>
          {busy && task && <small className="running-target">{viewCopy.agentPanelText46}</small>}
          {focus.dirty && <small className="form-warning">{viewCopy.agentPanelText47}</small>}
          <textarea
            ref={input}
            aria-label={viewCopy.agentPanelText48}
            placeholder={viewCopy.agentPanelText49}
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
              {task?.tokens ? task.tokens.toLocaleString() + " tokens" : viewCopy.agentPanelText50}
              {task?.tokens
                ? " · " + (task.cost > 0 ? "$" + task.cost.toFixed(4) : viewCopy.agentPanelText51)
                : ""}
            </span>
            <button
              className="primary"
              disabled={!selected || archive !== undefined}
              aria-label={viewCopy.agentPanelText52}
            >
              <Send size={14} />
              {busy ? viewCopy.agentPanelText53 : viewCopy.agentPanelText52}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
