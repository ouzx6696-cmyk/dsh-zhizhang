import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
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

const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';

/**
 * 菜单：打开即把焦点移到第一项；↑/↓/Home/End 漫游，Esc 关闭并把焦点还给打开它的元素。
 * 点在 `.zz-menu-root`（触发按钮与菜单的共同容器）内不算“点外面”，避免先关后开。
 */
export function Menu({ label, items, open = true, className, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !onClose) return undefined;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handlePointer = (event: MouseEvent) => {
      const target = event.target;
      const root = ref.current?.closest(".zz-menu-root") ?? ref.current;
      if (root && target instanceof Node && !root.contains(target)) onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handlePointer);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handlePointer);
    };
  }, [open, onClose]);

  if (!open) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    if (!list.length) return;
    const at = list.indexOf(
      document.activeElement instanceof HTMLElement ? document.activeElement : list[0],
    );
    const pick =
      event.key === "ArrowDown"
        ? list[(at + 1) % list.length]
        : event.key === "ArrowUp"
          ? list[(at - 1 + list.length) % list.length]
          : event.key === "Home"
            ? list[0]
            : event.key === "End"
              ? list[list.length - 1]
              : null;
    if (!pick) return;
    event.preventDefault();
    pick.focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={menuClasses({ open, className })}
      onKeyDown={onKeyDown}
    >
      {items.map((item) =>
        item.separator ? (
          <div key={item.id} role="separator" className="zz-menu__separator" />
        ) : item.heading ? (
          <div key={item.id} role="presentation" className="zz-menu__heading">
            {item.label}
          </div>
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
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
