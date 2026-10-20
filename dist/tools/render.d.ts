import { readWorkMeta } from "../lib/store.js";
import { StyleLinterPort } from "../lib/ports/index.js";
import type { Outline } from "../lib/types.js";
export declare function clip(text: string, max: number): string;
/** Lean outline for chapter_brief: no beats list (beats stay on disk via outline_get). */
export declare function renderOutlineLean(o: Outline): string;
export declare function renderOutline(o: Outline): string;
export declare function renderStatus(meta: Awaited<ReturnType<typeof readWorkMeta>>, dir: string): string;
export declare function formatLint(label: string, hits: ReturnType<typeof StyleLinterPort.lint>, summary: ReturnType<typeof StyleLinterPort.summarize>): string;
