/**
 * Panel HTTP surface for the DSH Web console.
 * GET: health / works / snapshot / library / inspiration / chapter / candidate (read-only).
 * POST: candidate/accept — same AcceptPolicy hard gates as zhizhang_candidate_accept;
 *       never silent success (confirm required; gate/store failures return clear errors).
 * Chapter/candidate bodies are on-demand (not embedded in snapshot) for light polling.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { type StoragePaths } from "./store.js";
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
export type PluginConfig = {
    rootDir?: string;
    storageRoot?: string;
    worksRoot?: string;
    libraryRoot?: string;
    sourceRoot?: string;
    allowLanPanel?: boolean;
    multiDraftEnabled?: boolean;
    multiDraft?: {
        enabled?: boolean;
    };
};
/**
 * Resolve storage root for HTTP (no agent session).
 * Priority: config.storageRoot → env DSH_ZHIZHANG_ROOT → cwd/.zhizhang if present → ensureStorage default.
 */
export declare function resolveHttpPaths(config: PluginConfig): Promise<StoragePaths & {
    resolvedVia: string;
}>;
/** Read-only unify brief pack — no disk writes. */
export declare function prepareUnifyBrief(paths: StoragePaths, opts: {
    work: string;
    chapter?: string;
    candidateIds?: string[];
}): Promise<{
    ok: true;
    enabled: true;
    chapterId: string;
    candidateIds: string[];
    brief: string;
    parents: Array<{
        id: string;
        draftLabel?: string;
        wordCount: number;
    }>;
} | {
    ok: false;
    code: string;
    error: string;
    enabled: boolean;
}>;
export declare function createPanelApiHandler(config?: PluginConfig): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/** Register routes on DSH webServer (optional; headless skips). */
export declare function registerPanelHttpRoutes(ctx: {
    inject?: (deps: string[], fn: (wctx: {
        webServer: {
            register: (route: unknown) => unknown;
        };
        effect?: (fn: () => unknown, name?: string) => void;
    }) => void) => void;
    effect?: (fn: () => unknown, name?: string) => void;
    get?: (name: string) => unknown;
}, config: PluginConfig): boolean;
