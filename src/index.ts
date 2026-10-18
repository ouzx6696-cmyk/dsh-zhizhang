/**
 * dsh-zhizhang — DeepSeek Harness plugin entry.
 *
 * Product: one creative loop (Library → Inspiration → Writing) with Scheduler
 * (default vs bypass) + MethodRegistry. Tools under src/tools/; this file only applies.
 * Optional: Web console HTTP (GET snapshot/library/inspiration + POST candidate/accept).
 */
import { formatToolError } from "./lib/errors.js";
import { registerPanelHttpRoutes } from "./lib/http-api.js";
import {
  AcceptPolicy,
  BriefGate,
  InspirationPort,
  LibraryPort,
  LintGate,
  METHOD_ASSET_IDS,
  MethodRegistry,
  MultiDraftPort,
  HumanFeelAuditorPort,
  HumanFeelGate,
  NovelSenseAuditorPort,
  NovelSenseGate,
  PayoffAuditorPort,
  ProductMap,
  Scheduler,
  SaveBypassGate,
  StyleLinterPort,
  setPortConfig,
  envMultiDraftFlag,
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
    inject?: (deps: string[], fn: (wctx: never) => void) => void;
    effect?: (fn: () => unknown, name?: string) => void;
  },
  pluginConfig: {
    rootDir?: string;
    storageRoot?: string;
    allowLanPanel?: boolean;
    multiDraftEnabled?: boolean;
    multiDraft?: { enabled?: boolean };
  } = {},
) {
  setPluginConfig(pluginConfig);
  const multiOn =
    pluginConfig.multiDraftEnabled === true ||
    pluginConfig.multiDraft?.enabled === true ||
    envMultiDraftFlag();
  setPortConfig({ multiDraftEnabled: multiOn });
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

  // Web console HTTP (GET + accept POST). Missing webServer is fine — headless / tools-only.
  registerPanelHttpRoutes(ctx as Parameters<typeof registerPanelHttpRoutes>[0], pluginConfig);
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
    MultiDraftPort,
  },
};
