import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { Spinner } from "./feedback.js";
import { buttonClasses, cx, iconButtonClasses, menuClasses, } from "./types.js";
export function Button({ variant = "secondary", size = "md", disabled = false, loading = false, type = "button", className, children, ...rest }) {
    return (_jsxs("button", { ...rest, type: type, disabled: disabled || loading, "aria-busy": loading || rest["aria-busy"] || undefined, className: buttonClasses({ variant, size, className }), children: [loading ? _jsx(Spinner, { size: "sm" }) : null, children] }));
}
export function IconButton({ label, variant = "ghost", size = "md", disabled = false, pressed, type = "button", className, icon, children, ...rest }) {
    return (_jsx("button", { ...rest, type: type, disabled: disabled, "aria-label": label, "aria-pressed": pressed, title: rest.title ?? label, className: iconButtonClasses({ variant, size, className }), children: icon ?? children }));
}
export function Menu({ label, items, open = true, className, onClose }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!open || !onClose)
            return undefined;
        const handleKey = (event) => {
            if (event.key === "Escape")
                onClose();
        };
        const handlePointer = (event) => {
            const target = event.target;
            if (ref.current && target instanceof Node && !ref.current.contains(target)) {
                onClose();
            }
        };
        document.addEventListener("keydown", handleKey);
        document.addEventListener("mousedown", handlePointer);
        return () => {
            document.removeEventListener("keydown", handleKey);
            document.removeEventListener("mousedown", handlePointer);
        };
    }, [open, onClose]);
    if (!open)
        return null;
    return (_jsx("div", { ref: ref, role: "menu", "aria-label": label, className: menuClasses({ open, className }), children: items.map((item) => item.separator ? (_jsx("div", { role: "separator", className: "zz-menu__separator" }, item.id)) : (_jsxs("button", { type: "button", role: "menuitem", disabled: item.disabled, className: cx("zz-menu__item", item.danger && "zz-menu__item--danger"), onClick: () => {
                item.onSelect?.();
                onClose?.();
            }, children: [_jsx("span", { children: item.label }), item.shortcut ? _jsx("kbd", { className: "zz-menu__shortcut", children: item.shortcut }) : null] }, item.id))) }));
}
