import React from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Markdown } from "@zhizhang/ui/markdown";
import { Button } from "@zhizhang/ui/primitives";
import type { ChatMessage, ResultCard } from "../../../shared/types";
import { toolLabel } from "../../../context";
import { openPipeline, select } from "../../state/controller";
import { desktop } from "../../state/desktop";
import { run } from "../../format";

function openResult(card: ResultCard): void {
  run(async () => {
    await select(card.target, card.focus ?? {});
    if (card.kind === "run" || card.kind === "compare") openPipeline(card.focus?.chapter ?? "");
  });
}

function ResultButton({ card }: { card: ResultCard }) {
  return (
    <div className="zz-result-card" data-testid="agent-result" data-kind={card.kind}>
      <span>{C.agent.result[card.kind]}</span>
      <Button size="sm" data-testid="agent-result-open" onClick={() => openResult(card)}>
        {card.kind === "compare" ? C.agent.openCompare : C.agent.open}
      </Button>
    </div>
  );
}

const MessageItem = React.memo(function MessageItem({ message }: { message: ChatMessage }) {
  const tools = message.tools ?? [];
  return (
    <li className="zz-message" data-testid="agent-message" data-role={message.role}>
      {tools.length ? (
        <p className="zz-message__tools" data-testid="agent-tools">
          {C.agent.usedTools(
            tools.map((t) => toolLabel(t.name) + (t.isError ? C.agent.toolFailed : "")).join("、"),
          )}
        </p>
      ) : null}
      {message.text ? (
        message.role === "assistant" ? (
          <Markdown text={message.text} onLink={(href) => run(() => desktop.openExternal(href))} />
        ) : (
          <p className="zz-message__text">{message.text}</p>
        )
      ) : null}
      {message.result ? <ResultButton card={message.result} /> : null}
    </li>
  );
});

export function AgentMessages({ messages, stream }: { messages: ChatMessage[]; stream: string }) {
  return (
    <ol className="zz-messages" data-testid="agent-messages" aria-label={C.agent.log}>
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      {stream ? (
        <li className="zz-message" data-role="assistant" data-testid="agent-stream">
          <Markdown text={stream} />
        </li>
      ) : null}
    </ol>
  );
}
