import { useEffect, useSyncExternalStore } from "react";

export type NoticeTone = "success" | "info" | "warning" | "danger";
export interface NoticeAction {
  label: string;
  run: () => unknown;
}
export interface NoticeInput {
  tone: NoticeTone;
  text: string;
  /** 折叠在详情里的长说明；不给时取 text 第一行之后的内容。 */
  detail?: string;
  /** 就近的恢复动作，例如“重试”；执行后这条提示自动收起。 */
  action?: NoticeAction;
}
interface Notice extends NoticeInput {
  id: number;
}

// 成功与信息类提示是确认，过一会儿自己收起；警告与错误保留在静默状态位直至确认。
const LIFETIME: Record<NoticeTone, number> = { success: 4000, info: 4000, warning: 0, danger: 0 };
const LIMIT = 5;
const URGENT = new Set<NoticeTone>(["danger", "warning"]);

let queue: Notice[] = [];
let sequence = 0;
const listeners = new Set<() => void>();

function publish(next: Notice[]) {
  queue = next;
  for (const listener of listeners) listener();
}

/**
 * 全应用唯一的提示队列：同样的提示只留最新一条；柔和纸面 C2 已取消浮层 Toast，
 * 改由左栏底部静默状态位（useLatestNotice）承接。
 */
export function notify(input: NoticeInput) {
  const id = ++sequence;
  const urgent = URGENT.has(input.tone);
  const kept = queue.filter((notice) => notice.tone !== input.tone || notice.text !== input.text);
  const own = kept
    .filter((notice) => URGENT.has(notice.tone) === urgent)
    .concat({ ...input, id })
    .slice(-LIMIT);
  const other = kept.filter((notice) => URGENT.has(notice.tone) !== urgent);
  publish(other.concat(own).sort((a, b) => a.id - b.id));
  return id;
}

export function dismissNotice(id: number) {
  if (queue.some((notice) => notice.id === id)) publish(queue.filter((notice) => notice.id !== id));
}

function useNoticeQueue() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => queue,
    () => queue,
  );
}

/** 获取最新一条通知，供左栏底部静默状态位展示（替代浮层 Toast）。 */
export function useLatestNotice(): Notice | null {
  const notices = useNoticeQueue();
  const latest = notices.length ? notices[notices.length - 1] : null;
  const latestId = latest?.id;
  const latestTone = latest?.tone;
  useEffect(() => {
    if (latestId === undefined || latestTone === undefined) return;
    const life = LIFETIME[latestTone];
    if (!life) return;
    const timer = setTimeout(() => dismissNotice(latestId), life);
    return () => clearTimeout(timer);
  }, [latestId, latestTone]);
  return latest;
}
