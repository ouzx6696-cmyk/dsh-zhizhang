import React, { useEffect, useRef, useState } from "react";
import { ChevronRight, Eye, PenTool, Plus } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, IconButton, Select, Spinner } from "@zhizhang/ui/primitives";
import { readPref, writePref, PREF } from "@zhizhang/workbench/client";
import type { SessionIntent, Target } from "../../../shared/views";
import { toolLabel } from "../../../context";
import { useChat } from "../../state/chatStore";
import {
  modelReady,
  newConversation,
  openConversation,
  openPipeline,
  openSettings,
  sendMessage,
} from "../../state/controller";
import { sameTarget, scopeKey, useDesktop } from "../../state/store";
import { notifyError, run } from "../../format";
import { AgentComposer } from "./AgentComposer";
import { AgentContextBar } from "./AgentContextBar";
import { AgentMessages } from "./AgentMessages";
import { BriefDrawer } from "./BriefDrawer";

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

/** 柔和纸面 C2 右栏“只读助手”卡：只查阅，不改正文；支持原文引用卡与快速发起连续性复查。 */
export function AgentPanel({ target }: { target: Target }) {
  const messages = useChat((c) => c.messages);
  const stream = useChat((c) => c.stream);
  const thinkingStream = useChat((c) => c.thinkingStream);
  const busy = useChat((c) => c.busy);
  const tool = useChat((c) => c.tool);
  const ended = useChat((c) => c.ended);
  const conversations = useChat((c) => c.conversations);
  const conversationId = useChat((c) => c.conversationId);
  const settings = useDesktop((s) => s.settings);
  const focus = useDesktop((s) => s.focus);
  const chapters = useDesktop((s) => s.chapters);
  const runs = useDesktop((s) => s.runs);
  const dockSplit = useDesktop((s) => s.dockSplit);
  const readonly = useDesktop((s) => Boolean(s.workspace?.readonly));
  const [draft, setDraft] = useDraft(scopeKey(target));
  const [briefOpen, setBriefOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const ready = modelReady(settings);

  useEffect(() => {
    const box = list.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, stream, thinkingStream]);

  const send = async (text: string, intent?: SessionIntent) => {
    try {
      if ((await sendMessage(text, intent)) && !intent) setDraft("");
    } catch (error) {
      notifyError(error);
    }
  };

  const activeRun = runs.find((r) => sameTarget(r.target, target));
  const where = [focus.workTitle, focus.title || focus.chapter || focus.article]
    .filter(Boolean)
    .join(" / ");
  const quick = quickActions(target.mode);
  const chatting = messages.length > 0 || Boolean(stream) || Boolean(thinkingStream);
  const submit = () => {
    if (!busy && ready && draft.trim()) void send(draft);
  };

  return (
    <div className="zz-agent" data-testid="agent-panel">
      <header className="zz-agent__head">
        <div className="zz-agent__title-bar">
          <div className="zz-agent__title-group">
            <strong className="zz-agent__heading">{C.dock.assistantHead}</strong>
            <span className="zz-readonly-pill" data-testid="agent-readonly-tag">
              <Eye size={11} aria-hidden="true" />
              {C.rail.readonlyTag}
            </span>
          </div>
          <span className="zz-agent__readonly-hint">{C.rail.readonlyHint}</span>
        </div>
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
            size="xs"
            data-testid="agent-new-conversation"
            disabled={busy}
            icon={<Plus size={14} />}
            onClick={() => run(newConversation)}
          />
        </div>
        <AgentContextBar />
        {activeRun && !dockSplit ? (
          <div className="zz-live-strip" data-testid="agent-live-run" data-state={activeRun.state}>
            <span>
              <strong>{C.cowriter.livePipeline}</strong> ·{" "}
              {C.workflow.kind[activeRun.kind] ?? activeRun.kind}
              {activeRun.stages.length ? ` (${activeRun.stages.length})` : ""}
            </span>
            <Button size="xs" variant="ghost" onClick={() => openPipeline()}>
              {C.cowriter.openPipelineDetail}
            </Button>
          </div>
        ) : null}
      </header>
      <div className="zz-agent__list" ref={list}>
        {chatting ? (
          <AgentMessages
            messages={messages}
            stream={stream}
            thinkingStream={thinkingStream}
            onContinuityAudit={
              ready && !busy ? () => void send(C.cowriter.quickDiagnoseText, "diagnose") : undefined
            }
          />
        ) : (
          <section className="zz-agent__welcome" data-testid="agent-welcome">
            <span className="zz-agent__welcome-icon" aria-hidden="true">
              <PenTool size={15} />
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
      <AgentComposer
        target={target}
        focus={focus}
        chapters={chapters}
        draft={draft}
        busy={busy}
        ready={ready}
        where={where}
        onDraftChange={setDraft}
        onSubmit={submit}
        onToggleBrief={() => setBriefOpen((v) => !v)}
      />
    </div>
  );
}
