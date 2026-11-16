import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, ChevronRight, Plus, Sparkles, Square } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, IconButton, Select, Spinner } from "@zhizhang/ui/primitives";
import { draftStore } from "@zhizhang/workbench/client";
import type { SessionIntent, Target } from "../../../shared/views";
import { toolLabel } from "../../../context";
import { useChat } from "../../state/chatStore";
import {
  compactConversation,
  modelReady,
  newConversation,
  openConversation,
  openSettings,
  refreshUsage,
  sendMessage,
  stopAssistant,
} from "../../state/controller";
import { scopeKey, useDesktop } from "../../state/store";
import { notifyError, run } from "../../format";
import { AgentMessages } from "./AgentMessages";

const INPUT_MAX_HEIGHT = 200;

interface QuickAction {
  id: string;
  label: string;
  text: string;
  intent: SessionIntent;
}

function quickActions(mode: Target["mode"]): QuickAction[] {
  return mode === "fanqie"
    ? [
        {
          id: "continue",
          label: C.agent.quick.continue,
          text: C.agent.quick.continueText,
          intent: "continue",
        },
        { id: "check", label: C.agent.quick.check, text: C.agent.quick.checkText, intent: "check" },
        { id: "plan", label: C.agent.quick.plan, text: C.agent.quick.planText, intent: "plan" },
      ]
    : [
        {
          id: "review",
          label: C.agent.quick.review,
          text: C.agent.quick.reviewText,
          intent: "review",
        },
        { id: "check", label: C.agent.quick.check, text: C.agent.quick.checkText, intent: "check" },
      ];
}

/** 输入草稿经 DraftStore 落盘（无写作文件夹时内存暂存），切换作品后回来不丢。 */
function useDraft(scope: string): [string, (value: string) => void] {
  const key = `agent:${scope}`;
  const [draft, setDraft] = useState("");
  const storedKey = useRef(key);
  const latestValue = useRef(draft);
  latestValue.current = draft;
  const timer = useRef<number | undefined>(undefined);

  // 打开时异步读取；切换作用目标前把未落盘的输入立刻写进旧目标的草稿。
  useEffect(() => {
    let alive = true;
    draftStore()
      .read(key)
      .then((entry) => {
        if (alive) setDraft(entry && entry.text ? entry.text : "");
      })
      .catch(() => undefined);
    storedKey.current = key;
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
      const value = latestValue.current;
      if (value)
        void draftStore()
          .write(storedKey.current, value, "")
          .catch(() => undefined);
    };
  }, [key]);

  const setDraftStored = useCallback((value: string) => {
    setDraft(value);
    latestValue.current = value;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const op = value
        ? draftStore().write(storedKey.current, value, "")
        : draftStore().clear(storedKey.current);
      op.catch(() => undefined);
    }, 500);
  }, []);

  return [draft, setDraftStored];
}

function ContextBar() {
  const usage = useChat((c) => c.usage);
  const busy = useChat((c) => c.busy);
  const conversationId = useChat((c) => c.conversationId);
  useEffect(() => {
    if (!busy) refreshUsage().catch(() => undefined);
  }, [busy, conversationId]);
  // 空对话不显示占用条：0% 与禁用的“整理”只是噪音。
  if (!usage || usage.messages === 0) return null;
  return (
    <div className="zz-context" data-testid="agent-context" data-percent={usage.percent}>
      <div
        className="zz-context__rail"
        role="meter"
        aria-label={C.agent.context}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={usage.percent}
      >
        <span style={{ width: `${Math.min(100, usage.percent)}%` }} />
      </div>
      <span className="zz-context__label">{C.agent.contextUsage(usage.percent)}</span>
      <Button
        size="sm"
        variant="ghost"
        className="zz-context__compact"
        data-testid="agent-compact"
        disabled={busy || usage.messages === 0}
        onClick={() => run(compactConversation)}
      >
        {C.agent.compact}
      </Button>
    </div>
  );
}

