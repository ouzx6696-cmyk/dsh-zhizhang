import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { cx, dialogClasses, emptyClasses, kbdClasses, noticeClasses, progressRailClasses, skeletonClasses, spinnerClasses, statusChipClasses, tagClasses, } from "./types.js";
export function Dialog({ open = true, title, description, size = "md", closeLabel, footer, className, onClose, children, }) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el)
            return;
        if (open) {
            if (!el.open) {
                if (typeof el.showModal === "function") {
                    el.showModal();
                }
                else {
                    el.setAttribute("open", "");
                }
            }
        }
        else if (el.open) {
            if (typeof el.close === "function") {
                el.close();
            }
            else {
                el.removeAttribute("open");
            }
        }
    }, [open]);
    return (_jsxs("dialog", { ref: ref, "aria-label": title, className: cx("ui-dialog", dialogClasses({ size, className })), onCancel: (event) => {
            event.preventDefault();
            onClose();
        }, onClick: (event) => {
            if (event.target === ref.current) {
                onClose();
            }
        }, children: [closeLabel ? (_jsxs("header", { className: "zz-dialog__header", children: [_jsx("h2", { className: "zz-dialog__title", children: title }), _jsx("button", { type: "button", className: "zz-icon-btn zz-btn--ghost zz-icon-btn--sm", "aria-label": closeLabel, onClick: onClose, children: "\u00D7" })] })) : null, description ? _jsx("p", { className: "zz-dialog__desc", children: description }) : null, children, footer ? _jsx("footer", { className: "zz-dialog__footer", children: footer }) : null] }));
}
export function Tag({ label, tone = "neutral", removable = false, className, onRemove, }) {
    return (_jsxs("span", { className: tagClasses({ tone, className }), children: [_jsx("span", { children: label }), removable ? (_jsx("button", { type: "button", className: "zz-tag__remove", "aria-label": "\u79FB\u9664", onClick: onRemove, children: "\u00D7" })) : null] }));
}
export function StatusChip({ tone, label, dot = false, className }) {
    return (_jsxs("span", { className: statusChipClasses({ tone, className }), children: [dot ? _jsx("span", { className: "zz-status-chip__dot", "aria-hidden": "true" }) : null, _jsx("span", { children: label })] }));
}
export function Notice({ tone, variant = "inline", message, detail, actionLabel, onAction, onClose, className, }) {
    return (_jsxs("div", { role: tone === "bad" ? "alert" : "status", className: noticeClasses({ tone, variant, className }), children: [_jsxs("div", { className: "zz-notice__body", children: [_jsx("p", { className: "zz-notice__message", children: message }), detail ? _jsx("p", { className: "zz-notice__detail", children: detail }) : null] }), actionLabel || onClose ? (_jsxs("div", { className: "zz-notice__actions", children: [actionLabel && onAction ? (_jsx("button", { type: "button", className: "zz-btn zz-btn--ghost zz-btn--sm", onClick: onAction, children: actionLabel })) : null, onClose ? (_jsx("button", { type: "button", className: "zz-icon-btn zz-btn--ghost zz-icon-btn--sm", "aria-label": "\u5173\u95ED", onClick: onClose, children: "\u00D7" })) : null] })) : null] }));
}
export function Empty({ title, description, icon, action, className }) {
    return (_jsxs("div", { className: emptyClasses({ className }), children: [icon ? (_jsx("div", { className: "zz-empty__icon", "aria-hidden": "true", children: icon })) : null, _jsx("div", { className: "zz-empty__title", children: title }), description ? _jsx("div", { className: "zz-empty__desc", children: description }) : null, action ? _jsx("div", { className: "zz-empty__action", children: action }) : null] }));
}
export function Skeleton({ variant = "text", width, height, lines = 1, className, }) {
    const style = {
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
    };
    if (variant === "text" && lines > 1) {
        return (_jsx("div", { className: cx("zz-skeleton-group", className), "aria-hidden": "true", children: Array.from({ length: lines }, (_, index) => (_jsx("span", { className: skeletonClasses({ variant }), style: {
                    ...style,
                    width: index === lines - 1 && !width ? "72%" : style.width,
                } }, index))) }));
    }
    return _jsx("span", { className: skeletonClasses({ variant, className }), style: style, "aria-hidden": "true" });
}
export function Spinner({ size = "md", label = "加载中", className }) {
    return (_jsx("span", { role: "status", "aria-label": label, className: spinnerClasses({ size, className }) }));
}
export function ProgressRail({ steps, current, label, className }) {
    const total = Math.max(steps.length, 1);
    const clamped = Math.min(Math.max(current + 1, 0), total);
    const percent = Math.round((clamped / total) * 100);
    return (_jsx("div", { role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": clamped, className: progressRailClasses({ className }), children: _jsx("div", { className: "zz-progress-rail__fill", style: { width: `${percent}%` } }) }));
}
export function Kbd({ keys, className }) {
    const list = Array.isArray(keys) ? keys : [keys];
    return (_jsx("span", { className: cx("zz-kbd-group", className), children: list.map((key, index) => (_jsx("kbd", { className: kbdClasses(), children: key }, `${index}-${key}`))) }));
}
