import React, { useEffect, useId, useRef, useState } from "react";
import { COPY } from "@zhizhang/ui/copy";
import { Button } from "@zhizhang/ui/primitives";
import { useDesktop } from "../../state/store";

import { trackPlanEdit } from "../../state/controller";
export function usePlanDirty(dirty: boolean, discard: () => void) {
  const id = useId(),
    action = useRef(discard);
  action.current = discard;
  useEffect(() => {
    trackPlanEdit(id, dirty ? () => action.current() : undefined);
    return () => trackPlanEdit(id);
  }, [id, dirty]);
}
export const P = COPY;
export function browserId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let n = 0n;
  for (const byte of bytes) n = (n << 8n) | BigInt(byte);
  let result = "";
  for (let i = 0; i < 8; i++) {
    result = "0123456789abcdefghjkmnpqrstvwxyz"[Number(n & 31n)] + result;
    n >>= 5n;
  }
  return `${prefix}-${result}`;
}
export function usePlanResource<T>(
  load: () => Promise<T>,
  work: string,
  frozen = false,
  scope = "all",
) {
  const revisions = useDesktop((state) => state.revisions);
  const [value, setValue] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  const refresh = () => setVersion((value) => value + 1);
  useEffect(() => {
    if (frozen) return;
    let alive = true;
    setLoading(true);
    setError("");
    loader
      .current()
      .then((result) => {
        if (alive) setValue(result);
      })
      .catch((error: unknown) => {
        if (alive) setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [work, version, revisions, frozen, scope]);
  return { value, error, loading, refresh };
}
export function ResourceState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  if (error)
    return (
      <div role="alert">
        <p>{error}</p>
        <Button onClick={retry}>{P["plan.retry"]}</Button>
      </div>
    );
  if (loading) return <p role="status">{P["plan.loading"]}</p>;
  return null;
}
export function TextField({
  label,
  value,
  onChange,
  multiline = false,
  testId,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <label className="zz-plan-field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          data-testid={testId}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          data-testid={testId}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}
