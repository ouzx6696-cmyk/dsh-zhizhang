import { useCallback, useState } from "react";
import { newRequestId } from "./request.js";
export function useNotices() {
  const [notices, setNotices] = useState([]);
  const push = useCallback((tone, text) => {
    const id = newRequestId("notice");
    setNotices((previous) =>
      previous
        .filter((row) => row.text !== text)
        .concat({ id, tone, text })
        .slice(-3),
    );
  }, []);
  const dismiss = useCallback(
    (id) => setNotices((previous) => previous.filter((row) => row.id !== id)),
    [],
  );
  const clear = useCallback(() => setNotices([]), []);
  return { notices, push, dismiss, clear };
}
