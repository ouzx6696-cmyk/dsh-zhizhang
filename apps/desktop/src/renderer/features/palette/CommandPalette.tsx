import React from "react";
import { Search, ArrowRight } from "lucide-react";
import { COMMANDS } from "../../../commands";
import type { DesktopController } from "../../app/useDesktopController";

export function CommandPalette({ app }: { app: DesktopController }) {
  const { state, fail, set } = app;
  return (
    <div className="studio-backdrop command-backdrop" onClick={() => set({ palette: false })}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onClick={(event) => event.stopPropagation()}
      >
        <label className="command-search">
          <Search size={18} />
          <input
            autoFocus
            placeholder="输入命令或任务附言…"
            value={state.query}
            onChange={(event) => set({ query: event.target.value })}
          />
        </label>
        <div className="command-list">
          {COMMANDS.filter(
            (item) =>
              !state.query ||
              item.id.includes(state.query.split(/\s+/)[0].replace(/^\//, "")) ||
              item.label.includes(state.query),
          ).map((item) => (
            <button
              key={item.id}
              onClick={() =>
                app.command(item.id, state.query.split(/\s+/).slice(1).join(" ")).catch(fail)
              }
            >
              <span>
                <strong>/{item.id}</strong>
                <small>{item.hint}</small>
              </span>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
