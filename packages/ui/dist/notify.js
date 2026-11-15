import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { COPY } from "./copy/index.js";
import "./styles/notify.css";
// 成功与信息类提示是确认，过一会儿自己收起；警告与错误要作者看到并亲手关掉。
const LIFETIME = { success: 4000, info: 4000, warning: 0, danger: 0 };
// 每个分区各自的上限：成功提示再多也挤不掉作者还没看的错误与警告。
const LIMIT = 5;
const URGENT = new Set(["danger", "warning"]);
let queue = [];
let sequence = 0;
const listeners = new Set();
function publish(next) {
    queue = next;
    for (const listener of listeners)
        listener();
}
/**
 * 全应用唯一的提示队列：同样的提示只留最新一条；错误与警告、成功与信息两个分区各自最多五条，
 * 超出时只淘汰本分区最旧的一条。
 */
export function notify(input) {
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
export function dismissNotice(id) {
    if (queue.some((notice) => notice.id === id))
        publish(queue.filter((notice) => notice.id !== id));
}
/** 收起某一类提示，例如作者重新发起任务时旧的错误已不再适用。 */
export function dismissNotices(tone) {
    if (queue.some((notice) => notice.tone === tone))
        publish(queue.filter((notice) => notice.tone !== tone));
}
function useNoticeQueue() {
    return useSyncExternalStore((listener) => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, () => queue, () => queue);
}
function splitDetail({ text, detail }) {
    if (detail !== undefined)
        return [text, detail];
    const at = text.indexOf("\n");
    return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + 1).trim()];
}
/**
 * 自动收起的计时在悬停或聚焦时暂停，离开后按剩余时间继续。悬停与聚焦各记一处：
 * 鼠标仍停在提示上时失焦，或焦点仍在提示上时移开鼠标，都不能恢复计时。
 */
function useLifetime(notice) {
    const life = LIFETIME[notice.tone];
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const paused = hovered || focused;
    const left = useRef(life);
    useEffect(() => {
        if (!life || paused)
            return;
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
        onBlur: (event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && event.currentTarget.contains(next))
                return;
            setFocused(false);
        },
    };
}
function NoticeItem({ notice }) {
    const [head, detail] = splitDetail(notice);
    const { life, ...pauseHandlers } = useLifetime(notice);
    const { action } = notice;
    return (_jsxs("div", { className: "ui-notice", "data-tone": notice.tone, ...pauseHandlers, children: [_jsx("span", { className: "ui-notice-mark", "aria-hidden": "true" }), _jsxs("div", { className: "ui-notice-body", children: [_jsx("p", { children: head }), detail ? (_jsxs("details", { children: [_jsx("summary", { children: COPY.details }), _jsx("pre", { children: detail })] })) : null, action ? (_jsx("button", { type: "button", className: "ui-notice-action", onClick: () => {
                            dismissNotice(notice.id);
                            void action.run();
                        }, children: action.label })) : null] }), _jsx("button", { type: "button", className: "ui-notice-close", "aria-label": COPY.close, onClick: () => dismissNotice(notice.id), children: "\u00D7" }), life ? (_jsx("span", { className: "ui-notice-timer", style: { animationDuration: life + "ms" }, "aria-hidden": "true" })) : null] }));
}
/**
 * 提示栈：挂一次即可。两个分区常驻 DOM，读屏才能可靠播报后插入的内容：
 * 错误与警告进 role=alert，成功与信息进 role=status。
 */
export function NoticeStack({ label }) {
    const notices = useNoticeQueue();
    return (_jsxs("section", { className: "ui-notices", "aria-label": label, children: [_jsx("div", { role: "alert", children: notices
                    .filter((notice) => URGENT.has(notice.tone))
                    .map((notice) => (_jsx(NoticeItem, { notice: notice }, notice.id))) }), _jsx("div", { role: "status", "aria-live": "polite", children: notices
                    .filter((notice) => !URGENT.has(notice.tone))
                    .map((notice) => (_jsx(NoticeItem, { notice: notice }, notice.id))) })] }));
}
