/** 渲染层唯一的主进程客户端：优先走 Electron preload，浏览器预览自动回落至 HTTP+SSE 桥。 */
import { installWorkbenchTransport } from "@zhizhang/workbench/client";
import { createDesktopApi, type DesktopBridge } from "../../shared/ipc";
import { getWebDesktopBridge } from "./web-bridge";

function bridge(): DesktopBridge {
  return window.zhizhangBridge ?? getWebDesktopBridge();
}

export const desktop = createDesktopApi(bridge);

// 写作区（@zhizhang/workbench/client）的命令统一走 workbench.call 通道。
installWorkbenchTransport({ call: desktop.workbench });
