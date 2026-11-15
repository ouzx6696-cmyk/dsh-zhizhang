import { useEffect, useRef } from "react";
import { Spinner } from "./feedback.js";
import {
  buttonClasses,
  cx,
  iconButtonClasses,
  menuClasses,
  type ButtonProps,
  type IconButtonProps,
  type MenuProps,
} from "./types.js";

export function Button({
  variant = "secondary",
  size = "md",
  disabled = false,
  loading = false,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || rest["aria-busy"] || undefined}
      className={buttonClasses({ variant, size, className })}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  disabled = false,
  pressed,
  type = "button",
  className,
  icon,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={rest.title ?? label}
      className={iconButtonClasses({ variant, size, className })}
    >
      {icon ?? children}
    </button>
  );
}

export function Menu({ label, items, open = true, className, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !onClose) return undefined;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handlePointer = (event: MouseEvent) => {
      const target = event.target;
      if (ref.current && target instanceof Node && !ref.current.contains(target)) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handlePointer);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handlePointer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div ref={ref} role="menu" aria-label={label} className={menuClasses({ open, className })}>
      {items.map((item) =>
        item.separator ? (
          <div key={item.id} role="separator" className="zz-menu__separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={cx("zz-menu__item", item.danger && "zz-menu__item--danger")}
            onClick={() => {
              item.onSelect?.();
              onClose?.();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut ? <kbd className="zz-menu__shortcut">{item.shortcut}</kbd> : null}
          </button>
        ),
      )}
    </div>
  );
}
