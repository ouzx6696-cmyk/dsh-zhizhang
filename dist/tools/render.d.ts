import type { StoragePaths } from "../lib/types.js";
export declare function clip(text: string, max: any): string;
/** Lean outline for chapter_brief: no beats list (beats stay on disk via outline_get). */
export declare function renderOutlineLean(o: any): string;
export declare function renderOutline(o: any): string;
export declare function renderStatus(meta: any, dir: string, paths: StoragePaths): string;
export declare function formatLint(label: string, hits: any, summary: any): string;
