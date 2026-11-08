import { canLeaveEdit } from "../../../../../packages/workbench/src/client/shared/useSourceGuard.js";
import type { Focus } from "../../context";
import type { SourceEditState } from "../../renderer-contracts";
import { askConfirm } from "../state/confirm";

/** Shared leave decision for the existing paragraph, source and method editors. */
export function createDraftProtection(
  focused: { current: Focus },
  showError: (message: string) => void,
) {
  let methodEdit = { dirty: false, saving: false };
  let sourceEdit: SourceEditState | null = null;
  const saving = () => !!sourceEdit?.saving || methodEdit.saving;
  const dirty = () => !!sourceEdit?.dirty || !!focused.current.dirty || methodEdit.dirty;
  return {
    /** 有未保存修改时用桌面确认框询问（不阻塞渲染线程）；正在保存时直接拦下并提示。 */
    async canLeave(): Promise<boolean> {
      return await canLeaveEdit({ saving: saving(), dirty: dirty() }, askConfirm, () =>
        showError("修改正在保存，请稍后再切换。"),
      );
    },
    canRestart() {
      if (saving() || dirty()) {
        showError("请先保存或放弃当前修改，再安装更新。");
        return false;
      }
      return true;
    },
    discardSource() {
      const current = sourceEdit;
      sourceEdit = null;
      current?.discard();
    },
    trackMethodEdit(value: { dirty: boolean; saving: boolean }) {
      methodEdit = value;
    },
    trackSourceEdit(value: SourceEditState | null) {
      sourceEdit = value;
    },
  };
}
