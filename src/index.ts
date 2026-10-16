/**
 * dsh-zhizhang — DeepSeek Harness plugin entry.
 *
 * Product: one creative loop (Library → Inspiration → Writing) with Scheduler
 * (default vs bypass) + MethodRegistry. Tools under src/tools/; this file only applies.
 */
import { formatToolError } from "./lib/errors.js";
import {
  AcceptPolicy,
  BriefGate,
  InspirationPort,
  LibraryPort,
  LintGate,
  METHOD_ASSET_IDS,
  MethodRegistry,
  HumanFeelAuditorPort,
  HumanFeelGate,
  NovelSenseAuditorPort,
  NovelSenseGate,
  PayoffAuditorPort,
  ProductMap,
  Scheduler,
  SaveBypassGate,
  StyleLinterPort,
} from "./lib/ports/index.js";
import {
  SYSTEM_BRIEF,
  allTools,
  formatLint,
  setPluginConfig,
  type ToolDef,
} from "./tools/index.js";

export const name = "zhizhang";
export const inject = ["tools"];

const tools: ToolDef[] = allTools();

export function apply(
  ctx: {
    tools: { register: (tool: ToolDef) => void };
    get?: (name: string) => unknown;
  },
  pluginConfig: { rootDir?: string; storageRoot?: string } = {},
) {
  setPluginConfig(pluginConfig);
  for (const tool of tools) ctx.tools.register(tool);

  const systemPrompt = ctx.get?.("systemPrompt") as
    | { section?: (opts: { name: string; order: number; text: string | (() => string) }) => void }
    | undefined;
  if (systemPrompt && typeof systemPrompt.section === "function") {
    systemPrompt.section({
      name: "tool:zhizhang",
      order: 108,
      text: () => SYSTEM_BRIEF,
    });
  }
}

export { SYSTEM_BRIEF };

export const __testing = {
  tools,
  formatLint,
  SYSTEM_BRIEF,
  formatToolError,
  METHOD_ASSET_IDS,
  listMethodAssets: () => MethodRegistry.list(),
  getMethodAssets: (ids: string[]) => MethodRegistry.getMany(ids),
  auditPayoff: PayoffAuditorPort.audit,
  formatPayoffAudit: PayoffAuditorPort.format,
  ports: {
    AcceptPolicy,
    LintGate,
    BriefGate,
    MethodRegistry,
    SaveBypassGate,
    StyleLinterPort,
    PayoffAuditorPort,
    HumanFeelAuditorPort,
    HumanFeelGate,
    NovelSenseAuditorPort,
    NovelSenseGate,
    LibraryPort,
    InspirationPort,
    ProductMap,
    Scheduler,
  },
};
