/** 渲染层唯一的主进程客户端：类型化 DesktopApi（经 preload 的 window.zhizhangBridge）。 */
import { AppError } from "@zhizhang/core/errors";
import {
  clearLegacyDraftStorage,
  createFallbackDraftStore,
  installDraftStore,
  installWorkbenchTransport,
} from "@zhizhang/workbench/client";
import { createDesktopApi, type DesktopBridge } from "../../shared/ipc";

function bridge(): DesktopBridge {
  const value = window.zhizhangBridge;
  if (!value) throw new AppError("internal", "desktop bridge is not initialized");
  return value;
}

export const desktop = createDesktopApi(bridge);

// 写作区（@zhizhang/workbench/client）的命令统一走 workbench.call 通道。
installWorkbenchTransport({ call: desktop.workbench });

// 草稿（M0-2 D4）走 drafts.* 通道落写作文件夹；未配置写作文件夹时退化为内存暂存。
installDraftStore(
  createFallbackDraftStore({
    read: (key) => desktop.draftRead(key),
    write: (key, text, baseRevision) => desktop.draftWrite({ key, text, baseRevision }),
    clear: (key) => desktop.draftClear(key),
  }),
);
clearLegacyDraftStorage();
