import { useCallback, useEffect, useRef } from "react";

/** A response may commit only while its scope is mounted and its request is still the newest. */
export function useRequestGuard(scope: unknown) {
  const latest = useRef({ scope, generation: 0, mounted: true });
  if (latest.current.scope !== scope) latest.current = { scope, generation: 0, mounted: true };
  useEffect(() => {
    const current = latest.current;
    current.mounted = true;
    return () => {
      current.mounted = false;
      current.generation++;
    };
  }, [scope]);
  return useCallback(() => {
    const current = latest.current;
    const generation = ++current.generation;
    return () => latest.current === current && current.mounted && current.generation === generation;
  }, []);
}
