import { contextBridge, ipcRenderer } from "electron";
const invoke = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke("writer:" + name, ...args);
contextBridge.exposeInMainWorld("writerDesktop", {
  workspace: () => invoke("workspace"),
  projects: () => invoke("projects"),
  newTarget: (mode: string) => invoke("new-target", mode),
  appearance: (next: unknown) => invoke("appearance", next),
  preferences: (text?: string) => invoke("preferences", text),
  search: (key: string) => invoke("search", key),
  testModel: (role: string, next: unknown) => invoke("test-model", role, next),
  newConversation: (target: unknown) => invoke("new-conversation", target),
  conversations: (target: unknown) => invoke("conversations", target),
  export: (target: unknown, focus: unknown, format: string) =>
    invoke("export", target, focus, format),
  backup: () => invoke("backup"),
  storageHealth: () => invoke("storage-health"),
  recover: (expected: unknown) => invoke("recover", expected),
  diagnostics: () => invoke("diagnostics"),
  updates: (action?: string) => invoke("updates", action),
  openExternal: (url: string) => invoke("external", url),
  select: (target: unknown) => invoke("select", target),
  view: (target: unknown, limit?: number, archive?: number) =>
    invoke("view", target, limit, archive),
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
