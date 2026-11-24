import React, { Suspense, lazy } from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Sparkles, Wrench } from "lucide-react";
import { Button } from "@zhizhang/ui/primitives";
import type { ChatMessage, ResultCard, ToolCallView } from "../../../shared/types";
import { toolLabel } from "../../../context";
import { openPipeline, select } from "../../state/controller";
import { desktop } from "../../state/desktop";
import { run } from "../../format";

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
      <Button size="sm" data-testid="agent-result-open" onClick={() => openResult(card)}>
        {card.kind === "compare" ? C.agent.openCompare : C.agent.open}
      </Button>
    </div>
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

const MessageItem = React.memo(function MessageItem({ message }: { message: ChatMessage }) {
  const tools = message.tools ?? [];
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
      {message.result ? <ResultButton card={message.result} /> : null}
    </li>
  );
});

export function AgentMessages({
  messages,
  stream,
  thinkingStream = "",
}: {
  messages: ChatMessage[];
  stream: string;
  thinkingStream?: string;
}) {
  return (
    <ol className="zz-messages" data-testid="agent-messages" aria-label={C.agent.log}>
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
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
