/**
 * 拆书 L0 量化测绘（v0.17.0）。
 *
 * 目的：在动用模型精读之前，先用代码把「可确定性统计」的东西扫一遍——
 * 卷界、章长、词频、分布热力、锚点章。报告里的宏观判断必须踩在这些数字上，
 * 而不是踩在抽样印象上。
 *
 * 本文件纯计算，不读写磁盘；analysis.js 负责落盘。
 */
import { cnNumber } from "../domain/chapter-heading.js";
export { cnNumber };
/** 解析卷标记行：第一卷 / 第二卷 … 返回 [{no,name,title,start,end}]。 */
export declare function parseVolumes(text: string): {
    no: number;
    name: string;
    title: string;
    start: number;
    end: number;
}[];
/**
 * 统计高频词（2–4 字 n-gram）。
 * 只做「分布参考」，不做实体识别；人名/地名/概念混排，报告里必须如实标注。
 */
export declare function topTerms(text: string, { minCount, limit }?: {
    minCount?: number | undefined;
    limit?: number | undefined;
}): {
    term: any;
    count: any;
}[];
/** 章节索引行（章节切分产物）。 */
export interface ChapterIndexRow {
    n: number;
    title: string;
    start: number;
    end: number;
}
/** 锚点章：关键词密度 + 事实钩子强度 + 卷首卷末加成。 */
export declare function anchorChapters(text: string, index: ChapterIndexRow[], { facts, volumes, limit }?: {
    facts?: any[];
    volumes?: any[];
    limit?: number;
}): {
    n: number;
    title: string;
    score: number;
    why: string;
}[];
/** 主入口：全书测绘。 */
export declare function buildSurvey(text: string, index: ChapterIndexRow[], { facts, volumeMarkers }?: {
    facts?: any[];
    volumeMarkers?: any[];
}): Record<string, any>;
