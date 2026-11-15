import { AppError, type ErrorCode } from "@zhizhang/core/errors";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import type { DesktopEvent } from "./events.js";

export interface Target {
  mode: "fanqie" | "toutiao";
  path: string;
  subId?: string;
}

export interface RunRef {
  runId: string;
  target: Target;
}

export interface WorkspaceStatus {
  root: string;
  readonly: boolean;
  owner?: string;
}

export type Reply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ErrorCode; message: string; data?: unknown } };

export interface IpcMap {
  "workbench.call": {
    args: [{ command: WorkbenchCommand; input: CommandInput<WorkbenchCommand> }];
    result: CommandResult<WorkbenchCommand>;
  };
  "workflow.start": {
    args: [Target, { kind: string; request: unknown }];
    result: RunRef;
  };
  "workflow.control": {
    args: [RunRef, "pause" | "resume" | "stop" | "retry"];
    result: void;
  };
  "settings.get": { args: []; result: unknown };
  "settings.save": { args: [unknown]; result: void };
  "workspace.status": { args: []; result: WorkspaceStatus };
  "workspace.pick": { args: [{ title?: string; defaultPath?: string }?]; result: string | null };
  "dialog.saveFile": {
    args: [{ title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }?];
    result: string | null;
  };
  "app.info": { args: []; result: { version: string; userData: string } };
}

export type IpcChannel = keyof IpcMap;
export type IpcArgs<K extends IpcChannel> = IpcMap[K]["args"];
export type IpcResult<K extends IpcChannel> = IpcMap[K]["result"];

export interface DesktopBridge {
  invoke<K extends IpcChannel>(channel: K, ...args: IpcArgs<K>): Promise<Reply<IpcResult<K>>>;
  subscribe(callback: (event: DesktopEvent) => void): () => void;
}

export function unwrapReply<T>(reply: Reply<T>): T {
  if (reply.ok) return reply.value;
  throw new AppError(reply.error.code, reply.error.message, reply.error.data);
}
