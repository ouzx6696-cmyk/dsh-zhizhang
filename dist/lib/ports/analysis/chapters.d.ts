/** 解析章节目录：第1章 / 第一章 / 序章。返回 [{n,title,start,end}]。 */
export declare function chapterIndex(text: string): {
    n: number;
    title: string;
    start: number;
    end: number;
}[];
export declare function totalChapters(index: {
    n: number;
    title: string;
    start: number;
    end: number;
}[]): number;
export declare function chapterText(text: string, index: {
    n: number;
    title: string;
    start: number;
    end: number;
}[], n: number): string | null;
export declare function chapterTitle(index: {
    n: number;
    title: string;
    start: number;
    end: number;
}[], n: number): string;
/** 百分比位置最近的章（用于 30/60/85 抽样）。 */
export declare function nearestChapter(index: {
    n: number;
    title: string;
    start: number;
    end: number;
}[], ratio: any): number | null;
