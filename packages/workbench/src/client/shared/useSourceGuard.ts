/** One mounted editor, using the same leave policy as the existing workbench. */
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmAction } from "./confirm.js";

const LEAVE_MESSAGE = "有未保存修改，离开将放弃这些修改。是否继续？";

export interface EditorGuardSnapshot {
  dirty: boolean;
  saving: boolean;
  discard: () => void;
}

export type LeaveState = "clean" | "dirty" | "saving";

/** What leaving an editor takes: "saving" blocks it, "dirty" needs the author's word. */
export function leaveState(
  current: Pick<EditorGuardSnapshot, "dirty" | "saving"> | null | undefined,
): LeaveState {
  return current?.saving ? "saving" : current?.dirty ? "dirty" : "clean";
}

/**
 * Saving blocks leaving; unsaved changes need the author's word through `ask`.
 */
export function canLeaveEdit(
  current: Pick<EditorGuardSnapshot, "dirty" | "saving"> | null | undefined,
  ask: (message: string) => Promise<boolean> | boolean,
  blocked: () => void = () => {},
): Promise<boolean> | boolean {
  if (current?.saving) {
    blocked();
    return false;
  }
  return !current?.dirty || ask(LEAVE_MESSAGE);
}

export function useSourceGuard(onEditState?: (value: EditorGuardSnapshot | null) => void) {
  const editor = useRef<EditorGuardSnapshot | null>(null);
  const sink = useRef(onEditState);
  sink.current = onEditState;
  const [state, setState] = useState({ dirty: false, saving: false });

  const report = useCallback((value: EditorGuardSnapshot | null) => {
    editor.current = value;
    setState((previous) =>
      previous.dirty === !!value?.dirty && previous.saving === !!value?.saving
        ? previous
        : { dirty: !!value?.dirty, saving: !!value?.saving },
    );
    sink.current?.(value);
  }, []);

  const close = useCallback(() => {
    editor.current?.discard();
    report(null);
  }, [report]);

  const editorState = useCallback(() => leaveState(editor.current), []);

  const canLeave = useCallback(async () => {
    if (
      leaveState(editor.current) !== "clean" &&
      !(await canLeaveEdit(editor.current, confirmAction))
    ) {
      return false;
    }
    close();
    return true;
  }, [close]);

  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (leaveState(editor.current) !== "clean") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);

  return { ...state, report, editorState, close, canLeave };
}
