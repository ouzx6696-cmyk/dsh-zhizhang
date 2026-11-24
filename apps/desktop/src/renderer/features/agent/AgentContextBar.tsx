import React, { useEffect } from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button } from "@zhizhang/ui/primitives";
import { useChat } from "../../state/chatStore";
import { compactConversation, refreshUsage } from "../../state/controller";
import { run } from "../../format";

/** 右栏助手上下文占用轨：展示窗口占比、PI Prompt Caching 命中数与手动整理入口。 */
export function AgentContextBar() {
  const usage = useChat((c) => c.usage);
  const busy = useChat((c) => c.busy);
  const conversationId = useChat((c) => c.conversationId);
  const cachedTokens = useChat((c) => c.task?.cachedTokens ?? 0);

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
      {cachedTokens > 0 ? (
        <span className="zz-context__cache" data-testid="agent-cache-hit">
          {C.agent.cacheHit(cachedTokens)}
        </span>
      ) : null}
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
