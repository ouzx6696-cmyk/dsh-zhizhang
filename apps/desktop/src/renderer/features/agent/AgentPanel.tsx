import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp,
  AtSign,
  ChevronRight,
  ClipboardList,
  PenTool,
  Plus,
  Square,
  X,
} from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, IconButton, Select, Spinner } from "@zhizhang/ui/primitives";
import { readPref, writePref, PREF } from "@zhizhang/workbench/client";
import type { ContextMention, SessionIntent, Target } from "../../../shared/views";
import { toolLabel } from "../../../context";
import { useChat } from "../../state/chatStore";
import {
  compactConversation,
  modelReady,
  newConversation,
  openConversation,
  openPipeline,
  openSettings,
  refreshUsage,
  sendMessage,
  stopAssistant,
} from "../../state/controller";
import { desktopStore, sameTarget, scopeKey, useDesktop } from "../../state/store";
import { notifyError, run } from "../../format";
import { AgentMessages } from "./AgentMessages";
import { BriefDrawer } from "./BriefDrawer";

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
          id: "beats",
          label: C.cowriter.quickBeats,
          text: C.cowriter.quickBeatsText,
          intent: "beats",
        },
        {
          id: "continue",
          label: C.agent.quick.continue,
          text: C.agent.quick.continueText,
          intent: "continue",
        },
        {
          id: "diagnose",
          label: C.cowriter.quickDiagnose,
          text: C.cowriter.quickDiagnoseText,
          intent: "diagnose",
        },
        { id: "plan", label: C.agent.quick.plan, text: C.agent.quick.planText, intent: "plan" },
      ]
    : [
        {
          id: "review",
          label: C.agent.quick.review,
          text: C.agent.quick.reviewText,
          intent: "review",
        },
        {
          id: "diagnose",
          label: C.cowriter.quickDiagnose,
          text: C.cowriter.quickDiagnoseText,
          intent: "diagnose",
        },
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

/** 右栏“共创写作助手”：嵌入进行中流水线速览、划词选区挂载、@ 引用与结构化任务单。 */
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
  const chapters = useDesktop((s) => s.chapters);
  const runs = useDesktop((s) => s.runs);
  const readonly = useDesktop((s) => Boolean(s.workspace?.readonly));
  const [draft, setDraft] = useDraft(scopeKey(target));
  const [mentionOpen, setMentionOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
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

  const addMention = (mention: ContextMention) => {
    const prev = desktopStore.get().focus;
    const existing = prev.mentions ?? [];
    if (existing.some((m) => m.kind === mention.kind && m.id === mention.id)) {
      setMentionOpen(false);
      return;
    }
    desktopStore.set({
      focus: { ...prev, mentions: [...existing.slice(-7), mention] },
    });
    setMentionOpen(false);
  };

  const removeMention = (mention: ContextMention) => {
    const prev = desktopStore.get().focus;
    const next = (prev.mentions ?? []).filter(
      (m) => !(m.kind === mention.kind && m.id === mention.id),
    );
    desktopStore.set({ focus: { ...prev, mentions: next.length ? next : undefined } });
  };

  const clearSelection = () => {
    const prev = desktopStore.get().focus;
    desktopStore.set({ focus: { ...prev, selection: undefined } });
  };

  const activeRun = runs.find((r) => sameTarget(r.target, target));
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
        {activeRun ? (
          <div className="zz-live-strip" data-testid="agent-live-run" data-state={activeRun.state}>
            <span>
              <strong>{C.cowriter.livePipeline}</strong> ·{" "}
              {C.workflow.kind[activeRun.kind] ?? activeRun.kind}
              {activeRun.stages.length ? ` (${activeRun.stages.length})` : ""}
            </span>
            <Button size="sm" variant="ghost" onClick={() => openPipeline()}>
              {C.cowriter.openPipelineDetail}
            </Button>
          </div>
        ) : null}
      </header>
      <div className="zz-agent__list" ref={list}>
        {messages.length || stream ? (
          <AgentMessages messages={messages} stream={stream} />
        ) : (
          <section className="zz-agent__welcome" data-testid="agent-welcome">
            <span className="zz-agent__welcome-icon" aria-hidden="true">
              <PenTool size={16} />
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
      {briefOpen && target.mode === "fanqie" ? (
        <BriefDrawer
          target={target}
          chapterId={focus.chapter || chapters[0]?.id || "ch-001"}
          initialKeep={focus.selection?.text}
          disabled={readonly || !ready}
          onClose={() => setBriefOpen(false)}
        />
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
        {focus.selection || (focus.mentions && focus.mentions.length > 0) ? (
          <div className="zz-composer__attachments">
            {focus.selection ? (
              <span className="zz-attach-tag" data-testid="agent-selection-chip">
                {C.selection.attached(focus.selection.text.length)}
                <button type="button" aria-label={C.selection.clear} onClick={clearSelection}>
                  <X size={11} />
                </button>
              </span>
            ) : null}
            {(focus.mentions ?? []).map((m) => (
              <span key={`${m.kind}:${m.id}`} className="zz-attach-tag">
                @{m.label || m.id}
                <button type="button" onClick={() => removeMention(m)}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {mentionOpen ? (
          <div className="zz-mention-popover" data-testid="agent-mention-popover">
            <strong>{C.cowriter.mentionTitle}</strong>
            {chapters.length ? (
              <ul>
                {chapters.slice(0, 12).map((ch) => (
                  <li key={ch.id}>
                    <button
                      type="button"
                      onClick={() =>
                        addMention({ kind: "chapter", id: ch.id, label: ch.title || ch.id })
                      }
                    >
                      {ch.id} {ch.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="zz-muted">{C.cowriter.mentionEmpty}</p>
            )}
          </div>
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
          <div className="zz-row">
            {target.mode === "fanqie" ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="agent-mention-btn"
                  onClick={() => setMentionOpen((v) => !v)}
                >
                  <AtSign size={13} aria-hidden="true" />
                  {C.cowriter.mentionBtn}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="agent-brief-btn"
                  onClick={() => setBriefOpen((v) => !v)}
                >
                  <ClipboardList size={13} aria-hidden="true" />
                  {C.cowriter.briefBtn}
                </Button>
              </>
            ) : (
              <span className="zz-composer__hint">{C.agent.sendHint}</span>
            )}
          </div>
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
