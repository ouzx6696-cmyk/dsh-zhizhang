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
      className={cx("wb-button", "wb-button-" + variant, "wb-button-" + size, icon != null && children == null && "wb-button-icon-only", className)}
      {...rest}
    >
      {icon != null ? <span className="wb-button-icon">{icon}</span> : null}
      {children}
    </button>
  );
}

function LocalTag({ tone = "outline", className, children }) {
  return (
    <span className={cx("wb-tag", className)} data-tone={tone}>
      {children}
    </span>
  );
}

function LocalStateDot({ state, size, className }) {
  const edge = size || 10;
  return <span className={cx("wb-state-dot", className)} data-state={state} style={{ width: edge, height: edge }} aria-hidden="true" />;
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
    <div role="tablist" aria-label={label} className={cx("wb-segmented", className)}>
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
            className={cx("wb-segment", active && "wb-segment-on")}
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
    <label className={cx("wb-checkbox", className)} title={title}>
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
    <div className="wb-modal-root" role="presentation">
      <div className="wb-modal-mask" aria-hidden="true" onClick={onClose} />
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={cx("wb-modal", className)}>
        <div className="wb-modal-content">
          <div className="wb-modal-header">
            <h2 className="wb-modal-title">{title}</h2>
            <button type="button" className="wb-icon-button" aria-label={closeLabel} onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
          {description ? <p className="wb-modal-description">{description}</p> : null}
          {children !== undefined ? <div className="wb-modal-body">{children}</div> : null}
        </div>
        {footer !== undefined ? <div className="wb-modal-footer">{footer}</div> : null}
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

/** 挂到 document.body（宿主提供 react-dom 时）；否则原地渲染 */
export function toBody(node) {
  if (REACT_DOM && typeof REACT_DOM.createPortal === "function" && typeof document !== "undefined") return REACT_DOM.createPortal(node, document.body);
  return node;
}

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
  pen: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"],
  send: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4z"],
  sparkles: ["M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z", "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"],
  eye: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  wand: ["M15 4V2", "M15 10V8", "M11 6h2", "M17 6h2", "M3 21l12-12"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 16v-4", "M12 8h.01"],
  circleCheck: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M8 12.5l2.5 2.5L16 9.5"],
  inbox: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
  news: ["M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2", "M18 14h-8", "M15 18h-5", "M10 6h8v4h-8z"],
  stamp: ["M5 22h14", "M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77z", "M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"],
};

/** 加载中的小圆环（尊重 prefers-reduced-motion，由样式控制） */
export function Spinner({ size = 14, label }) {
  return (
    <span className="wb-spinner" style={{ width: size, height: size }} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"} />
  );
}

/**
 * 带进行中与完成反馈的按钮：busy 时显示转圈并禁用；done 变真后短暂显示对勾。
 * 外层包一层 span 承载动画，宿主 Button 不需要认识这些属性。
 */
export function ActionButton({ busy = false, done = false, icon, children, disabled, ...rest }) {
  const [flash, setFlash] = React.useState(false);
  const prev = useRef(done);
  useEffect(() => {
    if (done && !prev.current) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 1600);
      prev.current = done;
      return () => clearTimeout(timer);
    }
    prev.current = done;
    return undefined;
  }, [done]);
  const shownIcon = busy ? <Spinner /> : flash ? <Icon name="check" size={14} /> : icon;
  return (
    <span className={cx("wb-action", busy && "wb-action-busy", flash && "wb-action-done")}>
      <Button {...rest} disabled={disabled || busy} aria-busy={busy || undefined} icon={shownIcon}>
        {children}
      </Button>
    </span>
  );
}

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
      className="wb-icon"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export const __hasHostPrimitives = Object.keys(PRIMITIVES).length > 0;
