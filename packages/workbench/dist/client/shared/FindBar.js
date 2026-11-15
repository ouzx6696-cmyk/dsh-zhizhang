import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@zhizhang/ui/primitives";
import { Icon, cx } from "./components.js";
export function useFind() {
    const [mode, setMode] = useState("");
    const [query, setQuery] = useState("");
    const [replacement, setReplacement] = useState("");
    const [matchCase, setMatchCase] = useState(false);
    const [focusTick, setFocusTick] = useState(0);
    const open = useCallback((nextMode = "find", seed = "") => {
        setMode(nextMode);
        if (seed)
            setQuery(seed);
        setFocusTick((tick) => tick + 1);
    }, []);
    const close = useCallback(() => {
        setMode("");
    }, []);
    const toggleMatchCase = useCallback(() => {
        setMatchCase((prev) => !prev);
    }, []);
    return {
        mode,
        query,
        replacement,
        matchCase,
        open,
        close,
        setQuery,
        setReplacement,
        toggleMatchCase,
        focusTick,
    };
}
export function isShortcut(event, key) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey)
        return false;
    return event.key.toLowerCase() === key.toLowerCase();
}
export function typingElsewhere(event, root) {
    const target = event.target;
    if (!(target instanceof HTMLElement))
        return false;
    if (root && root.contains(target))
        return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}
export function FindBar({ find, label = "查找与替换", index, total, status, onStep, onReplace, onReplaceAll, onClose, canReplace = false, }) {
    const inputRef = useRef(null);
    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [find.focusTick]);
    const countText = status ?? (find.query ? (total > 0 ? `${index + 1} / ${total}` : "0 / 0") : "");
    return (_jsxs("div", { className: "wb-find-bar", role: "region", "aria-label": label, children: [_jsxs("div", { className: "wb-find-row", children: [_jsx("input", { ref: inputRef, type: "search", className: "wb-find-input", value: find.query, placeholder: "\u67E5\u627E\u2026", "aria-label": "\u67E5\u627E\u6587\u672C", onChange: (event) => find.setQuery(event.target.value), onKeyDown: (event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                onStep(event.shiftKey ? -1 : 1);
                            }
                            else if (event.key === "Escape") {
                                event.preventDefault();
                                onClose();
                            }
                        } }), _jsx("button", { type: "button", className: cx("wb-icon-button", find.matchCase && "wb-icon-button-on"), "aria-pressed": find.matchCase, title: "\u533A\u5206\u5927\u5C0F\u5199", onClick: find.toggleMatchCase, children: "Aa" }), _jsx("span", { className: "wb-find-count", "aria-live": "polite", children: countText }), _jsx(Button, { variant: "secondary", onClick: () => onStep(-1), disabled: !total, title: "\u4E0A\u4E00\u5904", children: _jsx(Icon, { name: "up", size: 14 }) }), _jsx(Button, { variant: "secondary", onClick: () => onStep(1), disabled: !total, title: "\u4E0B\u4E00\u5904", children: _jsx(Icon, { name: "down", size: 14 }) }), _jsx(Button, { variant: "secondary", onClick: onClose, title: "\u5173\u95ED", children: _jsx(Icon, { name: "close", size: 14 }) })] }), canReplace && find.mode === "replace" ? (_jsxs("div", { className: "wb-find-row", children: [_jsx("input", { type: "text", className: "wb-find-input", value: find.replacement, placeholder: "\u66FF\u6362\u4E3A\u2026", "aria-label": "\u66FF\u6362\u6587\u672C", onChange: (event) => find.setReplacement(event.target.value), onKeyDown: (event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                onReplace?.();
                            }
                            else if (event.key === "Escape") {
                                event.preventDefault();
                                onClose();
                            }
                        } }), _jsx(Button, { variant: "secondary", onClick: onReplace, disabled: !total, children: "\u66FF\u6362" }), _jsx(Button, { variant: "secondary", onClick: onReplaceAll, disabled: !total, children: "\u5168\u90E8\u66FF\u6362" })] })) : null] }));
}
