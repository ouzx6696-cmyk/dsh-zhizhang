/** 渲染层使用的类型化桌面客户端（DesktopApi）：经 preload 暴露的 zhizhangBridge 调用主进程。 */
import { AppError } from "@zhizhang/core/errors";
import { createDesktopApi, type DesktopBridge } from "./shared/ipc.js";

function bridge(): DesktopBridge {
  const value: DesktopBridge | undefined = window.zhizhangBridge;
  if (!value) throw new AppError("internal", "桌面桥尚未初始化");
  return value;
}

export const desktopApi = createDesktopApi(bridge);
