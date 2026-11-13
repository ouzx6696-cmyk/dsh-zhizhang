import { ContextPanel } from "./ContextPanel";
import { COPY as viewCopy, AGENT_COPY } from "@writer/ui/copy";
import { TaskProgress } from "./TaskProgress";
import { AgentMessageList, ChatStream } from "./AgentMessages";
import React, { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Send, Plus, History, Square } from "lucide-react";
import { humanVersion } from "../../format";
import { scopeId, focusLabel, type Focus, type Target } from "../../../context";
import { useChatSelector } from "../../state/chatStore";
import { ARTICLE_STEPS } from "@writer/ui/status";
import { desktop } from "../../state/desktop";
import type { DesktopActions } from "../../app/useDesktopController";
import { useDesktopSelector } from "../../state/store";
import { quickActions } from "./quickActions";
import { footerStatus, useDraft, useQueue } from "./composer";

// 输入框随内容长高，超过后在框内滚动。
const INPUT_MAX_HEIGHT = 200;

const NOVEL_STEPS = [
  viewCopy.agentPanelText2,
  viewCopy.tabInspiration,
  viewCopy.agentPanelText3,
  viewCopy.agentPanelText4,
  viewCopy.agentPanelText5,
  viewCopy.agentPanelText6,
];

export const AgentPanel = React.memo(function AgentPanel({ actions }: { actions: DesktopActions }) {
  const { fail, set, input } = actions;
  const system = useDesktopSelector((state) => state.system);
  const selected = useDesktopSelector((state) => state.selected);
  const focus = useDesktopSelector((state) => state.focus);
  const context = useDesktopSelector((state) => state.context);
  const messages = useChatSelector((chat) => chat.messages);
  const busy = useChatSelector((chat) => chat.busy);
  const phase = useChatSelector((chat) => chat.phase);
  const task = useChatSelector((chat) => chat.task);
  const total = useChatSelector((chat) => chat.total);
  const archive = useChatSelector((chat) => chat.archive);
  const archives = useChatSelector((chat) => chat.archives);
  const draftKey = scopeId(selected);
  const [draft, setDraft] = useDraft(draftKey);
  const [queued, enqueue] = useQueue(draftKey, busy, messages);
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = Math.min(field.scrollHeight, INPUT_MAX_HEIGHT) + "px";
  }, [draft, input]);
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
    const queuing = busy && !value.startsWith("/");
    stickToBottom.current = true;
    if (!(await actions.submit(value))) return;
    if (queuing) enqueue(value);
    setDraft((current) => (current === value ? "" : current));
  };
  const steps = selected?.mode === "toutiao" ? ARTICLE_STEPS : NOVEL_STEPS;
  const readOnly = Boolean(system?.access?.readOnly);
  const status = footerStatus({
    archived: archive !== undefined,
    readOnly,
    hasWork: Boolean(selected),
    model: system?.models.writer ?? { configured: false, model: "" },
    busy,
    task,
  });
  const quick = quickActions(context);
  const handleJump = useCallback(
    (target: Target | null, nextFocus?: Focus) => void actions.jump(target, nextFocus).catch(fail),
    [actions, fail],
  );
  return (
    <div className="agent-panel">
      {system && (
        <ContextPanel
          key={`${draftKey}:${actions.conversationId ?? "new"}`}
          target={selected ?? undefined}
          busy={busy || archive !== undefined}
          task={task}
          initialSettings={system.context}
        />
      )}
      <TaskProgress
        task={task}
        busy={busy}
        phase={phase}
        steps={steps}
        queued={queued.length}
        onStop={() => void actions.stop().catch(actions.fail)}
      />
      <div className="conversation-tools">
        <button
          disabled={!selected}
          onClick={async () => {
            if (!selected) return;
            try {
              actions.setChat({ archives: await desktop.conversations(selected) });
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
            actions.archived.current = value;
            actions.setChat({ archive: value });
            void actions.loadView(selected, 80, value).catch(fail);
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
          onClick={() => actions.command(viewCopy.agentPanelText40).catch(fail)}
        >
          <Plus size={14} />
        </button>
      </div>
      {/* 记录本身不做 live region：流式逐字更新会被读屏连读；回复结束由 ChatStream 统一宣告一次。 */}
      <div
        className="chat-messages"
        role="log"
        aria-label={AGENT_COPY.log}
        aria-live="off"
        tabIndex={0}
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
              actions.limit.current += 80;
              void actions.loadView(selected, actions.limit.current, archive).catch((error) => {
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
                readOnly ||
                !selected ||
                (selected.mode === "toutiao" && !selected.article && !focus.article)
              }
              key={id}
              onClick={() => actions.command(id).catch(fail)}
            >
              {label}
            </button>
          ))}
          <button onClick={() => set({ palette: true })}>{viewCopy.agentPanelText44}</button>
        </div>
        {queued.length > 0 && (
          <ul className="agent-queue" aria-label={AGENT_COPY.queueTitle}>
            {queued.map((item) => (
              <li key={item.id}>
                <span className="agent-queue-text" title={item.text}>
                  {item.text}
                </span>
                <small>{AGENT_COPY.queued}</small>
              </li>
            ))}
          </ul>
        )}
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
              // 输入法组字时的 Enter 只确认候选词；部分输入法在 compositionend 后仍以 229 报键。
              const composing = event.nativeEvent.isComposing || event.keyCode === 229;
              if (event.key === "Enter" && !event.shiftKey && !composing) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <footer>
            <span className="agent-input-status">{status}</span>
            {busy && (
              <button
                type="button"
                className="agent-input-stop"
                aria-label={AGENT_COPY.stopLabel}
                onClick={() => void actions.stop().catch(fail)}
              >
                <Square size={12} aria-hidden="true" />
                {AGENT_COPY.stop}
              </button>
            )}
            <button
              className="primary"
              disabled={!selected || archive !== undefined}
              aria-label={busy ? AGENT_COPY.queueSend : AGENT_COPY.send}
            >
              <Send size={14} aria-hidden="true" />
              {busy ? viewCopy.agentPanelText53 : viewCopy.agentPanelText52}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
});
