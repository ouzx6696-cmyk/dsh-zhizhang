import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef } from "react";
import { checkboxClasses, cx, fieldClasses, segmentedClasses, selectClasses, tabId, tabPanelId, tabsClasses, toggleClasses, } from "./types.js";
export function Checkbox({ label, checked, indeterminate = false, disabled = false, description, className, onChange, }) {
    const inputRef = useRef(null);
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.indeterminate = indeterminate;
        }
    }, [indeterminate]);
    return (_jsxs("label", { className: checkboxClasses({ disabled, className }), children: [_jsx("input", { ref: inputRef, type: "checkbox", className: "zz-checkbox__box", checked: checked, disabled: disabled, onChange: (event) => onChange(event.target.checked) }), _jsxs("span", { className: "zz-checkbox__text", children: [_jsx("span", { children: label }), description ? _jsx("small", { className: "zz-checkbox__desc", children: description }) : null] })] }));
}
export function Toggle({ label, checked, disabled = false, description, className, onChange, }) {
    return (_jsxs("label", { className: cx("ui-toggle", toggleClasses({ disabled, className })), children: [_jsxs("span", { className: "zz-toggle__text", children: [_jsx("span", { children: label }), description ? _jsx("small", { className: "zz-toggle__desc", children: description }) : null] }), _jsx("input", { type: "checkbox", role: "switch", checked: checked, disabled: disabled, onChange: (event) => onChange(event.target.checked) })] }));
}
export function Field({ id, label, hint, error, required = false, className, children, }) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (_jsxs("div", { className: fieldClasses({ error, className }), children: [_jsxs("label", { className: "zz-field__label", htmlFor: fieldId, children: [_jsx("span", { children: label }), required ? (_jsx("span", { className: "zz-field__required", "aria-hidden": "true", children: "*" })) : null] }), _jsx("div", { className: "zz-field__control", children: children }), error ? (_jsx("p", { className: "zz-field__error", role: "alert", children: error })) : hint ? (_jsx("p", { className: "zz-field__hint", children: hint })) : null] }));
}
export function Select({ id, label, options, value, placeholder, disabled = false, className, onChange, }) {
    return (_jsx("div", { className: selectClasses({ disabled, className }), children: _jsxs("select", { id: id, "aria-label": label, disabled: disabled, value: value, className: "zz-select__control", onChange: (event) => {
                const next = options.find((opt) => opt.value === event.target.value);
                if (next)
                    onChange(next.value);
            }, children: [placeholder ? (_jsx("option", { value: "", disabled: true, children: placeholder })) : null, options.map((opt) => (_jsx("option", { value: opt.value, disabled: opt.disabled, children: opt.label }, opt.value)))] }) }));
}
export function Segmented({ label, options, value, size = "md", className, onChange, }) {
    return (_jsx("div", { role: "radiogroup", "aria-label": label, className: segmentedClasses({ size, className }), children: options.map((opt) => {
            const selected = opt.value === value;
            return (_jsx("button", { type: "button", role: "radio", "aria-checked": selected, disabled: opt.disabled, className: "zz-segmented__item", onClick: () => onChange(opt.value), children: opt.label }, opt.value));
        }) }));
}
export function Tabs({ id, label, items, value, orientation = "horizontal", className, onChange, }) {
    return (_jsx("div", { role: "tablist", "aria-label": label, "aria-orientation": orientation, className: tabsClasses({ orientation, className }), children: items.map((item) => {
            const selected = item.id === value;
            return (_jsxs("button", { id: tabId(id, item.id), type: "button", role: "tab", "aria-selected": selected, "aria-controls": tabPanelId(id, item.id), disabled: item.disabled, tabIndex: selected ? 0 : -1, className: "zz-tab", onClick: () => onChange(item.id), children: [_jsx("span", { children: item.label }), item.badge != null ? _jsx("span", { className: "zz-tab__badge", children: item.badge }) : null] }, item.id));
        }) }));
}
