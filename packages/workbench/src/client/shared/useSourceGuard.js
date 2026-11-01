/** One mounted editor, using the same leave policy as the existing workbench. */
import { useCallback, useEffect, useRef, useState } from "react";

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
    if (current?.saving) return false;
    if (current?.dirty && !window.confirm("正文有未保存修改，离开将放弃这些修改。是否继续？"))
      return false;
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
