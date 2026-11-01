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
    if (sourceEdit.current?.saving || methodEdit.current.saving) {
      showError("修改正在保存，请稍后再切换。");
      return false;
    }
    const unsaved = [
      sourceEdit.current?.dirty ? "正文" : focused.current.dirty && "段落",
      methodEdit.current.dirty && "方法方案",
    ].filter(Boolean);
    if (
      unsaved.length &&
      !window.confirm(`当前${unsaved.join("和")}有未保存修改，离开将放弃这些修改。是否继续？`)
    )
      return false;
    return true;
  }
  return {
    canLeave,
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
