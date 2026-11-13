import { COPY as viewCopy } from "@writer/ui/copy";
import { Dialog } from "@writer/ui/primitives";
import React, { useState } from "react";
import { Search, ArrowRight } from "lucide-react";
import { COMMANDS } from "../../../commands";
import type { DesktopActions } from "../../app/useDesktopController";
import { desktopStore, useDesktopSelector } from "../../state/store";

const STEP: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

export function CommandPalette({ actions }: { actions: DesktopActions }) {
  const { fail } = actions;
  const mode = useDesktopSelector((state) => state.selected?.mode);
  // 查询词只属于面板：面板按需挂载，每次打开自然清空，敲键也不触发全局重渲染。
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [head = "", ...rest] = query.trim().split(/\s+/);
  const name = head.replace(/^\//, "");
  const items = COMMANDS.filter(
    (item) =>
      item.palette !== false &&
      (!mode || !item.modes || item.modes.includes(mode)) &&
      (!query || item.id.includes(name) || item.label.includes(query)),
  );
  const index = Math.min(active, items.length - 1);
  const run = (id: string) => void actions.command(id, rest.join(" ")).catch(fail);
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || !items.length) return;
    const step = STEP[event.key];
    if (step) {
      event.preventDefault();
      setActive((index + step + items.length) % items.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : items.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(items[index].id);
    }
  };
  return (
    <Dialog
      title={viewCopy.commandPaletteText1}
      className="command-dialog"
      onClose={() => desktopStore.set({ palette: false })}
    >
      <label className="command-search">
        <Search size={18} />
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="command-list"
          aria-activedescendant={index >= 0 ? "command-" + items[index].id : undefined}
          placeholder={viewCopy.commandPaletteText2}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      <div className="command-list" id="command-list" role="listbox">
        {items.map((item, i) => (
          <button
            key={item.id}
            id={"command-" + item.id}
            role="option"
            aria-selected={i === index}
            tabIndex={-1}
            onMouseEnter={() => setActive(i)}
            onClick={() => run(item.id)}
          >
            <span>
              <strong>/{item.id}</strong>
              <small>{item.hint}</small>
            </span>
            <ArrowRight size={15} />
          </button>
        ))}
      </div>
    </Dialog>
  );
}
