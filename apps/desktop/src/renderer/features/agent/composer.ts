import { useCallback, useEffect, useRef, useState } from "react";
import { AGENT_COPY, formatCost, formatTokens } from "../../../../../../packages/ui/src/copy.js";
import {
  PREF,
  readPref,
  writePref,
} from "../../../../../../packages/workbench/src/client/shared/prefs.js";
import { promptContext } from "../../../context";
import type { ChatMessage } from "../../state/store";
import type { TaskState } from "../../../renderer-contracts";
import { messageBody } from "./AgentMessages";

type FooterState = {
  archived: boolean;
  readOnly: boolean;
  hasWork: boolean;
  model: { configured: boolean; model: string };
  busy: boolean;
  task: TaskState | null;
};

/** 页脚状态：第一条给出文字的规则生效，告诉作者现在能不能发、在做什么、花了多少。 */
const FOOTER_STATUS: readonly ((state: FooterState) => string | false)[] = [
  (s) => s.archived && AGENT_COPY.statusArchive,
  (s) => s.readOnly && AGENT_COPY.statusReadOnly,
  (s) => !s.hasWork && AGENT_COPY.statusNoWork,
  (s) => !s.model.configured && AGENT_COPY.statusNoModel,
  ({ busy, task }) =>
    task?.usage !== undefined &&
    (busy ? AGENT_COPY.statusRunning : AGENT_COPY.statusLast) +
      formatTokens(task.usage) +
      " · " +
      formatCost(task.cost > 0 ? task.cost : null),
  (s) => s.busy && AGENT_COPY.statusRunning + s.model.model,
];

export function footerStatus(state: FooterState) {
  for (const rule of FOOTER_STATUS) {
    const text = rule(state);
    if (text) return text;
  }
  return AGENT_COPY.statusReady + state.model.model;
}

type QueuedMessage = { id: number; text: string; after: ChatMessage | undefined };

/** 已出现在对话里的排队消息不再显示为排队：只认排队之后新加入、文字相同的作者消息。 */
function pendingQueue(queued: QueuedMessage[], messages: ChatMessage[]) {
  const consumed = new Set<number>();
  return queued.filter((item) => {
    const start = item.after ? messages.indexOf(item.after) + 1 : 0;
    const index = messages.findIndex(
      (message, position) =>
        position >= start &&
        !consumed.has(position) &&
        message.role === "user" &&
        promptContext(messageBody(message)).text.trim() === item.text.trim(),
    );
    if (index < 0) return true;
    consumed.add(index);
    return false;
  });
}

/** 每个作品一份输入草稿，存进 prefs，重启后仍在。 */
export function useDraft(draftKey: string) {
  const [draft, updateDraft] = useState(() => readPref(PREF.agentDraft + draftKey));
  useEffect(() => updateDraft(readPref(PREF.agentDraft + draftKey)), [draftKey]);
  const setDraft = useCallback(
    (value: string | ((current: string) => string)) => {
      updateDraft((current) => {
        const next = typeof value === "function" ? value(current) : value;
        if (draftKey) writePref(PREF.agentDraft + draftKey, next);
        return next;
      });
    },
    [draftKey],
  );
  return [draft, setDraft] as const;
}

/** 忙时发送的消息由 PI 排在当前任务之后；这里只做可见提示，PI 没有开放撤回接口。 */
export function useQueue(draftKey: string, busy: boolean, messages: ChatMessage[]) {
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const nextId = useRef(0);
  useEffect(() => setQueued([]), [draftKey]);
  useEffect(() => {
    if (!busy) setQueued([]);
  }, [busy]);
  const visible = pendingQueue(queued, messages);
  const enqueue = (text: string) =>
    setQueued((current) => [...current, { id: ++nextId.current, text, after: messages.at(-1) }]);
  return [visible, enqueue] as const;
}
