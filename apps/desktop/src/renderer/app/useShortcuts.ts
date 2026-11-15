import { useEffect } from "react";
import { desktopStore } from "../state/store";
import { openDock, openSettings } from "../state/controller";

/** 全局快捷键：Ctrl+, 设置；Ctrl+1/2/3 右栏标签；Ctrl+. 收起右栏。对话框打开时不处理。 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const tabs = { "1": "assistant", "2": "pipeline", "3": "chapter" } as const;
      if (event.key === ",") {
        event.preventDefault();
        openSettings();
      } else if (event.key === ".") {
        event.preventDefault();
        desktopStore.set((state) => ({ dockOpen: !state.dockOpen }));
      } else if (event.key === "1" || event.key === "2" || event.key === "3") {
        event.preventDefault();
        openDock(tabs[event.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
