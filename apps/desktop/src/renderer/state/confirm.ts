import { useSyncExternalStore } from "react";

export type ConfirmRequest = {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type Pending = ConfirmRequest & { id: number; resolve: (value: boolean) => void };

let pending: Pending | null = null;
let sequence = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function askConfirm(request: ConfirmRequest | string): Promise<boolean> {
  const value = typeof request === "string" ? { message: request } : request;
  return new Promise((resolve) => {
    pending?.resolve(false);
    pending = { id: ++sequence, ...value, resolve };
    emit();
  });
}

export function settleConfirm(value: boolean) {
  const current = pending;
  if (!current) return;
  pending = null;
  emit();
  current.resolve(value);
}

export function useConfirmRequest() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
    () => pending,
  );
}
