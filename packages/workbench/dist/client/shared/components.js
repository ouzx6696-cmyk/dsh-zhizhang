import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Button } from "@zhizhang/ui/primitives";
import { statusInfo } from "@zhizhang/ui/status";
export function cx(...parts) {
    return parts.filter(Boolean).join(" ");
}
export function clip(value, n) {
    const text = String(value == null ? "" : value).trim();
    return text.length <= n ? text : `${text.slice(0, n)}…`;
}
const ICONS = {
    book: [
        "M4 19.5A2.5 2.5 0 0 1 6.5 17H20",
        "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
        "M8 7h8M8 11h6",
    ],
    refresh: ["M20 11a8 8 0 1 0-2.34 5.66", "M20 4v7h-7"],
    pause: ["M9 5v14", "M15 5v14"],
    play: ["M7 5l12 7-12 7z"],
    close: ["M6 6l12 12", "M18 6L6 18"],
    layers: ["M12 2l10 5-10 5L2 7z", "M2 12l10 5 10-5", "M2 17l10 5 10-5"],
    trash: [
        "M3 6h18",
        "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
        "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
    ],
    upload: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M17 8l-5-5-5 5", "M12 3v12"],
    undo: ["M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
    minus: ["M5 12h14"],
    plus: ["M12 5v14", "M5 12h14"],
    search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-3.5-3.5"],
    alert: [
        "M12 8v5",
        "M12 16.5v.5",
        "M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
    ],
    check: ["M5 12.5l4.5 4.5L19 7.5"],
    chevron: ["M9 6l6 6-6 6"],
    up: ["M6 15l6-6 6 6"],
    down: ["M6 9l6 6 6-6"],
    pen: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"],
    send: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4z"],
    sparkles: [
        "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z",
        "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
    ],
    eye: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
    wand: ["M15 4V2", "M15 10V8", "M11 6h2", "M17 6h2", "M3 21l12-12"],
    info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 16v-4", "M12 8h.01"],
    circleCheck: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M8 12.5l2.5 2.5L16 9.5"],
    inbox: [
        "M22 12h-6l-2 3h-4l-2-3H2",
        "M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
    ],
    news: [
        "M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2",
        "M18 14h-8",
        "M15 18h-5",
        "M10 6h8v4h-8z",
    ],
    stamp: [
        "M5 22h14",
        "M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77z",
        "M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13",
    ],
};
export function Icon({ name, size = 16, label }) {
    const paths = ICONS[name] ?? ICONS.book;
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": label ? undefined : "true", role: label ? "img" : undefined, "aria-label": label, className: "wb-icon", children: paths.map((d) => (_jsx("path", { d: d }, d))) }));
}
export function Spinner({ size = 14, label }) {
    return (_jsx("span", { className: "wb-spinner", style: { width: size, height: size }, role: label ? "status" : undefined, "aria-label": label, "aria-hidden": label ? undefined : "true" }));
}
export function Tag({ tone = "outline", className = "", children, }) {
    return (_jsx("span", { className: cx("wb-tag", className), "data-tone": tone, children: children }));
}
export function StateDot({ state, size = 10, className = "", }) {
    return (_jsx("span", { className: cx("wb-state-dot", className), "data-state": state, style: { width: size, height: size }, "aria-hidden": "true" }));
}
export function StatusTag({ status, mode = "fanqie" }) {
    const info = statusInfo(mode, status);
    return _jsx(Tag, { tone: info.tone, children: info.label });
}
export function StatusDot({ status, mode = "fanqie" }) {
    return _jsx(StateDot, { state: statusInfo(mode, status).dot, size: 8 });
}
export function SegmentedControl({ id, value, options, onChange, label, disabled = false, className = "", }) {
    const onKeyDown = (event) => {
        const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
        if (!keys.includes(event.key))
            return;
        event.preventDefault();
        const enabled = options.filter((o) => !o.disabled);
        if (!enabled.length)
            return;
        const at = enabled.findIndex((o) => o.value === value);
        const next = event.key === "Home"
            ? enabled[0]
            : event.key === "End"
                ? enabled[enabled.length - 1]
                : enabled[(at + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length];
        if (next && next.value !== value)
            onChange(next.value);
    };
    return (_jsx("div", { role: "tablist", "aria-label": label, className: cx("wb-segmented", className), children: options.map((option) => {
            const active = option.value === value;
            return (_jsx("button", { id: `${id}-${option.value}`, type: "button", role: "tab", "aria-selected": active, "aria-controls": `${id}-${option.value}-panel`, tabIndex: active ? 0 : -1, title: option.title, disabled: disabled || option.disabled, className: cx("wb-segment", active && "wb-segment-on"), onClick: () => onChange(option.value), onKeyDown: onKeyDown, children: option.label }, option.value));
        }) }));
}
export function Checkbox({ checked, onChange, label, disabled = false, title, className = "", }) {
    return (_jsxs("label", { className: cx("wb-checkbox", className), title: title, children: [_jsx("input", { type: "checkbox", checked: checked, disabled: disabled, onChange: (event) => onChange(event.target.checked) }), _jsx("span", { children: label })] }));
}
export function ActionButton({ busy = false, done = 0, icon, children, disabled, variant = "secondary", className = "", ...rest }) {
    const [flash, setFlash] = useState(false);
    const prev = useRef(done);
    useEffect(() => {
        const changed = done !== prev.current;
        prev.current = done;
        if (!done || !changed)
            return undefined;
        setFlash(true);
        const timer = setTimeout(() => setFlash(false), 1600);
        return () => clearTimeout(timer);
    }, [done]);
    const shownIcon = busy ? _jsx(Spinner, {}) : flash ? _jsx(Icon, { name: "check", size: 14 }) : icon;
    return (_jsx("span", { className: cx("wb-action", busy && "wb-action-busy", flash && "wb-action-done"), children: _jsxs(Button, { variant: variant, className: className, ...rest, disabled: disabled || busy, "aria-busy": busy || undefined, children: [shownIcon != null ? _jsx("span", { className: "wb-button-icon", children: shownIcon }) : null, children] }) }));
}
export function Section({ title, aside = null, children, className = "", }) {
    return (_jsxs("section", { className: cx("wb-section", className), children: [title ? (_jsxs("header", { className: "wb-section-head", children: [_jsx("h3", { className: "wb-section-title", children: title }), aside] })) : null, children] }));
}
export function Empty({ title = null, hint = null, icon = null, children = null, }) {
    return (_jsxs("div", { className: "wb-empty", children: [icon ? (_jsx("span", { className: "wb-empty-icon", children: _jsx(Icon, { name: icon, size: 20 }) })) : null, title ? _jsx("p", { className: "wb-empty-title", children: title }) : null, hint ? _jsx("p", { className: "wb-empty-hint", children: hint }) : null, children] }));
}
export function Skeleton({ lines = 6 }) {
    const rows = [];
    for (let i = 0; i < lines; i += 1) {
        rows.push(_jsx("span", { className: cx("wb-skeleton", i === lines - 1 && "wb-skeleton-short") }, i));
    }
    return (_jsx("div", { className: "wb-skeleton-stack", "aria-hidden": "true", children: rows }));
}
export function Callout({ tone = "info", role, children, onDismiss, }) {
    return (_jsxs("div", { className: "wb-callout", "data-tone": tone, role: role, children: [tone === "danger" || tone === "warning" ? _jsx(Icon, { name: "alert", size: 14 }) : null, _jsx("div", { className: "wb-callout-text", children: children }), onDismiss ? (_jsx("button", { type: "button", className: "wb-icon-button wb-callout-close", "aria-label": "\u5173\u95ED", onClick: onDismiss, children: _jsx(Icon, { name: "close", size: 14 }) })) : null] }));
}
export function ActionCard({ icon, title, hint, onClick, disabled = false, busy = false, primary = false, offReason, }) {
    return (_jsxs("button", { type: "button", className: cx("wb-action-card", primary && "wb-action-card-primary", busy && "wb-action-card-busy"), disabled: disabled || busy, "aria-busy": busy || undefined, title: disabled && offReason ? offReason : undefined, onClick: onClick, children: [_jsx("span", { className: "wb-action-card-icon", children: busy ? _jsx(Spinner, { size: 16 }) : _jsx(Icon, { name: icon, size: 16 }) }), _jsxs("span", { className: "wb-action-card-text", children: [_jsx("span", { className: "wb-action-card-title", children: title }), busy ? (_jsx("span", { className: "wb-action-card-hint", children: "\u6B63\u5728\u6267\u884C\u2026" })) : hint ? (_jsx("span", { className: "wb-action-card-hint", children: hint })) : null] }), _jsx("span", { className: "wb-action-card-go", children: _jsx(Icon, { name: "chevron", size: 14 }) })] }));
}
export function Foundation({ foundation = null, limit = 240, }) {
    const f = foundation ?? {};
    const rows = [
        ["设定锁", f.locks],
        ["已发生", f.happened],
        ["伏笔线", f.threads],
        ["文风约束", f.style],
    ];
    return (_jsx("dl", { className: "wb-facts", children: rows.map(([label, value]) => (_jsxs("div", { className: "wb-fact", children: [_jsx("dt", { children: label }), _jsx("dd", { children: clip(value, limit) || "—" })] }, label))) }));
}
const URGENT = /待采纳|硬拒|缺|修订待核对|不可读|未过/;
export function Hints({ hints, initial = 4, }) {
    const [open, setOpen] = useState(false);
    const list = (hints ?? []).map((hint) => String(hint));
    if (!list.length)
        return _jsx("p", { className: "wb-muted", children: "\u6682\u65E0\u63D0\u793A" });
    const shown = open ? list : list.slice(0, initial);
    return (_jsxs("div", { className: "wb-hints", children: [_jsx("ol", { className: "wb-hint-list", children: shown.map((hint, i) => (_jsxs("li", { className: cx("wb-hint", URGENT.test(hint) && "wb-hint-urgent"), children: [_jsx(Icon, { name: URGENT.test(hint) ? "alert" : "chevron", size: 12 }), _jsx("span", { children: hint })] }, i))) }), list.length > initial ? (_jsx(Button, { variant: "secondary", onClick: () => setOpen(!open), children: open ? "收起" : "展开更多" })) : null] }));
}
