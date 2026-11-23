/** 桌面外壳文案（渲染层唯一来源）：按界面区域分模块组合。 */
import { DESKTOP_SETTINGS_COPY } from "./desktop-settings.js";
import { DESKTOP_SHELL_COPY } from "./desktop-shell.js";
import { DESKTOP_STUDIO_COPY } from "./desktop-studio.js";
import { DESKTOP_WORKSPACE_COPY } from "./desktop-workspace.js";

export const DESKTOP_COPY = {
  ...DESKTOP_SHELL_COPY,
  ...DESKTOP_WORKSPACE_COPY,
  ...DESKTOP_STUDIO_COPY,
  ...DESKTOP_SETTINGS_COPY,
} as const;
