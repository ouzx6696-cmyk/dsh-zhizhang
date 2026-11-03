import React from "react";

export function Button({ variant = "secondary", className = "", children, ...props }) {
  return (
    <button type="button" {...props} className={`ui-button ui-button-${variant} ${className}`}>
      {children}
    </button>
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

/** @param {{open?:boolean,title:string,className?:string,onClose:()=>void,children?:React.ReactNode,closeLabel?:string,description?:React.ReactNode,footer?:React.ReactNode}} props */
export function Dialog({
  open = true,
  title,
  className = "",
  onClose,
  children,
  closeLabel,
  description,
  footer,
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const node = ref.current;
    if (open) node.showModal();
    else node.close();
    return () => node.close();
  }, [open]);
  const framed = closeLabel !== undefined || description !== undefined || footer !== undefined;
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`ui-dialog ${framed ? "wb-modal" : ""} ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      {framed ? (
        <>
          <div className="wb-modal-content">
            <div className="wb-modal-header">
              <h2 className="wb-modal-title">{title}</h2>
              <button
                type="button"
                className="wb-icon-button"
                aria-label={closeLabel}
                onClick={onClose}
              >
                ×
              </button>
            </div>
            {description ? <p className="wb-modal-description">{description}</p> : null}
            <div className="wb-modal-body">{children}</div>
          </div>
          {footer !== undefined ? <div className="wb-modal-footer">{footer}</div> : null}
        </>
      ) : (
        children
      )}
    </dialog>
  );
}
