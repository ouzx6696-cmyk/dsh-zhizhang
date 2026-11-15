import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cx, progressStepState, } from "./types.js";
export function Brand({ label = "织章", className, children = "章" }) {
    return (_jsx("span", { className: cx("ui-brand", "zz-brand", className), "aria-label": label, children: children }));
}
export function Card({ title, description, footer, className, children }) {
    return (_jsxs("section", { className: cx("ui-card", "zz-card", className), children: [title ? _jsx("h3", { className: "zz-card__title", children: title }) : null, description ? _jsx("p", { className: "zz-card__desc", children: description }) : null, children, footer ? _jsx("footer", { children: footer }) : null] }));
}
export function Stat({ label, value, detail, className }) {
    return (_jsxs("div", { className: cx("ui-stat", "zz-stat", className), children: [_jsx("span", { children: label }), _jsx("strong", { children: value }), detail ? _jsx("small", { children: detail }) : null] }));
}
export function Steps({ steps, current, label, className }) {
    return (_jsx("ol", { className: cx("ui-steps", "zz-steps", className), "aria-label": label, children: steps.map((step, index) => {
            const state = progressStepState(index, current);
            const itemLabel = typeof step === "string" ? step : step.label;
            const key = typeof step === "string" ? `${index}-${step}` : step.id;
            return (_jsxs("li", { "data-state": state, "aria-current": state === "current" ? "step" : undefined, children: [_jsx("span", { children: state === "done" ? "✓" : index + 1 }), itemLabel] }, key));
        }) }));
}
