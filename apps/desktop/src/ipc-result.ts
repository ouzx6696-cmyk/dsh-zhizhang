import type { IpcArgs, IpcChannel, IpcResult } from "./main/ipc/contract";
import type { DesktopEvent } from "./renderer-contracts";

export type IpcReply<T> =
  { ok: true; value: T } | { ok: false; error: { name: string; message: string; code?: string } };

export interface DesktopBridge {
  invoke<K extends IpcChannel>(name: K, ...args: IpcArgs<K>): Promise<IpcReply<IpcResult<K>>>;
  subscribe(callback: (event: DesktopEvent) => void): () => void;
}

export function ipcFailure(error: unknown): IpcReply<never> {
  return {
    ok: false,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && "code" in error && typeof error.code === "string"
        ? { code: error.code }
        : {}),
    },
  };
}

/** Rebuild errors in the caller's world, after both Electron serialization boundaries. */
export function unwrapIpcReply<T>(reply: IpcReply<T>): T {
  if (reply.ok) return reply.value;
  throw Object.assign(new Error(reply.error.message), {
    name: reply.error.name,
    ...(reply.error.code ? { code: reply.error.code } : {}),
  });
}
