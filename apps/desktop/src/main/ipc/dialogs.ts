import { app } from "electron";
import type { Runtime } from "../runtime";

/** 对话框统一从写作根开始；尚未选择写作根时退回系统文档目录。 */
export function dialogStartPath(state: Runtime) {
  return state.settings.workspace || app.getPath("documents");
}
