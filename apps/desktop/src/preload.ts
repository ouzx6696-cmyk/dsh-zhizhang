import type { Target, Focus } from "./context";
import type { ModelConnection, ModelSettings, ModelsInput } from "./models";
import type { Appearance } from "./settings";
import type { DesktopEvent } from "./renderer-contracts";
import type { IpcArgs, IpcChannel, IpcResult, RequestOptions } from "./main/ipc/contract";
import { contextBridge, ipcRenderer, webFrame } from "electron";
import { fitZoom } from "./main/zoom";

// 外观选“等比放大”时，最大化、全屏或拖大窗口按窗口等比放大界面（见 main/zoom.ts）；
// 其余布局保持 1 倍，宽屏由 CSS 自适应铺开。渲染层把选项写在 <html data-layout>，DOM 与页面共享。
// 以渲染层实际视口换算回未缩放尺寸来算，不依赖主进程 resize 事件里可能滞后的窗口尺寸。
const fitWindowZoom = () => {
  const current = webFrame.getZoomFactor();
  const next =
    document.documentElement.dataset.layout === "zoom"
      ? fitZoom(window.innerWidth * current, window.innerHeight * current)
      : 1;
  if (Math.abs(next - current) > 0.001) webFrame.setZoomFactor(next);
};
window.addEventListener("resize", fitWindowZoom);
window.addEventListener("DOMContentLoaded", () => {
  fitWindowZoom();
  new MutationObserver(fitWindowZoom).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-layout"],
  });
});

const invoke = <K extends IpcChannel>(name: K, ...args: IpcArgs<K>) =>
  ipcRenderer.invoke("writer:" + name, ...args) as Promise<IpcResult<K>>;

export const desktopAPI = {
  workflowHistory: (target: Target) => invoke("workflow-history", target),
  learning: (
    target: Target,
    action: IpcArgs<"learning">[1] = "status",
    id?: string,
    text?: string,
  ) => invoke("learning", target, action, id, text),
  engine: (value?: import("../../../packages/core/src/workflow-config").EngineSettings) =>
    invoke("engine", value),
  writerOptions: (value?: import("./session/types").SessionOptions) =>
    invoke("writer-options", value),
  workflow: (target: Target, action: IpcArgs<"workflow">[1], value?: IpcArgs<"workflow">[2]) =>
    invoke("workflow", target, action, value),
  continuity: (target: Target, action: IpcArgs<"continuity">[1] = "status", id?: string) =>
    invoke("continuity", target, action, id),
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
  takeOverWorkspace: (ownerId: string) => invoke("take-over-workspace", ownerId),
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
