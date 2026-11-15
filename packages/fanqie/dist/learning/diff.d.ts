export interface Hunk {
    kind: "delete" | "expand" | "dialogue" | "action" | "split" | "word";
    before: string;
    after: string;
    context: [string, string];
}
export declare function splitSentences(paragraph: string): string[];
export declare function alignSentences(beforePara: string, afterPara: string, context?: [string, string]): Hunk[];
export declare function alignParagraphs(beforeText: string, afterText: string): Hunk[];
export declare function alignTwoLevel(beforeText: string, afterText: string): Hunk[];
//# sourceMappingURL=diff.d.ts.map