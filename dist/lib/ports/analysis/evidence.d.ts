export { quoteOk, extractBodyQuotes, verifyBodyQuotes } from "../../domain/evidence.js";
/** 模块证据核对：引文必须能在对应章找到。返回 bad 描述数组。 */
export declare function verifyModuleEvidence(card: any, sourceText: any, index: {
    n: number;
    title: string;
    start: number;
    end: number;
}[]): string[];
