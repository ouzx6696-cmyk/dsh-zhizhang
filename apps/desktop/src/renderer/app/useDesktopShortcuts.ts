import { errorText } from "../../../../../packages/core/src/errors.js";
import { notify } from "@writer/ui/notify";
import { useEffect } from "react";
import type { Target } from "../../context";
import { chatStore } from "../state/chatStore";
import { askConfirm } from "../state/confirm";
import { desktopStore } from "../state/store";

const set = desktopStore.set;
const TABS = ["agent", "chapter", "methods"];

export function useDesktopShortcuts({
  selected,
  stop,
}: {
  selected: { current: Target | null };
  stop: (target?: Target) => Promise<void>;
}) {
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      const mod = event.ctrlKey || event.metaKey,
        key = event.key.toLowerCase();
      if (mod && key === "k") {
        event.preventDefault();
        set((current) => ({ palette: !current.palette }));
      }
      if (mod && key === "s") {
        event.preventDefault();
        void desktopStore.get().context.actions?.saveParagraph?.();
      }
      if (mod && ["1", "2", "3"].includes(event.key)) {
        event.preventDefault();
        set({ tab: TABS[Number(event.key) - 1], drawer: true });
      }
      if (event.key === "Escape") {
        const current = desktopStore.get();
        if (current.palette) {
          set({ palette: false });
          return;
        }
        if (current.settingsOpen) {
          set({ settingsOpen: false });
          return;
        }
        if (chatStore.get().busy) {
          event.preventDefault();
          void askConfirm("停止当前任务？已保存的稿件不会撤销。").then((ok) => {
            if (ok)
              void stop(selected.current || undefined).catch((error) =>
                notify({ tone: "danger", text: errorText(error) }),
              );
          });
        } else set({ drawer: false });
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [selected, stop]);
}
