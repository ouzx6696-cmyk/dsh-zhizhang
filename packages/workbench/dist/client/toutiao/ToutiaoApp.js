import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ARTICLE_STEPS, articleProgress } from "@zhizhang/ui/status";
import { Steps } from "@zhizhang/ui/primitives";
import { Callout, Empty, Skeleton, StatusDot, StatusTag, cx } from "../shared/components.js";
export function ToutiaoApp({ state, rows, selected, dispatch }) {
    if (state.phase === "boot" && state.loading) {
        return _jsx(Skeleton, { lines: 6 });
    }
    if (state.error) {
        return (_jsx(Callout, { tone: "danger", role: "alert", children: state.error }));
    }
    return (_jsxs("div", { className: "wb-toutiao", children: [_jsx("aside", { className: "wb-toutiao-list", "aria-label": "\u6587\u7AE0\u5217\u8868", children: rows.length ? (_jsx("ul", { className: "wb-chapter-list", role: "listbox", "aria-label": "\u5934\u6761\u6587\u7AE0", children: rows.map((row) => {
                        const active = row.id === state.selectedId;
                        return (_jsx("li", { children: _jsxs("button", { type: "button", role: "option", "aria-selected": active, className: cx("wb-chapter-item", active && "wb-chapter-item-on"), onClick: () => dispatch({ type: "select", id: row.id }), children: [_jsx(StatusDot, { status: row.status, mode: "toutiao" }), _jsx("span", { className: "wb-chapter-title", children: row.title || row.id }), _jsx("span", { className: "wb-chapter-meta", children: row.qaScore != null ? `${row.qaScore} 分` : row.genre })] }) }, row.id));
                    }) })) : (_jsx(Empty, { title: "\u6682\u65E0\u5934\u6761\u6587\u7AE0", hint: "\u65B0\u5EFA\u9009\u9898\u540E\u5C06\u5728\u6B64\u5C55\u793A\u8FDB\u5EA6", icon: "news" })) }), _jsx("main", { className: "wb-toutiao-main", children: selected ? (_jsxs("div", { className: "wb-toutiao-detail", children: [_jsxs("header", { className: "wb-reader-head", children: [_jsxs("div", { className: "wb-reader-title-group", children: [_jsx("h2", { children: selected.title || selected.id }), _jsx(StatusTag, { status: selected.status, mode: "toutiao" })] }), _jsxs("span", { className: "wb-muted", children: [selected.genre, " \u00B7 ", selected.driver] })] }), _jsx(Steps, { steps: [...ARTICLE_STEPS], current: articleProgress({ status: selected.status }), label: "\u5934\u6761\u5199\u4F5C\u9636\u6BB5" }), state.lastDeliveryPath ? (_jsxs(Callout, { tone: "success", children: ["\u4EA4\u7A3F\u5355\u5DF2\u751F\u6210\uFF1A", state.lastDeliveryPath] })) : null] })) : (_jsx(Empty, { title: "\u8BF7\u9009\u62E9\u6587\u7AE0", hint: "\u4ECE\u5DE6\u4FA7\u5217\u8868\u9009\u62E9\u4E00\u7BC7\u5934\u6761\u6587\u7AE0\u67E5\u770B\u8BE6\u60C5", icon: "news" })) })] }));
}
