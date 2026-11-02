import React from "react";

export function Button({ variant = "secondary", className = "", children, ...props }) {
  return (
    <button type="button" {...props} className={`ui-button ui-button-${variant} ${className}`}>
      {children}
    </button>
  );
}
export function Tabs({ items, value, onChange, label, className = "" }) {
  const move = (event) => {
    const at = items.findIndex((item) => item.value === value);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowRight"
            ? (at + 1) % items.length
            : event.key === "ArrowLeft"
              ? (at - 1 + items.length) % items.length
              : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(items[next].value);
    event.currentTarget.parentElement.children[next].focus();
  };
  return (
    <div className={`ui-tabs ${className}`} role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          aria-selected={item.value === value}
          tabIndex={item.value === value ? 0 : -1}
          onKeyDown={move}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
export function Steps({ steps, current, label }) {
  return (
    <ol className="ui-steps" aria-label={label}>
      {steps.map((step, i) => (
        <li
          key={step}
          data-state={i < current ? "done" : i === current ? "current" : "todo"}
          aria-current={i === current ? "step" : undefined}
        >
          <span aria-hidden="true">{i < current ? "✓" : i + 1}</span>
          {step}
        </li>
      ))}
    </ol>
  );
}
export function Card({ title = "", children, actions = null, className = "" }) {
  return (
    <section className={`ui-card ${className}`}>
      {title && <h3>{title}</h3>}
      {children}
      {actions && <footer>{actions}</footer>}
    </section>
  );
}
export function Stat({ label, value, detail }) {
  return (
    <div className="ui-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
export function Toggle({ label, checked, onChange }) {
  return (
    <label className="ui-toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
export function Brand() {
  return (
    <span className="ui-brand" aria-label="写作 Agent">
      写
    </span>
  );
}

export function Dialog({ open = true, title, className = "", onClose, children }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const node = ref.current;
    if (open) node.showModal();
    else node.close();
    return () => node.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`ui-dialog ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
