import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Empty, Section, SegmentedControl, StatusTag } from "../shared/components.js";
const TAB_OPTIONS = [
    { value: "overview", label: "总览" },
    { value: "library", label: "素材库" },
    { value: "inspiration", label: "灵感" },
    { value: "writing", label: "写作" },
    { value: "ledger", label: "台账" },
];
export function Pipeline({ state, view, dispatch }) {
    return (_jsxs("div", { className: "wb-pipeline", children: [_jsx(SegmentedControl, { id: "fanqie-pipeline", value: state.tab, options: TAB_OPTIONS, label: "\u756A\u8304\u6D41\u6C34\u7EBF\u89C6\u56FE", onChange: (tab) => dispatch({ type: "tab", tab }) }), _jsx(Section, { title: "\u5168\u4E66\u8FDB\u5EA6", aside: _jsxs("span", { children: [view.chapters.length, " \u7AE0"] }), children: view.chapters.length ? (_jsx("ul", { className: "wb-ledger-list", children: view.chapters.map((ch) => (_jsxs("li", { className: "wb-ledger-row", children: [_jsx("span", { children: ch.title || ch.id }), _jsxs("span", { children: [ch.wordCount, " \u5B57"] }), _jsx(StatusTag, { status: ch.status, mode: "fanqie" })] }, ch.id))) })) : (_jsx(Empty, { title: "\u6682\u65E0\u7AE0\u8282\u8BB0\u5F55", icon: "layers" })) })] }));
}
