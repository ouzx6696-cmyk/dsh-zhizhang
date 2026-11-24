import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { DESKTOP_COPY } from "@zhizhang/ui/copy";
import { openSettings, select, startCreate } from "../../state/controller";
import { desktopStore, useDesktop } from "../../state/store";
import { run } from "../../format";

const C = DESKTOP_COPY;

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  detail?: string;
  action: () => void;
}

/** 全局命令面板（Ctrl/Cmd+K）：快速跳转作品、章节、视图与核心动作。 */
export function CommandPalette() {
  const open = useDesktop((s) => s.paletteOpen);
  const targets = useDesktop((s) => s.targets);
  const selected = useDesktop((s) => s.selected);
  const chapters = useDesktop((s) => s.chapters);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => desktopStore.set({ paletteOpen: false });

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [
      {
        id: "view-hub",
        group: C.palette.groupViews,
        label: C.topbar.viewHub,
        action: () => desktopStore.set({ view: "hub" }),
      },
      {
        id: "view-warehouse",
        group: C.palette.groupViews,
        label: C.topbar.viewWarehouse,
        action: () => desktopStore.set({ view: "warehouse" }),
      },
    ];
    if (selected) {
      out.push(
        {
          id: "view-writing",
          group: C.palette.groupViews,
          label: C.topbar.viewWriting,
          action: () => desktopStore.set({ view: "writing" }),
        },
        {
          id: "view-board",
          group: C.palette.groupViews,
          label: selected.target.mode === "toutiao" ? C.topbar.viewLedger : C.topbar.viewBoard,
          action: () => desktopStore.set({ view: "board" }),
        },
      );
      if (selected.target.mode === "fanqie") {
        out.push({
          id: "view-bible",
          group: C.palette.groupViews,
          label: C.topbar.viewBible,
          action: () => desktopStore.set({ view: "bible" }),
        });
      }
    }
    for (const ch of chapters) {
      out.push({
        id: `ch-${ch.id}`,
        group: C.palette.groupChapters,
        label: ch.title || ch.id,
        detail: ch.id,
        action: () => desktopStore.set({ view: "writing", jumpChapterId: ch.id }),
      });
    }
    for (const t of targets) {
      out.push({
        id: `target-${t.target.mode}-${t.target.path}`,
        group: C.palette.groupTargets,
        label: t.label,
        detail: t.kind === "work" ? C.topbar.works : C.topbar.articles,
        action: () => run(() => select(t.target)),
      });
    }
    out.push(
      {
        id: "act-new-work",
        group: C.palette.groupActions,
        label: C.palette.actionNewWork,
        action: () => startCreate("fanqie"),
      },
      {
        id: "act-new-article",
        group: C.palette.groupActions,
        label: C.palette.actionNewArticle,
        action: () => startCreate("toutiao"),
      },
      {
        id: "act-zen",
        group: C.palette.groupActions,
        label: C.palette.actionZen,
        action: () => desktopStore.set((s) => ({ zenMode: !s.zenMode })),
      },
      {
        id: "act-dock",
        group: C.palette.groupActions,
        label: C.palette.actionDock,
        action: () => desktopStore.set((s) => ({ dockOpen: !s.dockOpen })),
      },
      {
        id: "act-settings",
        group: C.palette.groupActions,
        label: C.palette.actionSettings,
        action: () => openSettings(),
      },
    );
    const q = query.trim().toLowerCase();
    if (!q) return out;
    return out.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.detail ?? "").toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q),
    );
  }, [targets, selected, chapters, query]);

  if (!open) return null;

  const safeIndex = Math.min(activeIndex, Math.max(0, items.length - 1));
  const execute = (item: PaletteItem | undefined) => {
    if (!item) return;
    close();
    item.action();
  };

  return (
    <div
      className="zz-palette-backdrop"
      data-testid="command-palette"
      role="dialog"
      aria-modal="true"
      aria-label={C.palette.label}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="zz-palette">
        <div className="zz-palette__input-row">
          <Search size={15} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="zz-palette__input"
            data-testid="palette-input"
            aria-label={C.palette.label}
            placeholder={C.palette.placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((idx) => (items.length ? (idx + 1) % items.length : 0));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((idx) =>
                  items.length ? (idx - 1 + items.length) % items.length : 0,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                execute(items[safeIndex]);
              }
            }}
          />
        </div>
        <ul className="zz-palette__list" role="listbox" aria-label={C.palette.label}>
          {items.length ? (
            items.slice(0, 14).map((item, idx) => (
              <li key={item.id} role="option" aria-selected={idx === safeIndex}>
                <button
                  type="button"
                  className="zz-palette__item"
                  data-active={idx === safeIndex}
                  data-testid={`palette-item-${item.id}`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => execute(item)}
                >
                  <span className="zz-palette__group">{item.group}</span>
                  <span className="zz-palette__label">{item.label}</span>
                  {item.detail ? <span className="zz-palette__detail">{item.detail}</span> : null}
                </button>
              </li>
            ))
          ) : (
            <li className="zz-palette__empty">{C.palette.empty}</li>
          )}
        </ul>
        <footer className="zz-palette__foot">{C.palette.shortcutHint}</footer>
      </div>
    </div>
  );
}
