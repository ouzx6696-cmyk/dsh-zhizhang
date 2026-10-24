import type { PluginConfig } from "./types.js";
export declare const ZZ_API_PREFIX = "/api/dsh-zhizhang";
/**
 * Resolve storage root for HTTP (no agent session).
 * Priority: config.storageRoot → env DSH_ZHIZHANG_ROOT → cwd/.zhizhang if present → ensureStorage default.
 */
export declare function resolveHttpPaths(config: PluginConfig): Promise<{
    resolvedVia: string;
    base: string;
    works: string;
    manuscripts: string;
    library: string;
    inspiration: string;
    sourceRoot: string;
}>;
export declare function createPanelApiHandler(config?: PluginConfig): (req: any, res: any) => Promise<void>;
/** Register routes on DSH webServer (optional; headless skips). */
export declare function registerPanelHttpRoutes(ctx: any, config: PluginConfig): boolean;
