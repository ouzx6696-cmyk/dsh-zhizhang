import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Empty, StatusDot, cx } from "../shared/components.js";
export function ChapterList({ chapters, selectedId, onSelect }) {
    if (!chapters.length) {
        return _jsx(Empty, { title: "\u6682\u65E0\u7AE0\u8282", hint: "\u521B\u5EFA\u6216\u5BFC\u5165\u7AE0\u8282\u540E\u5C06\u5728\u6B64\u663E\u793A", icon: "book" });
    }
    return (_jsx("ul", { className: "wb-chapter-list", role: "listbox", "aria-label": "\u7AE0\u8282\u5217\u8868", children: chapters.map((ch) => {
            const active = ch.id === selectedId;
            return (_jsx("li", { children: _jsxs("button", { type: "button", role: "option", "aria-selected": active, className: cx("wb-chapter-item", active && "wb-chapter-item-on"), onClick: () => onSelect(ch.id), children: [_jsx(StatusDot, { status: ch.status, mode: "fanqie" }), _jsx("span", { className: "wb-chapter-title", children: ch.title || ch.id }), _jsxs("span", { className: "wb-chapter-meta", children: [ch.wordCount, " \u5B57"] })] }) }, ch.id));
        }) }));
}
