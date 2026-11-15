import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import {
  checkboxClasses,
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
  testId,
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
        data-testid={testId}
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
  testId,
  onChange,
}: ToggleProps) {
  return (
    <label className={toggleClasses({ disabled, className })}>
      <span className="zz-toggle__text">
        <span>{label}</span>
        {description ? <small className="zz-toggle__desc">{description}</small> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        data-testid={testId}
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
  testId,
  onChange,
}: SelectProps<T>) {
  return (
    <div className={selectClasses({ disabled, className })}>
      <select
        id={id}
        aria-label={label}
        data-testid={testId}
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
  testId,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      className={segmentedClasses({ size, className })}
      onKeyDown={(event) => {
        const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
        const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
        if (!forward && !back) return;
        const enabled = options.filter((opt) => !opt.disabled);
        if (!enabled.length) return;
        event.preventDefault();
        const at = Math.max(
          0,
          enabled.findIndex((opt) => opt.value === value),
        );
        const next = enabled[(at + (forward ? 1 : -1) + enabled.length) % enabled.length];
        onChange(next.value);
        const host = event.currentTarget;
        requestAnimationFrame(() =>
          host.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus(),
        );
      }}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-testid={testId ? `${testId}-${opt.value}` : undefined}
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

/** 方向键漫游：横向用 ←/→，纵向用 ↑/↓；Home/End 到两端。焦点与选中一起移动（自动激活）。 */
function rovingTarget(
  event: KeyboardEvent<HTMLElement>,
  orientation: TabsProps["orientation"],
): "next" | "prev" | "first" | "last" | null {
  const vertical = orientation === "vertical";
  if (event.key === (vertical ? "ArrowDown" : "ArrowRight")) return "next";
  if (event.key === (vertical ? "ArrowUp" : "ArrowLeft")) return "prev";
  if (event.key === "Home") return "first";
  if (event.key === "End") return "last";
  return null;
}

export function Tabs({
  id,
  label,
  items,
  value,
  orientation = "horizontal",
  className,
  testId,
  onChange,
}: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = rovingTarget(event, orientation);
    if (!move) return;
    const enabled = items.filter((item) => !item.disabled);
    if (!enabled.length) return;
    event.preventDefault();
    const at = Math.max(
      0,
      enabled.findIndex((item) => item.id === value),
    );
    const next =
      move === "first"
        ? enabled[0]
        : move === "last"
          ? enabled[enabled.length - 1]
          : enabled[(at + (move === "next" ? 1 : -1) + enabled.length) % enabled.length];
    if (next.id !== value) onChange(next.id);
    listRef.current?.querySelector<HTMLElement>(`[id="${tabId(id, next.id)}"]`)?.focus();
  };
  return (
    <div
      ref={listRef}
      data-testid={testId}
      role="tablist"
      aria-label={label}
      aria-orientation={orientation}
      className={tabsClasses({ orientation, className })}
      onKeyDown={onKeyDown}
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
            data-testid={testId ? `${testId}-${item.id}` : undefined}
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
