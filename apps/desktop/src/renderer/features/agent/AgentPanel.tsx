import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plus, Send, Square } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, Empty, IconButton, Select } from "@zhizhang/ui/primitives";
import { readPref, writePref, PREF } from "@zhizhang/workbench/client";
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
        { id: "continue", label: C.agent.quick.continue, text: C.agent.quick.continueText, intent: "continue" },
        { id: "check", label: C.agent.quick.check, text: C.agent.quick.checkText, intent: "check" },
        { id: "plan", label: C.agent.quick.plan, text: C.agent.quick.planText, intent: "plan" },
      ]
    : [
        { id: "review", label: C.agent.quick.review, text: C.agent.quick.reviewText, intent: "review" },
        { id: "check", label: C.agent.quick.check, text: C.agent.quick.checkText, intent: "check" },
      ];
}

/** 输入草稿按作用目标暂存，切换作品后回来不丢。 */
function useDraft(scope: string): [string, (value: string) => void] {
  const key = PREF.agentDraft + scope;
  const [draft, setDraft] = useState(() => readPref(key));
  useEffect(() => setDraft(readPref(key)), [key]);
  return [
    draft,
    (value: string) => {
      setDraft(value);
      writePref(key, value);
    },
  ];
}

function ContextBar() {
  const usage = useChat((c) => c.usage);
  const busy = useChat((c) => c.busy);
  const conversationId = useChat((c) => c.conversationId);
  useEffect(() => {
    if (!busy) refreshUsage().catch(() => undefined);
  }, [busy, conversationId]);
  if (!usage) return null;
  return (
    <div className="zz-context" data-testid="agent-context" data-percent={usage.percent}>
      <div className="zz-context__rail" role="meter" aria-label={C.agent.context} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage.percent}>
        <span style={{ width: `${Math.min(100, usage.percent)}%` }} />
      </div>
      <span className="zz-muted">{C.agent.contextUsage(usage.percent)}</span>
      <Button size="sm" variant="ghost" data-testid="agent-compact" disabled={busy || usage.messages === 0} onClick={() => run(compactConversation)}>
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

  const where = [focus.workTitle, focus.title || focus.chapter || focus.article].filter(Boolean).join(" · ");
  return (
    <div className="zz-agent" data-testid="agent-panel">
      <header className="zz-agent__head">
        <Select
          label={C.agent.conversations}
          testId="agent-conversations"
          value={conversationId}
          disabled={busy || conversations.length === 0}
          options={(conversations.length ? conversations : [{ id: conversationId, title: "", updated: "", messages: 0, current: true }]).map((c) => ({
            value: c.id,
            label: c.title || C.agent.untitled,
          }))}
          onChange={(id) => run(() => openConversation(id))}
        />
        <IconButton label={C.agent.newConversation} data-testid="agent-new-conversation" disabled={busy} icon={<Plus size={15} />} onClick={() => run(newConversation)} />
      </header>
      <ContextBar />
      <div className="zz-agent__list" ref={list}>
        {messages.length || stream ? (
          <AgentMessages messages={messages} stream={stream} />
        ) : (
          <Empty title={C.agent.emptyTitle} description={C.agent.emptyHint} />
        )}
      </div>
      {busy ? (
        <p className="zz-agent__status" role="status" data-testid="agent-busy">
          {tool ? C.agent.usingTool(toolLabel(tool)) : C.agent.thinking}
        </p>
      ) : ended && ended.reason !== "done" ? (
        <p className="zz-agent__status" role="status" data-testid="agent-ended" data-reason={ended.reason}>
          {ended.reason === "cancelled" ? C.agent.stopped : (ended.message ?? C.agent.failed)}
        </p>
      ) : null}
      {!ready ? (
        <p className="zz-agent__status" role="status">
          {C.agent.noModel}{" "}
          <button type="button" className="zz-link" onClick={() => openSettings("models")}>
            {C.agent.openModels}
          </button>
        </p>
      ) : null}
      <div className="zz-agent__quick">
        {quickActions(target.mode).map((q) => (
          <Button key={q.id} size="sm" variant="ghost" data-testid={`agent-quick-${q.id}`} disabled={busy || !ready} onClick={() => void send(q.text, q.intent)}>
            {q.label}
          </Button>
        ))}
      </div>
      <form
        className="zz-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void send(draft);
        }}
      >
        {where ? <span className="zz-composer__where" data-testid="agent-where">{where}</span> : null}
        <textarea
          ref={input}
          className="zz-input zz-composer__input"
          data-testid="agent-input"
          aria-label={C.agent.input}
          placeholder={C.agent.placeholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!busy) void send(draft);
            }
          }}
        />
        {busy ? (
          <Button data-testid="agent-stop" onClick={() => stopAssistant().catch(notifyError)}>
            <Square size={14} aria-hidden="true" />
            {C.agent.stop}
          </Button>
        ) : (
          <Button type="submit" variant="primary" data-testid="agent-send" disabled={!draft.trim() || !ready}>
            <Send size={14} aria-hidden="true" />
            {C.agent.send}
          </Button>
        )}
      </form>
    </div>
  );
}

