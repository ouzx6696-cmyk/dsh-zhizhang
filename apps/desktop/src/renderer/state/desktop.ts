import { unwrapReply, type DesktopBridge, type IpcArgs, type IpcChannel, type IpcResult } from "../../shared/ipc";

function bridge(): DesktopBridge {
  if (!window.zhizhangBridge) {
    throw new Error("Desktop bridge is not initialized");
  }
  return window.zhizhangBridge;
}

async function invoke<K extends IpcChannel>(channel: K, ...args: IpcArgs<K>): Promise<IpcResult<K>> {
  return unwrapReply(await bridge().invoke(channel, ...args));
}

export const desktop = {
  invoke,
  subscribe: (cb: Parameters<DesktopBridge["subscribe"]>[0]) => bridge().subscribe(cb),
  workbench: <K extends import("@zhizhang/workbench/contract").WorkbenchCommand>(
    command: K,
    input: import("@zhizhang/workbench/contract").CommandInput<K>,
  ) => invoke("workbench.call", { command, input }),
  workflowStart: (target: import("../../shared/ipc").Target, kind: string, request: unknown) =>
    invoke("workflow.start", target, { kind, request }),
  workflowControl: (ref: import("../../shared/ipc").RunRef, action: "pause" | "resume" | "stop" | "retry") =>
    invoke("workflow.control", ref, action),
  getSettings: () => invoke("settings.get"),
  saveSettings: (settings: unknown) => invoke("settings.save", settings),
} as unknown as Record<string, (...args: never[]) => Promise<unknown>> & {
  subscribe: DesktopBridge["subscribe"];
};

export type DesktopApi = typeof desktop;
