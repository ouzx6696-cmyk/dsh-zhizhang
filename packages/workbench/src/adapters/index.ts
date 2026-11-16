import { AppError } from "@zhizhang/core/errors";
import { createDesktopAdapter } from "./desktop.js";
import type { WorkbenchTransport } from "./types.js";

export {
  createFallbackDraftStore,
  createMemoryDraftStore,
  draftStore,
  installDraftStore,
  type DraftStore,
} from "./drafts.js";
export type { RequestOptions, WorkbenchData, WorkbenchTransport } from "./types.js";

let installed: WorkbenchTransport | null = null;

/** 渲染层启动时注入写作区传输（window.zhizhangBridge 的 workbench.call 通道）。 */
export function installWorkbenchTransport(transport: WorkbenchTransport): void {
  installed = transport;
}

export const dataAdapter = createDesktopAdapter(() => {
  if (!installed) throw new AppError("internal", "写作区传输尚未注入");
  return installed;
});
