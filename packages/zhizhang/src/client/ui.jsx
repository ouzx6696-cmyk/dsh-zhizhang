/** Resolve optional host controls once. Rendering errors belong to the page boundary. */
import React from "react";

const { useEffect, useRef } = React;

function hostModule(id) {
  try {
    // eslint-disable-next-line no-undef
    return __dshRequire(id);
  } catch {
    return null;
  }
}

const PRIMITIVES = hostModule("@deepseek-ai/dsh-client-ui-primitives") || {};
const REACT_DOM = hostModule("react-dom");

function isComponent(value) {
  return typeof value === "function" || (value !== null && typeof value === "object" && "$$typeof" in value);
}

function pick(name, Local) {
  return isComponent(PRIMITIVES[name]) ? PRIMITIVES[name] : Local;
}

const cx = (...parts) => parts.filter(Boolean).join(" ");

function LocalButton({ variant = "ghost", size = "md", icon, className, children, type = "button", ...rest }) {
  return (
    <button
      type={type}
      className={cx("zz-button", "zz-button-" + variant, "zz-button-" + size, icon != null && children == null && "zz-button-icon-only", className)}
      {...rest}
    >
      {icon != null ? <span className="zz-button-icon">{icon}</span> : null}
      {children}
    </button>
  );
}

function LocalTag({ tone = "outline", className, children }) {
  return (
    <span className={cx("zz-tag", className)} data-tone={tone}>
      {children}
    </span>
  );
}

function LocalStateDot({ state, size, className }) {
  const edge = size || 10;
  return <span className={cx("zz-state-dot", className)} data-state={state} style={{ width: edge, height: edge }} aria-hidden="true" />;
}

function LocalSegmentedControl({ id, value, options, onChange, label, disabled = false, className }) {
  const onKeyDown = (event) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (keys.indexOf(event.key) < 0) return;
    event.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    if (!enabled.length) return;
    const at = enabled.findIndex((o) => o.value === value);
    let next;
    if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    else next = enabled[(at + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length];
    if (next && next.value !== value) onChange(next.value);
  };
  return (
    <div role="tablist" aria-label={label} className={cx("zz-segmented", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            id={id + "-" + option.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={id + "-" + option.value + "-panel"}
            tabIndex={active ? 0 : -1}
            title={option.title}
            disabled={disabled || option.disabled}
            className={cx("zz-segment", active && "zz-segment-on")}
            onClick={() => onChange(option.value)}
            onKeyDown={onKeyDown}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function LocalCheckbox({ checked, onChange, label, disabled = false, title, className }) {
  return (
    <label className={cx("zz-checkbox", className)} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function LocalModal({ open, onClose, title, closeLabel, description, children, footer, className }) {
  const dialog = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const previous = typeof document !== "undefined" ? document.activeElement : null;
    if (dialog.current) dialog.current.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === "Tab" && dialog.current) {
        const controls = Array.from(dialog.current.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]'));
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); dialog.current.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (previous && typeof previous.focus === "function") previous.focus();
    };
  }, [open]);
  if (!open) return null;
  const node = (
    <div className="zz-modal-root" role="presentation">
      <div className="zz-modal-mask" aria-hidden="true" onClick={onClose} />
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={cx("zz-modal", className)}>
        <div className="zz-modal-content">
          <div className="zz-modal-header">
            <h2 className="zz-modal-title">{title}</h2>
            <button type="button" className="zz-icon-button" aria-label={closeLabel} onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
          {description ? <p className="zz-modal-description">{description}</p> : null}
          {children !== undefined ? <div className="zz-modal-body">{children}</div> : null}
        </div>
        {footer !== undefined ? <div className="zz-modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
  if (REACT_DOM && typeof REACT_DOM.createPortal === "function" && typeof document !== "undefined") {
    return REACT_DOM.createPortal(node, document.body);
  }
  return node;
}

export const Button = pick("Button", LocalButton);
export const Tag = pick("Tag", LocalTag);
export const StateDot = pick("StateDot", LocalStateDot);
export const SegmentedControl = pick("SegmentedControl", LocalSegmentedControl);
export const Checkbox = pick("Checkbox", LocalCheckbox);
export const Modal = pick("Modal", LocalModal);
export { cx };

const ICONS = {
  book: [
    "M4 19.5A2.5 2.5 0 0 1 6.5 17H20",
    "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
    "M8 7h8M8 11h6",
  ],
  refresh: ["M20 11a8 8 0 1 0-2.34 5.66", "M20 4v7h-7"],
  pause: ["M9 5v14", "M15 5v14"],
  play: ["M7 5l12 7-12 7z"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  minus: ["M5 12h14"],
  plus: ["M12 5v14", "M5 12h14"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-3.5-3.5"],
  alert: ["M12 8v5", "M12 16.5v.5", "M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  chevron: ["M9 6l6 6-6 6"],
};

/** Stroke icon; decorative unless a `label` is given. */
export function Icon({ name, size = 16, label }) {
  const paths = ICONS[name] || ICONS.book;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : "true"}
      role={label ? "img" : undefined}
      aria-label={label}
      className="zz-icon"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export const __hasHostPrimitives = Object.keys(PRIMITIVES).length > 0;
