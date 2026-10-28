/**
 * Plugin configuration schema.
 *
 * DSH validates a plugin's exported `Config` (any Standard Schema) when the row
 * loads, fills defaults, and fails loudly on bad values; a Schemastery schema
 * additionally lets the host's plugin page describe the fields. Schemastery is
 * resolved from the host when available (peer, optional). Without it the
 * plugin still exports a small Standard Schema with the same checks, so the
 * package keeps working on hosts or test runs that do not provide it.
 *
 * Optional path fields deliberately have no default: an empty string would hide
 * the matching DSH_ZHIZHANG_* environment variable.
 */
import type { PluginConfig } from "./types.js";
interface Issue {
    message: string;
    path?: (string | number)[];
}
interface StandardResult {
    value?: PluginConfig;
    issues?: Issue[];
}
export interface ConfigSchema {
    readonly "~standard": {
        readonly version: 1;
        readonly vendor: string;
        validate(value: unknown): StandardResult;
    };
}
/** Describe each field once; both schema flavours are generated from this list. */
export declare const CONFIG_FIELDS: Record<string, {
    type: "string" | "boolean" | "string[]" | "object";
    default?: unknown;
    description: string;
    secret?: boolean;
}>;
/** Optional host schema adapter; installed but incompatible schemas fail at load. */
export declare function createConfigSchema(): Promise<ConfigSchema>;
export {};