/** 右栏“助手”：只读工具 + 发起流水线；不能直接写正文。 */
export function AgentPanel({ target }: { target: Target }) {
  const messages = useChat((c) => c.messages);
  const stream = useChat((c) => c.stream);
  const busy = useChat((c) => c.busy);
  const tool = useChat((c) => c.tool);
  const ended = useChat((c) => c.ended);
  const conversations = useChat((c) => c.conversations);
  const conversationId = useChat((c) => c.conversationId);
  const settings = useDesktop((s) => s.settings);
  const focus = useDesktop((s) => s.focus);
  const [draft, setDraft] = useDraft(scopeKey(target));
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const ready = modelReady(settings);

  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  }, [draft]);

  useEffect(() => {
    const box = list.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, stream]);

  const send = async (text: string, intent?: SessionIntent) => {
    try {
      if ((await sendMessage(text, intent)) && !intent) setDraft("");
    } catch (error) {
      notifyError(error);
    }
  };

  const where = [focus.workTitle, focus.title || focus.chapter || focus.article]
    .filter(Boolean)
    .join(" / ");
  const quick = quickActions(target.mode);
  const chatting = messages.length > 0 || Boolean(stream);
  const submit = () => {
    if (!busy && ready && draft.trim()) void send(draft);
  };
  return (
    <div className="zz-agent" data-testid="agent-panel">
      <header className="zz-agent__head">
        <div className="zz-agent__head-row">
          <Select
            label={C.agent.conversations}
            testId="agent-conversations"
            className="zz-agent__conversations"
            value={conversationId}
            disabled={busy || conversations.length === 0}
            options={(conversations.length
              ? conversations
              : [{ id: conversationId, title: "", updated: "", messages: 0, current: true }]
            ).map((c) => ({
              value: c.id,
              label: c.title || C.agent.untitled,
            }))}
            onChange={(id) => run(() => openConversation(id))}
          />
          <IconButton
            label={C.agent.newConversation}
            size="sm"
            data-testid="agent-new-conversation"
            disabled={busy}
            icon={<Plus size={15} />}
            onClick={() => run(newConversation)}
          />
        </div>
        <ContextBar />
      </header>
      <div className="zz-agent__list" ref={list}>
        {messages.length || stream ? (
          <AgentMessages messages={messages} stream={stream} />
        ) : (
          <section className="zz-agent__welcome" data-testid="agent-welcome">
            <span className="zz-agent__welcome-icon" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <h3>{C.agent.emptyTitle}</h3>
            <p>{C.agent.emptyHint}</p>
            <ul className="zz-suggest" aria-label={C.agent.suggest}>
              {quick.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    className="zz-suggest__item"
                    data-testid={`agent-quick-${q.id}`}
                    disabled={busy || !ready}
                    onClick={() => void send(q.text, q.intent)}
                  >
                    <span className="zz-suggest__text">
                      <strong>{q.label}</strong>
                      <span>{q.text}</span>
                    </span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {busy ? (
        <p className="zz-agent__status" role="status" data-testid="agent-busy">
          <Spinner size="sm" label={C.agent.thinking} />
          {tool ? C.agent.usingTool(toolLabel(tool)) : C.agent.thinking}
        </p>
      ) : ended && ended.reason !== "done" ? (
        <p
          className="zz-agent__status"
          role="status"
          data-testid="agent-ended"
          data-reason={ended.reason}
          data-tone={ended.reason === "cancelled" ? "neutral" : "bad"}
        >
          {ended.reason === "cancelled" ? C.agent.stopped : (ended.message ?? C.agent.failed)}
        </p>
      ) : null}
      {!ready ? (
        <p className="zz-agent__status" role="status" data-tone="warn">
          {C.agent.noModel}{" "}
          <button type="button" className="zz-link" onClick={() => openSettings("models")}>
            {C.agent.openModels}
          </button>
        </p>
      ) : null}
      {chatting ? (
        <div className="zz-agent__quick">
          {quick.map((q) => (
            <button
              key={q.id}
              type="button"
              className="zz-chip"
              data-testid={`agent-quick-${q.id}`}
              disabled={busy || !ready}
              onClick={() => void send(q.text, q.intent)}
            >
              {q.label}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="zz-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {where ? (
          <span className="zz-composer__where" data-testid="agent-where">
            {C.agent.where(where)}
          </span>
        ) : null}
        <textarea
          ref={input}
          className="zz-composer__input"
          data-testid="agent-input"
          aria-label={C.agent.input}
          placeholder={C.agent.placeholder}
          value={draft}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="zz-composer__foot">
          <span className="zz-composer__hint">{C.agent.sendHint}</span>
          {busy ? (
            <Button
              size="sm"
              variant="danger"
              data-testid="agent-stop"
              onClick={() => stopAssistant().catch(notifyError)}
            >
              <Square size={12} aria-hidden="true" fill="currentColor" />
              {C.agent.stop}
            </Button>
          ) : (
            <Button
              size="sm"
              type="submit"
              variant="primary"
              data-testid="agent-send"
              disabled={!draft.trim() || !ready}
            >
              <ArrowUp size={14} aria-hidden="true" />
              {C.agent.send}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
