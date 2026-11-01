/** One mounted editor, using the same leave policy as the existing workbench. */
import { useCallback, useEffect, useRef, useState } from "react";

export function canLeaveEdit(current, confirm, blocked = () => {}) {
  if (current?.saving) {
    blocked();
    return false;
  }
  return !current?.dirty || confirm("有未保存修改，离开将放弃这些修改。是否继续？");
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
  const canLeave = useCallback(() => {
    const current = editor.current;
    if (!canLeaveEdit(current, window.confirm)) return false;
    current?.discard();
    report(null);
    return true;
  }, [report]);
  useEffect(() => {
    const leave = (event) => {
      if (editor.current?.dirty || editor.current?.saving) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  return { ...state, report, canLeave };
}
