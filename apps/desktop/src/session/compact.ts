/**
 * 会话上下文压缩：保留最近 keepRecentTokens 内的完整对话，将更早轮次压缩为摘要消息。
 */
import type { Clock } from "@zhizhang/core/clock";
import type { ModelGateway } from "@zhizhang/core/model";
import type { SessionEvent } from "../shared/events.js";
import type { ContextSettings } from "../shared/settings.js";
import type { CompactResult } from "../shared/views.js";
import type { ConversationStore } from "./history.js";
import { contextTokens, messageTokens } from "./projection.js";
import { COMPACT_SYSTEM } from "./prompt.js";
import type { AssistantPort, ConversationFile } from "./types.js";

export interface CompactBinding {
  connection: string;
  model: string;
  maxTokens: number;
}

export interface CompactCtx {
  clock: Clock;
  store: ConversationStore;
  gateway(): ModelGateway;
  port(): AssistantPort;
  binding(): CompactBinding;
  context(): ContextSettings;
  nextId(prefix: string): string;
  emit(event: SessionEvent): void;
}

export async function compactConversation(
  ctx: CompactCtx,
  conversation: ConversationFile,
  scope: string,
  system: string,
  instructions?: string,
  signal?: AbortSignal,
): Promise<CompactResult> {
  const binding = ctx.binding();
  const messages = conversation.messages;
  const tokensBefore = contextTokens(system, messages);
  const keepBudget = ctx.context().keepRecentTokens;
  let keepFrom = messages.length;
  let kept = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    kept += messageTokens(messages[i]);
    if (kept > keepBudget) break;
    if (messages[i].role === "user") keepFrom = i;
  }
  const older = messages.slice(0, keepFrom);
  if (older.length === 0) {
    return { tokensBefore, tokensAfter: tokensBefore, summary: "" };
  }
  const transcript = older
    .map((msg) => {
      if (msg.role === "user") return `作者：${msg.text}`;
      if (msg.role === "assistant") return `助手：${msg.text}`;
      if (msg.role === "summary") return `此前摘要：${msg.text}`;
      return `工具 ${msg.name}：${msg.text.slice(0, 400)}`;
    })
    .join("\n");
  const controller = new AbortController();
  const activeSignal = signal ?? controller.signal;
  const answer = await ctx.gateway().session(
    "assistant",
    () =>
      ctx.port().turn(
        {
          connection: binding.connection,
          model: binding.model,
          system: COMPACT_SYSTEM,
          messages: [
            {
              role: "user",
              id: ctx.nextId("u"),
              at: ctx.clock.now(),
              text: [instructions?.trim() ? `压缩要求：${instructions.trim()}` : "", transcript]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
          tools: [],
          maxOutput: Math.min(2048, binding.maxTokens),
        },
        activeSignal,
        () => undefined,
      ),
    { scope, signal: activeSignal },
  );
  const summary = answer.text.trim();
  const replaced = older.length;
  conversation.messages = [
    { role: "summary", id: ctx.nextId("s"), text: summary, at: ctx.clock.now(), replaced },
    ...messages.slice(keepFrom),
  ];
  conversation.updated = ctx.clock.iso();
  await ctx.store.save(conversation);
  const tokensAfter = contextTokens(system, conversation.messages);
  ctx.emit({ type: "compacted", tokensBefore, tokensAfter });
  return { tokensBefore, tokensAfter, summary };
}
