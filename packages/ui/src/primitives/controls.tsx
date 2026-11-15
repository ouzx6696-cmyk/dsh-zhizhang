import { useEffect, useId, useRef } from "react";
import {
  checkboxClasses,
  cx,
  fieldClasses,
  segmentedClasses,
  selectClasses,
  tabId,
  tabPanelId,
  tabsClasses,
  toggleClasses,
  type CheckboxProps,
  type FieldProps,
  type SegmentedProps,
  type SelectProps,
  type TabsProps,
  type ToggleProps,
} from "./types.js";

export function Checkbox({
  label,
  checked,
  indeterminate = false,
  disabled = false,
  description,
  className,
  onChange,
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <label className={checkboxClasses({ disabled, className })}>
      <input
        ref={inputRef}
        type="checkbox"
        className="zz-checkbox__box"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="zz-checkbox__text">
        <span>{label}</span>
        {description ? <small className="zz-checkbox__desc">{description}</small> : null}
      </span>
    </label>
  );
}

export function Toggle({
  label,
  checked,
  disabled = false,
  description,
  className,
  onChange,
}: ToggleProps) {
  return (
    <label className={cx("ui-toggle", toggleClasses({ disabled, className }))}>
      <span className="zz-toggle__text">
        <span>{label}</span>
        {description ? <small className="zz-toggle__desc">{description}</small> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className={fieldClasses({ error, className })}>
      <label className="zz-field__label" htmlFor={fieldId}>
        <span>{label}</span>
        {required ? (
          <span className="zz-field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <div className="zz-field__control">{children}</div>
      {error ? (
        <p className="zz-field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="zz-field__hint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Select<T extends string = string>({
  id,
  label,
  options,
  value,
  placeholder,
  disabled = false,
  className,
  onChange,
}: SelectProps<T>) {
  return (
    <div className={selectClasses({ disabled, className })}>
      <select
        id={id}
        aria-label={label}
        disabled={disabled}
        value={value}
        className="zz-select__control"
        onChange={(event) => {
          const next = options.find((opt) => opt.value === event.target.value);
          if (next) onChange(next.value);
        }}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Segmented<T extends string = string>({
  label,
  options,
  value,
  size = "md",
  className,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={segmentedClasses({ size, className })}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={opt.disabled}
            className="zz-segmented__item"
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs({
  id,
  label,
  items,
  value,
  orientation = "horizontal",
  className,
  onChange,
}: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation={orientation}
      className={tabsClasses({ orientation, className })}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            id={tabId(id, item.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(id, item.id)}
            disabled={item.disabled}
            tabIndex={selected ? 0 : -1}
            className="zz-tab"
            onClick={() => onChange(item.id)}
          >
            <span>{item.label}</span>
            {item.badge != null ? <span className="zz-tab__badge">{item.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
