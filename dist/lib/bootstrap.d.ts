/**
 * Heavy tool layer for zhizhang — mounted on demand (per Agent scope when the host
 * exposes one). Kept out of the plugin entry so a profile mount injects only the
 * single `zhizhang_enable` trigger.
 */
import { type PluginConfig, type ToolDef } from "../tools/index.js";
/** Minimal registration surface shared by the profile ctx and an Agent-scoped ctx. */
export interface MountContext {
    tools: {
        register: (tool: ToolDef) => unknown;
    };
    get?: (name: string) => unknown;
}
type Disposer = unknown;
/**
 * Register the 46 织章 tools and the resident hard-rules section on `ctx`.
 * @param ctx Agent-scoped context (`agent.ctx`) or a plain registration context.
 * @param pluginConfig Plugin config to apply before tool construction.
 * @returns Disposers for every registration (unwinds a partial mount on failure).
 */
export declare function applyTools(ctx: MountContext, pluginConfig?: PluginConfig): Disposer[];
export {};
