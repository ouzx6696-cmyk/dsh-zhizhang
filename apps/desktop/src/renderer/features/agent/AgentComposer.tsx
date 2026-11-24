import React, { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, AtSign, ClipboardList, Square, X } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button } from "@zhizhang/ui/primitives";
import type { ContextMention, Focus, Target } from "../../../shared/views";
import { stopAssistant } from "../../state/controller";
import { desktopStore } from "../../state/store";
import { notifyError } from "../../format";

const INPUT_MAX_HEIGHT = 200;

interface AgentComposerProps {
  target: Target;
  focus: Focus;
  chapters: readonly { id: string; title: string }[];
  draft: string;
  busy: boolean;
  ready: boolean;
  where: string;
  onDraftChange(value: string): void;
  onSubmit(): void;
  onToggleBrief(): void;
}

/** 右栏助手输入区：支持划词选区挂载、@ 引用章节、结构化任务单入口与停止按钮。 */
export function AgentComposer({
  target,
  focus,
  chapters,
  draft,
  busy,
  ready,
  where,
  onDraftChange,
  onSubmit,
  onToggleBrief,
}: AgentComposerProps) {
  const [mentionOpen, setMentionOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  }, [draft]);

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

  return (
    <form
      className="zz-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
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
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit();
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
                onClick={onToggleBrief}
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
  );
}
