import {
  COMMON_COPY,
  CRASH_COPY,
  PROJECT_INDEX_FAILED,
  UNLOAD_COPY,
  chapterName,
  formatBytes,
  formatClock,
  formatCost,
  formatCount,
  formatDateTime,
  formatElapsed,
  formatTokens,
  taskEndCopy,
} from "./common.js";
import { SHELL_COPY } from "./shell.js";
import { AGENT_COPY, AGENT_SECTION_COPY } from "./agent.js";
import { WORKFLOW_COPY, WORKFLOW_SECTION_COPY } from "./workflow.js";
import { EDITOR_COPY, EDITOR_SECTION_COPY, diagnosticCopy } from "./editor.js";
import { FANQIE_COPY } from "./fanqie.js";
import { TOUTIAO_COPY } from "./toutiao.js";
import { API_LABELS, SETTINGS_COPY } from "./settings.js";
import { ERROR_COPY } from "./errors.js";
import { DESKTOP_COPY } from "./desktop.js";

export {
  COMMON_COPY,
  SHELL_COPY,
  AGENT_SECTION_COPY,
  AGENT_COPY,
  WORKFLOW_SECTION_COPY,
  WORKFLOW_COPY,
  EDITOR_SECTION_COPY,
  EDITOR_COPY,
  diagnosticCopy,
  FANQIE_COPY,
  TOUTIAO_COPY,
  API_LABELS,
  SETTINGS_COPY,
  ERROR_COPY,
  DESKTOP_COPY,
  UNLOAD_COPY,
  CRASH_COPY,
  PROJECT_INDEX_FAILED,
  formatCount,
  formatTokens,
  formatCost,
  formatElapsed,
  formatClock,
  formatDateTime,
  formatBytes,
  taskEndCopy,
  chapterName,
};

export const COPY = {
  ...COMMON_COPY,
  ...SHELL_COPY,
  ...AGENT_SECTION_COPY,
  ...WORKFLOW_SECTION_COPY,
  ...EDITOR_SECTION_COPY,
  ...FANQIE_COPY,
  ...TOUTIAO_COPY,
  ...SETTINGS_COPY,
} as const;

export type CopyKey = keyof typeof COPY;

export function t(key: CopyKey | (string & {}), vars?: Record<string, unknown>): string {
  const raw = Object.prototype.hasOwnProperty.call(COPY, key)
    ? (COPY as Record<string, string>)[key]
    : String(key);
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match: string, name: string) =>
    vars[name] == null ? match : String(vars[name]),
  );
}
