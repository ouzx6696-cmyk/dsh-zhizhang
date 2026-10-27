/**
 * 章 / 卷标题解析 — 全插件唯一来源。
 *
 * 支持：第1章 / 第001章 / 第一章 / 第两百章 / 序章 / 序 / 楔子 / 引子。
 * 只认行首标题，避免正文里的「第一章」误切。
 */
/** 中文数字 / 阿拉伯数字 → number；无法解析返回 NaN。 */
export declare function cnNumber(input: unknown): number;
/** 行首章节标题：第N章 / 第N回 / 第N节（N 可为中文数字）。 */
export declare const CHAPTER_HEADING_RE: RegExp;
/** 行首卷标题：第N卷。 */
export declare const VOLUME_HEADING_RE: RegExp;
/** 行首前置章节：序章 / 序 / 楔子 / 引子。 */
export declare const FRONT_HEADING_RE: RegExp;
/** 解析一行标题；不是章节标题返回 null。 */
export declare function parseChapterHeading(line: unknown): {
    n: number;
    title: string;
    kind: string;
} | null;
/** 把「第12章」「第十二章」「12」统一成 number；解析失败返回 NaN。 */
export declare function parseChapterNumber(label: unknown): number;
