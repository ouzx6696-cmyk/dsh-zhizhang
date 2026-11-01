import { canLeaveEdit } from "../../../../../packages/workbench/src/client/shared/useSourceGuard.js";
import { useRef, type MutableRefObject } from "react";
import type { Focus } from "../../context";
import type { SourceEditState } from "../../renderer-contracts";

/** Shared leave decision for the existing paragraph, source and method editors. */
export function useDraftProtection(
  focused: MutableRefObject<Focus>,
  showError: (message: string) => void,
) {
  const methodEdit = useRef({ dirty: false, saving: false });
  const sourceEdit = useRef<SourceEditState | null>(null);
  function canLeave() {
    return canLeaveEdit(
      {
        saving: !!sourceEdit.current?.saving || methodEdit.current.saving,
        dirty: !!sourceEdit.current?.dirty || !!focused.current.dirty || methodEdit.current.dirty,
      },
      window.confirm,
      () => showError("修改正在保存，请稍后再切换。"),
    );
  }
  return {
    canLeave,
    canRestart() {
      if (
        sourceEdit.current?.saving ||
        methodEdit.current.saving ||
        sourceEdit.current?.dirty ||
        methodEdit.current.dirty ||
        focused.current.dirty
      ) {
        showError("请先保存或放弃当前修改，再安装更新。");
        return false;
      }
      return true;
    },
    discardSource() {
      const current = sourceEdit.current;
      sourceEdit.current = null;
      current?.discard();
    },
    trackMethodEdit(value: { dirty: boolean; saving: boolean }) {
      methodEdit.current = value;
    },
    trackSourceEdit(value: SourceEditState | null) {
      sourceEdit.current = value;
    },
  };
}
