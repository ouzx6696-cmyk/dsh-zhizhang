import React, { useEffect, useMemo } from "react";
import { ArrowRight, Feather } from "lucide-react";
import { Markdown } from "../../../Markdown";
import { actionTitle, humanVersion } from "../../format";
import { promptContext, toolLabel, type Focus, type Target } from "../../../context";
import { writerResult } from "../../../writer-result";
import type { ChatMessage } from "../../state/store";
import { useChatSelector } from "../../state/chatStore";
import { COPY as viewCopy, t as viewText } from "../../../../../../packages/ui/src/copy.js";

function messageBody(message: ChatMessage) {
  return typeof message.content === "string"
    ? message.content
    : (message.content || [])
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
}

export function ChatStream({
  hasMessages,
  listRef,
  stickToBottom,
}: {
  hasMessages: boolean;
  listRef: React.RefObject<HTMLDivElement | null>;
  stickToBottom: React.MutableRefObject<boolean>;
}) {
  const stream = useChatSelector((chat) => chat.stream);
  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [stream, listRef, stickToBottom]);
  if (stream)
    return (
      <article className="chat-message assistant">
        <small>Agent</small>
        <Markdown text={stream} />
      </article>
    );
  if (hasMessages) return null;
  return (
    <div className="chat-empty">
      <Feather size={24} />
      <p>{viewCopy.agentPanelText1}</p>
    </div>
  );
}

/** 候选编号按「作品 + 章节」独立计数，供结果卡显示第几版。 */
function candidateNumbers(messages: ChatMessage[]) {
  const numbers = new Map<number, number>();
  const chapterCounts = new Map<string, number>();
  messages.forEach((message, index) => {
    const result = message.role === "toolResult" ? writerResult(message) : null;
    if (result?.kind !== "candidate") return;
    const key = [result.target?.root, result.target?.work, result.focus?.chapter].join("|");
    const number = (chapterCounts.get(key) || 0) + 1;
    chapterCounts.set(key, number);
    numbers.set(index, number);
  });
  return numbers;
}

type JumpHandler = (target: Target | null, nextFocus?: Focus) => void;

function resultCard(
  result: import("../../../renderer-contracts").WriterResult,
  candidateNumber: number | undefined,
  onJump: JumpHandler,
) {
  const title =
    result.kind === "candidate"
      ? result.draftLabel
        ? viewText("agentPanelText22", { value0: result.draftLabel })
        : viewText("agentPanelText23", { value0: candidateNumber ? " " + candidateNumber : "" })
      : (
          {
            review: viewCopy.agentPanelText24,
            qa: viewCopy.agentPanelText25,
            delivery: viewCopy.ttViewDelivery,
            planning: viewCopy.agentPanelText26,
          } as Record<string, string>
        )[result.kind] || viewCopy.agentPanelText27;
  return (
    <div className={"result-card " + (result.failed ? "failed" : "")} data-kind={result.kind || "review"}>
      <strong>{title}</strong>
      <p>{result.summary}</p>
      <button onClick={() => onJump(result.target, result.focus)}>
        {viewCopy.agentPanelText28}
        <ArrowRight size={14} />
      </button>
    </div>
  );
}

function renderMessage(
  message: ChatMessage,
  index: number,
  numbers: Map<number, number>,
  onJump: JumpHandler,
) {
  const original = messageBody(message);
  if (!original) return null;
  if (message.role === "custom" && message.display === false) return null;
  if (message.role === "toolResult") {
    const result = writerResult(message);
    if (result) return <div key={index}>{resultCard(result, numbers.get(index), onJump)}</div>;
    if (message.isError)
      return (
        <div className="result-card failed" key={index} role="alert">
          <strong>
            {toolLabel(message.toolName || "")}
            {viewCopy.agentPanelText29}
          </strong>
          <Markdown text={original} />
        </div>
      );
    return (
      <div className="tool-action" key={index}>
        {toolLabel(message.toolName || "")}
      </div>
    );
  }
  const parsed =
    message.role === "user" ? promptContext(original) : { text: original, context: null };
  if (message.role === "user" && parsed.text.startsWith(viewCopy.agentPanelText30)) {
    return (
      <article className="chat-message user action-capsule" key={index}>
        <small>{viewCopy.agentPanelText31}</small>
        <details>
          <summary>
            <span>{actionTitle(parsed.text) || viewCopy.agentPanelText32}</span>
            <span className="action-capsule-more">{viewCopy.agentPanelText33}</span>
          </summary>
          <div className="action-capsule-body">
            <Markdown text={parsed.text} />
          </div>
        </details>
      </article>
    );
  }
  return (
    <article className={"chat-message " + message.role} key={index}>
      <small>
        {message.role === "user"
          ? viewCopy.agentPanelText34
          : message.role === "custom"
            ? viewCopy.agentPanelText35
            : "Agent"}
        {parsed.context?.focus?.title ? " · " + parsed.context.focus.title : ""}
        {parsed.context?.focus?.revision
          ? " · " + humanVersion(parsed.context.focus.revision)
          : ""}
      </small>
      <Markdown text={parsed.text} />
    </article>
  );
}

export function AgentMessageList({
  messages,
  onJump,
}: {
  messages: ChatMessage[];
  onJump: JumpHandler;
}) {
  const numbers = useMemo(() => candidateNumbers(messages), [messages]);
  return <>{messages.map((message, index) => renderMessage(message, index, numbers, onJump))}</>;
}
