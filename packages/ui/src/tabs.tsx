import React from "react";
import "./styles/tabs.css";

export interface TabItem {
  id: string;
  label: React.ReactNode;
  disabled?: boolean;
}

const tabId = (base: string, tab: string) => `${base}-tab-${tab}`;
const panelId = (base: string, tab: string) => `${base}-panel-${tab}`;

/**
 * 与 TabList 同一 id 前缀的面板属性：读屏把面板与它的标签页关联起来。
 * 面板里没有可聚焦元素时，调用方另加 tabIndex={0}，让键盘能进入面板。
 */
export function tabPanelProps(base: string, tab: string, value: string) {
  return {
    id: panelId(base, tab),
    role: "tabpanel",
    "aria-labelledby": tabId(base, tab),
    hidden: tab !== value,
  } as const;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 };

/**
 * 标签页列表（WAI-ARIA tabs，选中即激活）：只有当前标签在 Tab 键序里（roving tabindex），
 * ←/→（竖排时 ↑/↓）切换并移动焦点，Home/End 跳到首尾，跳过禁用项。
 */
export function TabList({
  id,
  label,
  items,
  value,
  onChange,
  orientation = "horizontal",
  className = "",
}: {
  /** 标签与面板 id 的共同前缀；面板用 tabPanelProps(id, tab, value)。 */
  id: string;
  label: string;
  items: TabItem[];
  value: string;
  onChange: (tab: string) => void;
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  const enabled = items.filter((item) => !item.disabled);
  const select = (tab: string) => {
    onChange(tab);
    document.getElementById(tabId(id, tab))?.focus();
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    const at = enabled.findIndex((item) => item.id === value);
    const step = STEP[event.key];
    const vertical = event.key === "ArrowDown" || event.key === "ArrowUp";
    let next: TabItem | undefined;
    if (step && vertical === (orientation === "vertical")) {
      const from = at < 0 ? (step > 0 ? -1 : enabled.length) : at;
      next = enabled[(from + step + enabled.length) % enabled.length];
    } else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    select(next.id);
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation={orientation}
      className={`ui-tabs ${className}`}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          type="button"
          role="tab"
          key={item.id}
          id={tabId(id, item.id)}
          aria-selected={item.id === value}
          aria-controls={panelId(id, item.id)}
          tabIndex={item.id === value ? 0 : -1}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
