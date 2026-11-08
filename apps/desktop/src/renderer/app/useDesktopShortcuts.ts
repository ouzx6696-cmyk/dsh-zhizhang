import { errorText } from "../../../../../packages/core/src/errors.js";
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { Target } from "../../context";
import type { WorkspaceContext } from "../../renderer-contracts";
import { chatStore } from "../state/chatStore";
import { askConfirm } from "../state/confirm";
import { desktopStore, type DesktopState } from "../state/store";

type Set = (
  patch: Partial<DesktopState> | ((state: DesktopState) => Partial<DesktopState>),
) => void;

export function useDesktopShortcuts(options: {
  selected: MutableRefObject<Target | null>;
  context: MutableRefObject<WorkspaceContext>;
  set: Set;
  stop: (target?: Target) => Promise<void>;
}) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      const { selected, context, set, stop } = latest.current;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        set((current) => ({ palette: !current.palette }));
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void context.current.actions?.saveParagraph?.();
      }
      if ((event.ctrlKey || event.metaKey) && ["1", "2", "3"].includes(event.key)) {
        event.preventDefault();
        set({ tab: ["agent", "chapter", "methods"][Number(event.key) - 1], drawer: true });
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
                set({ error: errorText(error) }),
              );
          });
        } else set({ drawer: false });
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
}
