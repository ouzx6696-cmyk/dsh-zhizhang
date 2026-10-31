import { contextBridge, ipcRenderer } from "electron";
const invoke = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke("writer:" + name, ...args);
contextBridge.exposeInMainWorld("writerDesktop", {
  select: (target: unknown) => invoke("select", target),
  view: (target: unknown, limit?: number) => invoke("view", target, limit),
  running: () => invoke("running"),
  profiles: () => invoke("profiles"),
  state: () => invoke("state"),
  choose: (mode: string) => invoke("choose", mode),
  model: (value: unknown) => invoke("model", value),
  request: (operation: string, options: unknown) =>
    invoke("request", operation, options),
  send: (text: string, target: unknown, focus: unknown) =>
    invoke("send", text, target, focus),
  stop: (target: unknown) => invoke("stop", target),
  subscribe: (callback: (value: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on("writer:event", listener);
    return () => ipcRenderer.removeListener("writer:event", listener);
  },
});
