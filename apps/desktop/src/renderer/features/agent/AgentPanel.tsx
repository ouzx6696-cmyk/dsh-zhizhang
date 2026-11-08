import { ContextPanel } from "./ContextPanel";
import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import { TaskProgress } from "./TaskProgress";
import { AgentMessageList, ChatStream } from "./AgentMessages";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Send, Plus, History } from "lucide-react";
import { humanVersion } from "../../format";
import { getCommand } from "../../../commands";
import { scopeId, focusLabel, type Focus, type Target } from "../../../context";
import { useChatSelector } from "../../state/chatStore";
import { ARTICLE_STEPS } from "../../../../../../packages/ui/src/status";
import { desktop } from "../../state/desktop";
import type { DesktopController } from "../../app/useDesktopController";

const drafts = new Map<string, string>();

export function AgentPanel({ app }: { app: DesktopController }) {
  const { state, selected, focus, context, fail, set, input } = app;
  const messages = useChatSelector((chat) => chat.messages);
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
  // 「查看更早记录」在顶部插入消息：记下距底部的距离，提交后还原，视口停在原来读到的位置。
  const olderAnchor = useRef<number | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || olderAnchor.current === null) return;
    list.scrollTop = list.scrollHeight - olderAnchor.current;
    olderAnchor.current = null;
  }, [messages]);
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
  const quick = useMemo(() => {
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
    return quickChoices.map(([id, label]) => ({ ...getCommand(id), label }));
  }, [
    context.kind,
    context.article?.status,
    context.chapter,
    context.outlineReady,
    context.hasCandidate,
    context.review?.verdict,
  ]);
  // 控制器每次渲染都是新对象；经 ref 取最新方法，让结果卡的跳转回调保持稳定。
  const latest = useRef(app);
  useEffect(() => {
    latest.current = app;
  });
  const handleJump = useCallback((target: Target | null, nextFocus?: Focus) => {
    latest.current.jump(target, nextFocus).catch(latest.current.fail);
  }, []);
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
          disabled={!selected}
          onClick={async () => {
            if (!selected) return;
            try {
              app.setChat({ archives: await desktop.conversations(selected) });
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
          onChange={(event) => {
            if (!selected) return;
            const value = event.target.value === "current" ? undefined : Number(event.target.value);
            app.archived.current = value;
            app.setChat({ archive: value });
            void app.loadView(selected, 80, value).catch(fail);
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
              if (!selected) return;
              const list = listRef.current;
              if (list) olderAnchor.current = list.scrollHeight - list.scrollTop;
              stickToBottom.current = false;
              app.limit.current += 80;
              void app.loadView(selected, app.limit.current, archive).catch((error) => {
                olderAnchor.current = null;
                fail(error);
              });
            }}
          >
            {viewCopy.agentPanelText41}
          </button>
        )}
        <AgentMessageList messages={messages} onJump={handleJump} />
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
          <button onClick={() => set({ palette: true })}>{viewCopy.agentPanelText44}</button>
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
                set({ palette: true });
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
