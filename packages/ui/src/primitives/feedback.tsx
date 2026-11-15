import { useEffect, useRef } from "react";
import {
  cx,
  dialogClasses,
  emptyClasses,
  kbdClasses,
  noticeClasses,
  progressRailClasses,
  skeletonClasses,
  spinnerClasses,
  statusChipClasses,
  tagClasses,
  type DialogProps,
  type EmptyProps,
  type KbdProps,
  type NoticeProps,
  type ProgressRailProps,
  type SkeletonProps,
  type SpinnerProps,
  type StatusChipProps,
  type TagProps,
} from "./types.js";

export function Dialog({
  open = true,
  title,
  description,
  size = "md",
  closeLabel,
  footer,
  className,
  onClose,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      if (!el.open) {
        if (typeof el.showModal === "function") {
          el.showModal();
        } else {
          el.setAttribute("open", "");
        }
      }
    } else if (el.open) {
      if (typeof el.close === "function") {
        el.close();
      } else {
        el.removeAttribute("open");
      }
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={cx("ui-dialog", dialogClasses({ size, className }))}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          onClose();
        }
      }}
    >
      {closeLabel ? (
        <header className="zz-dialog__header">
          <h2 className="zz-dialog__title">{title}</h2>
          <button
            type="button"
            className="zz-icon-btn zz-btn--ghost zz-icon-btn--sm"
            aria-label={closeLabel}
            onClick={onClose}
          >
            ×
          </button>
        </header>
      ) : null}
      {description ? <p className="zz-dialog__desc">{description}</p> : null}
      {children}
      {footer ? <footer className="zz-dialog__footer">{footer}</footer> : null}
    </dialog>
  );
}

export function Tag({
  label,
  tone = "neutral",
  removable = false,
  className,
  onRemove,
}: TagProps) {
  return (
    <span className={tagClasses({ tone, className })}>
      <span>{label}</span>
      {removable ? (
        <button
          type="button"
          className="zz-tag__remove"
          aria-label="移除"
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export function StatusChip({ tone, label, dot = false, className }: StatusChipProps) {
  return (
    <span className={statusChipClasses({ tone, className })}>
      {dot ? <span className="zz-status-chip__dot" aria-hidden="true" /> : null}
      <span>{label}</span>
    </span>
  );
}

export function Notice({
  tone,
  variant = "inline",
  message,
  detail,
  actionLabel,
  onAction,
  onClose,
  className,
}: NoticeProps) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={noticeClasses({ tone, variant, className })}
    >
      <div className="zz-notice__body">
        <p className="zz-notice__message">{message}</p>
        {detail ? <p className="zz-notice__detail">{detail}</p> : null}
      </div>
      {actionLabel || onClose ? (
        <div className="zz-notice__actions">
          {actionLabel && onAction ? (
            <button type="button" className="zz-btn zz-btn--ghost zz-btn--sm" onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              className="zz-icon-btn zz-btn--ghost zz-icon-btn--sm"
              aria-label="关闭"
              onClick={onClose}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Empty({ title, description, icon, action, className }: EmptyProps) {
  return (
    <div className={emptyClasses({ className })}>
      {icon ? (
        <div className="zz-empty__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <div className="zz-empty__title">{title}</div>
      {description ? <div className="zz-empty__desc">{description}</div> : null}
      {action ? <div className="zz-empty__action">{action}</div> : null}
    </div>
  );
}

export function Skeleton({
  variant = "text",
  width,
  height,
  lines = 1,
  className,
}: SkeletonProps) {
  const style = {
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
  };

  if (variant === "text" && lines > 1) {
    return (
      <div className={cx("zz-skeleton-group", className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className={skeletonClasses({ variant })}
            style={{
              ...style,
              width: index === lines - 1 && !width ? "72%" : style.width,
            }}
          />
        ))}
      </div>
    );
  }

  return <span className={skeletonClasses({ variant, className })} style={style} aria-hidden="true" />;
}

export function Spinner({ size = "md", label = "加载中", className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={spinnerClasses({ size, className })}
    />
  );
}

export function ProgressRail({ steps, current, label, className }: ProgressRailProps) {
  const total = Math.max(steps.length, 1);
  const clamped = Math.min(Math.max(current + 1, 0), total);
  const percent = Math.round((clamped / total) * 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={clamped}
      className={progressRailClasses({ className })}
    >
      <div className="zz-progress-rail__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Kbd({ keys, className }: KbdProps) {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <span className={cx("zz-kbd-group", className)}>
      {list.map((key, index) => (
        <kbd key={`${index}-${key}`} className={kbdClasses()}>
          {key}
        </kbd>
      ))}
    </span>
  );
}
