import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Feather } from "lucide-react";
import { Markdown } from "../../../Markdown";
import { actionTitle, humanVersion } from "../../format";
import { promptContext, toolLabel, type Focus, type Target } from "../../../context";
import { writerResult } from "../../../writer-result";
import type { ChatMessage } from "../../state/store";
import { chatStore, useChatSelector } from "../../state/chatStore";
import {
  COPY as viewCopy,
  t as viewText,
  AGENT_COPY,
} from "../../../../../../packages/ui/src/copy.js";

// 会话里除作者与作者操作外的条目都由写作助手产生。
const ROLE_LABEL: Record<string, string> = {
  user: viewCopy.agentPanelText34,
  custom: viewCopy.agentPanelText35,
};
// 读屏只需要知道回复到了什么，不必听完整段；长回复截断后可在对话记录里细读。
const ANNOUNCE_LIMIT = 240;

export function messageBody(message: ChatMessage) {
  return typeof message.content === "string"
    ? message.content
    : (message.content || [])
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
}

/**
 * 按空行切分流式文本（代码围栏内不切）。已闭合的段落交给 memo 的 Markdown 跳过重解析，
 * 只有尾段逐帧解析；message_end 后正式消息整体替换，跨段的细微差异只是暂时的。
 */
function streamBlocks(text: string) {
  const blocks: string[] = [];
  let start = 0,
    fenced = false;
  for (const match of text.matchAll(/^```|\n{2,}/gm)) {
    if (match[0] === "```") fenced = !fenced;
    else if (!fenced) {
      blocks.push(text.slice(start, match.index));
      start = match.index + match[0].length;
    }
  }
  blocks.push(text.slice(start));
  return blocks;
}

/** 流式结束时把最终回复交给读屏宣告一次，流式过程本身不进 live region，避免逐字朗读。 */
function useReplyAnnouncement(stream: string) {
  const [announcement, setAnnouncement] = useState("");
  const streamed = useRef(false);
  useEffect(() => {
    if (stream) {
      streamed.current = true;
      return;
    }
    if (!streamed.current) return;
    streamed.current = false;
    const last = chatStore.get().messages.findLast((message) => message.role === "assistant");
    const text = last ? messageBody(last) : "";
    if (text) setAnnouncement(AGENT_COPY.replied + text.slice(0, ANNOUNCE_LIMIT));
  }, [stream]);
  return announcement;
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
  const announcement = useReplyAnnouncement(stream);
  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [stream, listRef, stickToBottom]);
  return (
    <>
      <div className="agent-sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      {stream ? (
        <article className="chat-message assistant streaming" aria-busy="true">
          <small className="chat-message-role">
            {AGENT_COPY.roleAssistant}
            <span className="chat-message-typing" aria-hidden="true" />
          </small>
          {streamBlocks(stream).map((block, index) => (
            // 段落只在末尾追加，下标即稳定身份。
            <Markdown key={index} text={block} />
          ))}
        </article>
      ) : (
        !hasMessages && (
          <div className="chat-empty">
            <Feather size={24} aria-hidden="true" />
            <p>{viewCopy.agentPanelText1}</p>
          </div>
        )
      )}
    </>
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
    <div
      className={"result-card" + (result.failed ? " failed" : "")}
      data-kind={result.kind || "review"}
    >
      <strong>{title}</strong>
      <p>{result.summary}</p>
      <button onClick={() => onJump(result.target, result.focus)}>
        {viewCopy.agentPanelText28}
        <ArrowRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** 单条消息只随自身内容、候选编号或跳转处理变化重渲染；流式更新不再重排整段历史。 */
const MessageView = React.memo(function MessageView({
  message,
  candidateNumber,
  onJump,
}: {
  message: ChatMessage;
  candidateNumber: number | undefined;
  onJump: JumpHandler;
}) {
  const original = messageBody(message);
  if (!original) return null;
  if (message.role === "custom" && message.display === false) return null;
  if (message.role === "toolResult") {
    const result = writerResult(message);
    if (result)
      return <div className="chat-result">{resultCard(result, candidateNumber, onJump)}</div>;
    if (message.isError)
      return (
        <div className="chat-result">
          <div className="result-card failed" role="alert">
            <strong>
              {toolLabel(message.toolName || "")}
              {viewCopy.agentPanelText29}
            </strong>
            <Markdown text={original} />
          </div>
        </div>
      );
    return <div className="tool-action">{toolLabel(message.toolName || "")}</div>;
  }
  const parsed =
    message.role === "user" ? promptContext(original) : { text: original, context: null };
  if (message.role === "user" && parsed.text.startsWith(viewCopy.agentPanelText30)) {
    return (
      <article className="chat-message user action-capsule">
        <small className="chat-message-role">{viewCopy.agentPanelText31}</small>
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
    <article className={"chat-message " + message.role}>
      <small className="chat-message-role">
        {ROLE_LABEL[message.role] ?? AGENT_COPY.roleAssistant}
        {parsed.context?.focus?.title ? " · " + parsed.context.focus.title : ""}
        {parsed.context?.focus?.revision ? " · " + humanVersion(parsed.context.focus.revision) : ""}
      </small>
      <Markdown text={parsed.text} />
    </article>
  );
});

export function AgentMessageList({
  messages,
  onJump,
}: {
  messages: ChatMessage[];
  onJump: JumpHandler;
}) {
  const numbers = useMemo(() => candidateNumbers(messages), [messages]);
  // 历史按条数截断时下标会整体平移；用会话条目 ID 作 key，展开状态才跟着原消息走。
  return (
    <>
      {messages.map((message, index) => (
        <MessageView
          key={message.writerMessageId ? "m:" + message.writerMessageId : "i:" + index}
          message={message}
          candidateNumber={numbers.get(index)}
          onJump={onJump}
        />
      ))}
    </>
  );
}
