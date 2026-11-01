import React from "react";
import { statusInfo, type StatusMode } from "./status";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "text" | "icon";
  size?: "sm" | "md";
}) {
  return (
    <button
      {...props}
      className={["ui-button", `ui-button--${variant}`, `ui-button--${size}`, className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

export function StatusBadge({
  mode,
  status,
  className,
}: {
  mode: StatusMode;
  status?: string;
  className?: string;
}) {
  const info = statusInfo(mode, status);
  return (
    <span
      className={["ui-badge", className].filter(Boolean).join(" ")}
      data-tone={info.tone}
    >
      {info.label}
    </span>
  );
}

export function Card({
  title,
  aside,
  children,
  className,
}: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={["ui-card", className].filter(Boolean).join(" ")}>
      {(title || aside) && (
        <header className="ui-card-head">
          {title && <h3>{title}</h3>}
          {aside && <div className="ui-card-aside">{aside}</div>}
        </header>
      )}
      <div className="ui-card-body">{children}</div>
    </section>
  );
}

export function Tabs({
  items,
  value,
  onChange,
  label,
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div className="ui-tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={value === item.id}
          className="ui-tab"
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Toast({
  tone = "neutral",
  children,
  onDismiss,
}: {
  tone?: "neutral" | "success" | "warn" | "danger";
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className="ui-toast" data-tone={tone} role="status">
      <span>{children}</span>
      {onDismiss && (
        <button className="ui-button ui-button--icon ui-button--sm" aria-label="关闭提示" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}

export function ToastStack({ children }: { children?: React.ReactNode }) {
  return <div className="ui-toast-stack">{children}</div>;
}
