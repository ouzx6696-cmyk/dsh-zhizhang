import React, { Suspense, lazy } from "react";
import { ArrowRight, BookOpen, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button } from "@zhizhang/ui/primitives";
import type { ChatMessage, ResultCard, ToolCallView } from "../../../shared/types";
import { toolLabel } from "../../../context";
import { openPipeline, select } from "../../state/controller";
import { desktop } from "../../state/desktop";
import { desktopStore, useDesktop } from "../../state/store";
import { run } from "../../format";

interface ChapterLike {
  readonly id: string;
  readonly title: string;
}

// Markdown 渲染（react-markdown + gfm + sanitize）按需加载，不进入口包。
const Markdown = lazy(() => import("@zhizhang/ui/markdown").then((m) => ({ default: m.Markdown })));

function Rich({ text, onLink }: { text: string; onLink?: (href: string) => void }) {
  return (
    <Suspense fallback={<p className="zz-message__text">{text}</p>}>
      <Markdown text={text} onLink={onLink} />
    </Suspense>
  );
}

function openResult(card: ResultCard): void {
  run(async () => {
    await select(card.target, card.focus ?? {});
    if (card.kind === "run" || card.kind === "compare") openPipeline(card.focus?.chapter ?? "");
  });
}

function ResultButton({ card }: { card: ResultCard }) {
  return (
    <div className="zz-result-card" data-testid="agent-result" data-kind={card.kind}>
      <span className="zz-result-card__label">{C.agent.result[card.kind]}</span>
      <Button
        size="xs"
        variant="soft"
        data-testid="agent-result-open"
        onClick={() => openResult(card)}
      >
        {card.kind === "compare" ? C.agent.openCompare : C.agent.open}
      </Button>
    </div>
  );
}

interface CitationMatch {
  chapter: ChapterLike;
  ordinal: number;
  excerpt: string;
}

/** 从助手回答中识别章节引用与引文片段，渲染柔和纸面原文引用卡。 */
function extractCitation(text: string, chapters: readonly ChapterLike[]): CitationMatch | null {
  if (!chapters.length || !text) return null;
  let chapterIndex = -1;
  const numMatch = /\bch-0*(\d+)\b/i.exec(text) ?? /第\s*(\d+)\s*章/.exec(text);
  if (numMatch) {
    const n = Number(numMatch[1]);
    if (n >= 1 && n <= chapters.length) chapterIndex = n - 1;
  }
  if (chapterIndex < 0) {
    chapterIndex = chapters.findIndex(
      (ch) => ch.title && ch.title.length >= 2 && text.includes(ch.title),
    );
  }
  if (chapterIndex < 0) return null;
  const quoteMatch = /[「“]([^」”]{10,120})[」”]/.exec(text);
  return {
    chapter: chapters[chapterIndex],
    ordinal: chapterIndex + 1,
    excerpt: quoteMatch ? quoteMatch[1] : "",
  };
}

function CitationCard({
  match,
  onContinuityAudit,
}: {
  match: CitationMatch;
  onContinuityAudit?: () => void;
}) {
  const refLabel = C.workflow.chapterRef(
    match.ordinal,
    match.chapter.title !== match.chapter.id ? match.chapter.title : "",
  );
  return (
    <aside className="zz-cite-card" data-testid="agent-citation">
      <header className="zz-cite-card__head">
        <BookOpen size={12} aria-hidden="true" />
        <span>{refLabel}</span>
      </header>
      {match.excerpt ? (
        <blockquote className="zz-cite-card__quote">{match.excerpt}</blockquote>
      ) : null}
      <div className="zz-cite-card__actions">
        <button
          type="button"
          className="zz-cite-card__link"
          onClick={() => desktopStore.set({ view: "writing", jumpChapterId: match.chapter.id })}
        >
          {C.rail.locateSource}
          <ArrowRight size={12} aria-hidden="true" />
        </button>
        {onContinuityAudit ? (
          <button type="button" className="zz-cite-card__link" onClick={onContinuityAudit}>
            <ShieldCheck size={12} aria-hidden="true" />
            {C.rail.runContinuityAudit}
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function ThinkingBlock({ text, live = false }: { text: string; live?: boolean }) {
  return (
    <details className="zz-thinking" open={live} data-testid="agent-thinking" data-live={live}>
      <summary className="zz-thinking__summary">
        <Sparkles size={12} aria-hidden="true" />
        <span>{live ? C.agent.thinkingLive : C.agent.thinkingProcess}</span>
      </summary>
      <p className="zz-thinking__body">{text}</p>
    </details>
  );
}

function ToolEvidence({ tools }: { tools: readonly ToolCallView[] }) {
  return (
    <details className="zz-tool-evidence" data-testid="agent-tools">
      <summary className="zz-message__tools">
        <Wrench size={12} aria-hidden="true" />
        <span>{C.cowriter.toolEvidence(tools.length)}</span>
      </summary>
      <ul className="zz-tool-evidence__list">
        {tools.map((t, index) => (
          <li key={`${t.name}-${index}`} data-error={Boolean(t.isError)}>
            <strong>
              {toolLabel(t.name)}
              {t.isError ? C.agent.toolFailed : ""}
            </strong>
            {t.summary ? <span className="zz-muted">{t.summary}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

const MessageItem = React.memo(function MessageItem({
  message,
  chapters,
  onContinuityAudit,
}: {
  message: ChatMessage;
  chapters: readonly ChapterLike[];
  onContinuityAudit?: () => void;
}) {
  const tools = message.tools ?? [];
  const citation =
    message.role === "assistant" && message.text ? extractCitation(message.text, chapters) : null;
  return (
    <li className="zz-message" data-testid="agent-message" data-role={message.role}>
      {message.thinking ? <ThinkingBlock text={message.thinking} /> : null}
      {tools.length ? <ToolEvidence tools={tools} /> : null}
      {message.text ? (
        message.role === "assistant" || message.role === "system" ? (
          <Rich text={message.text} onLink={(href) => run(() => desktop.openExternal(href))} />
        ) : (
          <p className="zz-message__text">{message.text}</p>
        )
      ) : null}
      {citation ? <CitationCard match={citation} onContinuityAudit={onContinuityAudit} /> : null}
      {message.result ? <ResultButton card={message.result} /> : null}
    </li>
  );
});

export function AgentMessages({
  messages,
  stream,
  thinkingStream = "",
  onContinuityAudit,
}: {
  messages: ChatMessage[];
  stream: string;
  thinkingStream?: string;
  onContinuityAudit?: () => void;
}) {
  const chapters = useDesktop((s) => s.chapters);
  return (
    <ol className="zz-messages" data-testid="agent-messages" aria-label={C.agent.log}>
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          chapters={chapters}
          onContinuityAudit={onContinuityAudit}
        />
      ))}
      {stream || thinkingStream ? (
        <li className="zz-message" data-role="assistant" data-testid="agent-stream">
          {thinkingStream ? <ThinkingBlock text={thinkingStream} live /> : null}
          {stream ? <Rich text={stream} /> : null}
        </li>
      ) : null}
    </ol>
  );
}
