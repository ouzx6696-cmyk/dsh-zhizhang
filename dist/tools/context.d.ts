import { type StoragePaths } from "../lib/store.js";
export interface PluginConfig {
    rootDir?: string;
    storageRoot?: string;
    /** Optional novels folder (one visible directory per book). */
    worksRoot?: string;
    /** Optional shared library root (cards/sources reused across projects). */
    libraryRoot?: string;
    /** Optional local book shelf for library_import by file name. */
    sourceRoot?: string;
    allowLanPanel?: boolean;
    multiDraftEnabled?: boolean;
    multiDraft?: {
        enabled?: boolean;
    };
}
export declare let config: PluginConfig;
export declare function setPluginConfig(next: PluginConfig): void;
export declare function sessionKey(exec: unknown): string;
export declare function rememberWork(exec: unknown, key: string): void;
export declare function fail(message: string, code?: string): never;
export declare function asString(args: Record<string, unknown>, key: string, opts?: {
    required?: boolean;
    trim?: boolean;
}): string | undefined;
export declare function openWork(exec: unknown, args: Record<string, unknown>): Promise<{
    paths: StoragePaths;
    dir: string;
    key: string;
}>;
