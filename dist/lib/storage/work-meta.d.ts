import type { Foundation } from "../types.js";
/** Optional story pace is set only by an explicit author choice. */
export declare function validateStoryPace(value: unknown): string | undefined;
export declare function metaPath(dir: string): string;
export declare function normalizeFoundation(raw: any): Foundation;
export declare function readWorkMeta(dir: string): Promise<any>;
export declare function writeWorkMeta(dir: string, meta: any): Promise<void>;
