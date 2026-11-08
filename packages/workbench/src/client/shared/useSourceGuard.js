/** One mounted editor, using the same leave policy as the existing workbench. */
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmAction } from "./confirm.js";

const LEAVE_MESSAGE = "有未保存修改，离开将放弃这些修改。是否继续？";

/** What leaving an editor takes: "saving" blocks it, "dirty" needs the author's word. */
export function leaveState(current) {
  return current?.saving ? "saving" : current?.dirty ? "dirty" : "clean";
}

/**
 * Saving blocks leaving; unsaved changes need the author's word through `ask`. Returns what `ask`
 * returns when it is asked, so workbench callers `await` it with `confirmAction`.
 */
export function canLeaveEdit(current, ask, blocked = () => {}) {
  if (current?.saving) {
    blocked();
    return false;
  }
  return !current?.dirty || ask(LEAVE_MESSAGE);
}

export function useSourceGuard(onEditState) {
  const editor = useRef(null);
  const sink = useRef(onEditState);
  sink.current = onEditState;
  const [state, setState] = useState({ dirty: false, saving: false });
  const report = useCallback((value) => {
    editor.current = value;
    setState((previous) =>
      previous.dirty === !!value?.dirty && previous.saving === !!value?.saving
        ? previous
        : { dirty: !!value?.dirty, saving: !!value?.saving },
    );
    sink.current?.(value);
  }, []);
  /** Closes a clean editor right away (no await), so navigation without edits stays synchronous. */
  const close = useCallback(() => {
    editor.current?.discard();
    report(null);
  }, [report]);
  const editorState = useCallback(() => leaveState(editor.current), []);
  const canLeave = useCallback(async () => {
    if (
      leaveState(editor.current) !== "clean" &&
      !(await canLeaveEdit(editor.current, confirmAction))
    )
      return false;
    close();
    return true;
  }, [close]);
  useEffect(() => {
    const leave = (event) => {
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
