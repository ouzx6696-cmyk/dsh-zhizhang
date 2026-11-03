import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import { Dialog } from "../../../../../../packages/ui/src/primitives";
import React from "react";
import { Search, ArrowRight } from "lucide-react";
import { COMMANDS } from "../../../commands";
import type { DesktopController } from "../../app/useDesktopController";

export function CommandPalette({ app }: { app: DesktopController }) {
  const { state, fail, set } = app;
  return (
    <Dialog
      title={viewCopy.commandPaletteText1}
      className="command-dialog"
      onClose={() => set({ palette: false })}
    >
      <label className="command-search">
        <Search size={18} />
        <input
          autoFocus
          placeholder={viewCopy.commandPaletteText2}
          value={state.query}
          onChange={(event) => set({ query: event.target.value })}
        />
      </label>
      <div className="command-list">
        {COMMANDS.filter(
          (item) =>
            item.palette !== false &&
            (!state.query ||
              item.id.includes(state.query.split(/\s+/)[0].replace(/^\//, "")) ||
              item.label.includes(state.query)),
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
    </Dialog>
  );
}
