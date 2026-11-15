import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { Button, Dialog } from "@zhizhang/ui/primitives";
import { Callout } from "../shared/components.js";
export function Dialogs({ state, dispatch, onFinalize, onAcceptCandidate }) {
    const dialog = state.dialog;
    if (!dialog)
        return null;
    const busy = Boolean(state.busyAction);
    const close = () => {
        if (!busy)
            dispatch({ type: "closeDialog" });
    };
    if (dialog.kind === "finalize") {
        return (_jsx(Dialog, { open: true, title: "\u786E\u8BA4\u5B9A\u7A3F", closeLabel: "\u5173\u95ED", description: `确定将章节 ${dialog.chapterId} 标记为定稿吗？`, onClose: close, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "secondary", onClick: close, disabled: busy, children: "\u53D6\u6D88" }), _jsx(Button, { variant: "primary", disabled: busy, onClick: () => void onFinalize(dialog.chapterId), children: busy ? "处理中…" : "确认定稿" })] }), children: _jsx(Callout, { tone: "info", children: "\u5B9A\u7A3F\u540E\u8BE5\u7AE0\u5C06\u4F5C\u4E3A\u540E\u7EED\u7AE0\u8282\u4E00\u81F4\u6027\u68C0\u67E5\u7684\u7A33\u5B9A\u57FA\u7EBF\u3002" }) }));
    }
    const candidateId = dialog.candidateId ?? state.candidateId;
    return (_jsx(Dialog, { open: true, title: "\u91C7\u7EB3\u5019\u9009\u7A3F", closeLabel: "\u5173\u95ED", description: `确定采纳候选稿 ${candidateId} 作为章节 ${dialog.chapterId} 的正文吗？`, onClose: close, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "secondary", onClick: close, disabled: busy, children: "\u53D6\u6D88" }), _jsx(Button, { variant: "primary", disabled: busy || !candidateId, onClick: () => void onAcceptCandidate(dialog.chapterId, candidateId, state.chapter.revision), children: busy ? "处理中…" : "确认采纳" })] }), children: _jsx(Callout, { tone: "warning", children: "\u91C7\u7EB3\u64CD\u4F5C\u4F1A\u8986\u76D6\u5F53\u524D\u6B63\u6587\u7AE0\u8282\u5E76\u66F4\u65B0\u7248\u672C\u57FA\u7EBF\u3002" }) }));
}
