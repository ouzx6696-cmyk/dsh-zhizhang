import type { StoragePaths, PluginConfig } from "./types.js";
/** Soft body cap for panel reads (~400 KiB). */
export declare const PANEL_BODY_BYTE_CAP: number;
/** Safe chapter / candidate id: no path segments, no traversal (delegates to the store). */
export declare function assertSafeResourceId(id: string, label: string): string;
export declare function capPanelBody(body: string): {
    body: string;
    truncated: boolean;
    bodyBytes: number;
};
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
/** Read-only unify brief pack — no disk writes. */
export declare function prepareUnifyBrief(paths: StoragePaths, opts: any): Promise<{
    ok: boolean;
    enabled: boolean;
    chapterId: any;
    candidateIds: any;
    brief: string;
    parents: {
        id: any;
        draftLabel: any;
        wordCount: any;
    }[];
    code?: undefined;
    error?: undefined;
} | {
    ok: boolean;
    enabled: boolean;
    code: any;
    error: string;
    chapterId?: undefined;
    candidateIds?: undefined;
    brief?: undefined;
    parents?: undefined;
}>;
export declare function createPanelApiHandler(config?: PluginConfig): (req: any, res: any) => Promise<void>;
/** Register routes on DSH webServer (optional; headless skips). */
export declare function registerPanelHttpRoutes(ctx: any, config: PluginConfig): boolean;
