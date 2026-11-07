import type { Target, Focus } from "./context";
import type { ModelConnection, ModelSettings, ModelsInput } from "./models";
import type { Appearance } from "./settings";
import type { DesktopEvent } from "./renderer-contracts";
import type { IpcArgs, IpcChannel, IpcResult, RequestOptions } from "./main/ipc/contract";
import { contextBridge, ipcRenderer } from "electron";

const invoke = <K extends IpcChannel>(name: K, ...args: IpcArgs<K>) =>
  ipcRenderer.invoke("writer:" + name, ...args) as Promise<IpcResult<K>>;

export const desktopAPI = {
  libraryStorage: (action: "status" | "open" | "import" = "status") =>
    invoke("library-storage", action),
  contextSettings: (value: import("./context-settings").ContextSettings) =>
    invoke("context-settings", value),
  contextUsage: (target: Target) => invoke("context-usage", target),
  compact: (target: Target, instructions = "") => invoke("compact", target, instructions),
  workspace: () => invoke("workspace"),
  projects: () => invoke("projects"),
  newTarget: (mode: Target["mode"]) => invoke("new-target", mode),
  appearance: (next: Partial<Appearance>) => invoke("appearance", next),
  preferences: (text?: string) =>
    text === undefined ? invoke("preferences") : invoke("save-preferences", text),
  testSearch: (
    key: string | undefined,
    provider: import("./network").SearchProvider,
    mode: import("./network").SearchMode,
  ) => invoke("test-search", key, provider, mode),
  search: (
    key?: string,
    provider?: import("./network").SearchProvider,
    mode?: import("./network").SearchMode,
  ) => invoke("search", key, provider, mode),
  modelCatalog: (role: keyof ModelSettings, next: ModelConnection, action?: string) =>
    invoke("model-catalog", role, next, action),
  testModel: (role: keyof ModelSettings, next: ModelConnection) => invoke("test-model", role, next),
  newConversation: (target: Target) => invoke("new-conversation", target),
  conversations: (target: Target) => invoke("conversations", target),
  export: (target: Target, focus: Focus, format: string) => invoke("export", target, focus, format),
  backup: () => invoke("backup"),
  storageHealth: () => invoke("storage-health"),
  recover: (expected: { id: string; fingerprint: string }) => invoke("recover", expected),
  diagnostics: () => invoke("diagnostics"),
  updates: (action?: string) => invoke("updates", action),
  openExternal: (url: string) => invoke("external", url),
  select: (target: Target) => invoke("select", target),
  view: (target: Target, limit?: number, archive?: number) =>
    invoke("view", target, limit, archive),
  running: () => invoke("running"),
  state: () => invoke("state"),
  choose: (mode: Target["mode"]) => invoke("choose", mode),
  model: (value: ModelsInput) => invoke("model", value),
  request: (operation: string, options: RequestOptions) => invoke("request", operation, options),
  send: (text: string, target?: Target, focus?: Focus) => invoke("send", text, target, focus),
  stop: (target?: Target) => invoke("stop", target),
  subscribe: (callback: (value: DesktopEvent) => void) => {
    const listener = (_event: unknown, value: DesktopEvent) => callback(value);
    ipcRenderer.on("writer:event", listener);
    return () => {
      ipcRenderer.removeListener("writer:event", listener);
    };
  },
};
contextBridge.exposeInMainWorld("writerDesktop", desktopAPI);
