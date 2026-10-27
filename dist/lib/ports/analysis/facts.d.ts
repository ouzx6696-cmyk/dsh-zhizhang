import type { StoragePaths } from "../../types.js";
/** 白描硬禁：心理/评价词。desc 里出现即视为「替人物补动机/下判断」。 */
export declare const WHITE_DESC_HARD_RE: RegExp;
/** 白描软警告：因果/意图词（原文事实可含，提示改写为动作）。 */
export declare const WHITE_DESC_SOFT_RE: RegExp;
export declare function validateChapterFacts(facts: any, sourceText: any, index: {
    n: number;
    title: string;
    start: number;
    end: number;
}[]): {
    errors: string[];
    warnings: string[];
};
export declare function upsertChapter(paths: StoragePaths, sourceId: any, facts: any, sourceText: any, index: {
    n: number;
    title: string;
    start: number;
    end: number;
}[]): Promise<{
    warnings: string[];
    count: number;
}>;
