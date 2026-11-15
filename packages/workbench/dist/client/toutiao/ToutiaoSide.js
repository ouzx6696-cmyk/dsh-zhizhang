import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { TOUTIAO_DELIVERED } from "@zhizhang/ui/status";
import { ActionCard, Empty, Section, StatusTag } from "../shared/components.js";
export function ToutiaoSide({ state, selected, onRefresh, onDeliver }) {
    if (!selected) {
        return _jsx(Empty, { title: "\u6587\u7AE0\u68C0\u67E5\u5668", hint: "\u9009\u62E9\u6587\u7AE0\u540E\u67E5\u770B\u8D28\u68C0\u4E0E\u4EA4\u7A3F\u72B6\u6001", icon: "info" });
    }
    const delivered = selected.status === TOUTIAO_DELIVERED;
    const articleDir = state.root ? `${state.root.replace(/[\\/]+$/, "")}/${selected.id}` : selected.id;
    return (_jsxs("aside", { className: "wb-inspector", children: [_jsx(Section, { title: "\u6587\u7AE0\u53F0\u8D26", aside: _jsx(StatusTag, { status: selected.status, mode: "toutiao" }), children: _jsxs("dl", { className: "wb-facts", children: [_jsxs("div", { className: "wb-fact", children: [_jsx("dt", { children: "\u9898\u6750" }), _jsx("dd", { children: selected.genre })] }), _jsxs("div", { className: "wb-fact", children: [_jsx("dt", { children: "\u9A71\u52A8" }), _jsx("dd", { children: selected.driver })] }), _jsxs("div", { className: "wb-fact", children: [_jsx("dt", { children: "\u8D28\u68C0\u5206" }), _jsx("dd", { children: selected.qaScore != null ? `${selected.qaScore} 分` : "未评分" })] }), _jsxs("div", { className: "wb-fact", children: [_jsx("dt", { children: "\u66F4\u65B0\u65F6\u95F4" }), _jsx("dd", { children: selected.updatedAt })] })] }) }), _jsx(Section, { title: "\u4EA4\u7A3F\u4E0E\u540C\u6B65", children: _jsxs("div", { className: "wb-action-stack", children: [_jsx(ActionCard, { icon: "send", title: "\u751F\u6210\u4EA4\u7A3F\u5355", hint: delivered ? "本文已交稿" : "通过质检后生成最终交稿单", primary: !delivered, disabled: delivered || Boolean(state.busyAction), busy: state.busyAction === "deliver", onClick: () => void onDeliver(articleDir, selected.title, "") }), _jsx(ActionCard, { icon: "refresh", title: "\u5237\u65B0\u53F0\u8D26", hint: "\u540C\u6B65\u5934\u6761\u6587\u7AE0\u6700\u65B0\u72B6\u6001", disabled: state.loading, busy: state.loading, onClick: () => void onRefresh() })] }) })] }));
}
