import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ActionCard, Empty, Section, StatusTag } from "../shared/components.js";
export function Inspector({ state, view, dispatch, onRefresh }) {
    if (!view.current) {
        return _jsx(Empty, { title: "\u7AE0\u8282\u68C0\u67E5\u5668", hint: "\u9009\u62E9\u7AE0\u8282\u540E\u67E5\u770B\u72B6\u6001\u4E0E\u64CD\u4F5C", icon: "info" });
    }
    const current = view.current;
    const isFinal = current.status === "final";
    return (_jsxs("aside", { className: "wb-inspector", children: [_jsx(Section, { title: "\u672C\u7AE0\u72B6\u6001", aside: _jsx(StatusTag, { status: current.status, mode: "fanqie" }), children: _jsxs("dl", { className: "wb-facts", children: [_jsxs("div", { className: "wb-fact", children: [_jsx("dt", { children: "\u7AE0\u8282\u7F16\u53F7" }), _jsx("dd", { children: current.id })] }), _jsxs("div", { className: "wb-fact", children: [_jsx("dt", { children: "\u5B57\u6570\u7EDF\u8BA1" }), _jsxs("dd", { children: [current.wordCount, " \u5B57"] })] }), _jsxs("div", { className: "wb-fact", children: [_jsx("dt", { children: "\u5F53\u524D\u7248\u672C" }), _jsx("dd", { children: current.revision || "—" })] })] }) }), _jsx(Section, { title: "\u7AE0\u8282\u64CD\u4F5C", children: _jsxs("div", { className: "wb-action-stack", children: [_jsx(ActionCard, { icon: "stamp", title: "\u5B9A\u7A3F\u672C\u7AE0", hint: isFinal ? "当前章节已定稿" : "确认正文无误并锁定为定稿", primary: !isFinal, disabled: isFinal || Boolean(state.busyAction), busy: state.busyAction === "finalize", onClick: () => dispatch({ type: "openDialog", dialog: { kind: "finalize", chapterId: current.id } }) }), _jsx(ActionCard, { icon: "refresh", title: "\u5237\u65B0\u5FEB\u7167", hint: "\u4ECE\u5DE5\u4F5C\u533A\u589E\u91CF\u540C\u6B65\u6700\u65B0\u7AE0\u8282\u72B6\u6001", disabled: state.loading, busy: state.loading, onClick: () => void onRefresh() })] }) })] }));
}
