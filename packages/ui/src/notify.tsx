import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { COPY } from "./copy.js";
import "./styles/notify.css";

export type NoticeTone = "success" | "info" | "warning" | "danger";
export interface NoticeAction {
  label: string;
  run: () => unknown;
}
export interface NoticeInput {
  tone: NoticeTone;
  text: string;
  /** 折叠在“查看详情”里的长说明；不给时取 text 第一行之后的内容。 */
  detail?: string;
  /** 就近的恢复动作，例如“重试”；执行后这条提示自动收起。 */
  action?: NoticeAction;
}
interface Notice extends NoticeInput {
  id: number;
}

// 成功与信息类提示是确认，过一会儿自己收起；警告与错误要作者看到并亲手关掉。
const LIFETIME: Record<NoticeTone, number> = { success: 4000, info: 4000, warning: 0, danger: 0 };
const LIMIT = 5;

let queue: Notice[] = [];
let sequence = 0;
const listeners = new Set<() => void>();

function publish(next: Notice[]) {
  queue = next;
  for (const listener of listeners) listener();
}

/** 全应用唯一的提示队列：同样的提示只留最新一条，最多同时显示五条，互不覆盖。 */
export function notify(input: NoticeInput) {
  const id = ++sequence;
  publish(
    queue
      .filter((notice) => notice.tone !== input.tone || notice.text !== input.text)
      .concat({ ...input, id })
      .slice(-LIMIT),
  );
  return id;
}

export function dismissNotice(id: number) {
  if (queue.some((notice) => notice.id === id)) publish(queue.filter((notice) => notice.id !== id));
}

/** 收起某一类提示，例如作者重新发起任务时旧的错误已不再适用。 */
export function dismissNotices(tone: NoticeTone) {
  if (queue.some((notice) => notice.tone === tone))
    publish(queue.filter((notice) => notice.tone !== tone));
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

function splitDetail({ text, detail }: Notice) {
  if (detail !== undefined) return [text, detail];
  const at = text.indexOf("\n");
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + 1).trim()];
}

/**
 * 自动收起的计时在悬停或聚焦时暂停，离开后按剩余时间继续。悬停与聚焦各记一处：
 * 鼠标仍停在提示上时失焦，或焦点仍在提示上时移开鼠标，都不能恢复计时。
 */
function useLifetime(notice: Notice) {
  const life = LIFETIME[notice.tone];
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const left = useRef(life);
  useEffect(() => {
    if (!life || paused) return;
    const started = Date.now();
    const timer = setTimeout(() => dismissNotice(notice.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [life, paused, notice.id]);
  return {
    life,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocus: () => setFocused(true),
    // 焦点移到提示里的按钮上仍算在提示内。
    onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      setFocused(false);
    },
  };
}

function NoticeItem({ notice }: { notice: Notice }) {
  const [head, detail] = splitDetail(notice);
  const { life, ...pauseHandlers } = useLifetime(notice);
  const { action } = notice;
  return (
    <div className="ui-notice" data-tone={notice.tone} {...pauseHandlers}>
      <span className="ui-notice-mark" aria-hidden="true" />
      <div className="ui-notice-body">
        <p>{head}</p>
        {detail ? (
          <details>
            <summary>{COPY.details}</summary>
            <pre>{detail}</pre>
          </details>
        ) : null}
        {action ? (
          <button
            type="button"
            className="ui-notice-action"
            onClick={() => {
              dismissNotice(notice.id);
              void action.run();
            }}
          >
            {action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="ui-notice-close"
        aria-label={COPY.close}
        onClick={() => dismissNotice(notice.id)}
      >
        ×
      </button>
      {life ? (
        <span
          className="ui-notice-timer"
          style={{ animationDuration: life + "ms" }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

const URGENT = new Set<NoticeTone>(["danger", "warning"]);

/**
 * 提示栈：挂一次即可。两个分区常驻 DOM，读屏才能可靠播报后插入的内容：
 * 错误与警告进 role=alert，成功与信息进 role=status。
 */
export function NoticeStack({ label }: { label: string }) {
  const notices = useNoticeQueue();
  return (
    <section className="ui-notices" aria-label={label}>
      <div role="alert">
        {notices
          .filter((notice) => URGENT.has(notice.tone))
          .map((notice) => (
            <NoticeItem key={notice.id} notice={notice} />
          ))}
      </div>
      <div role="status" aria-live="polite">
        {notices
          .filter((notice) => !URGENT.has(notice.tone))
          .map((notice) => (
            <NoticeItem key={notice.id} notice={notice} />
          ))}
      </div>
    </section>
  );
}
