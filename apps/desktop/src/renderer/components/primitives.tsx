import { COPY } from "@zhizhang/ui/copy";
import React, { useEffect, useRef } from "react";
import {
  buttonClasses,
  cx,
  dialogClasses,
  progressRailClasses,
  progressStepState,
  toggleClasses,
  type ButtonProps,
  type DialogProps,
  type ProgressRailProps,
  type ToggleProps,
} from "@zhizhang/ui/primitives";

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cx("ui-brand", className)} aria-hidden="true">
      {COPY["app.name"].slice(0, 1)}
    </span>
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  disabled,
  loading,
  type = "button",
  className,
  onClick,
  children,
}: ButtonProps & { children?: React.ReactNode }) {
  const variantClass =
    variant === "primary"
      ? "ui-button-primary"
      : variant === "danger"
        ? "ui-button-danger"
        : undefined;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx("ui-button", variantClass, buttonClasses({ variant, size, className }))}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Card({
  title,
  className,
  children,
  footer,
}: {
  title?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className={cx("ui-card", className)}>
      {title && <h3>{title}</h3>}
      {children}
      {footer && <footer>{footer}</footer>}
    </section>
  );
}

export function Stat({
  label,
  value,
  detail,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("ui-stat", className)}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export function Steps({ steps, current, label, className }: ProgressRailProps) {
  return (
    <ol className={cx("ui-steps", progressRailClasses({ className }))} aria-label={label}>
      {steps.map((step, index) => {
        const text = typeof step === "string" ? step : step.label;
        const key = typeof step === "string" ? `${index}-${step}` : step.id;
        return (
          <li key={key} data-state={progressStepState(index, current)}>
            <span>{index + 1}</span>
            {text}
          </li>
        );
      })}
    </ol>
  );
}

export function Toggle({
  label,
  checked,
  disabled,
  description,
  className,
  onChange,
}: Omit<ToggleProps, "label" | "description"> & {
  label: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <label className={cx("ui-toggle", toggleClasses({ disabled, className }))}>
      <span>
        {label}
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export function Dialog({
  open = true,
  title,
  size = "md",
  footer,
  className,
  onClose,
  children,
}: Omit<DialogProps, "children" | "footer"> & {
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal?.();
    } else if (!open && el.open) {
      el.close?.();
    }
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      open={open}
      aria-label={title}
      className={cx("ui-dialog", dialogClasses({ size, className }))}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {children}
      {footer && <footer>{footer}</footer>}
    </dialog>
  );
}
