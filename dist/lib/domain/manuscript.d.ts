/** Source coordinates always refer to the original UTF-16 string, including CRLF. */
export interface TextRun {
    text: string;
    start: number;
    end: number;
    style?: string;
}
export interface Block {
    kind: string;
    start: number;
    end: number;
    runs: TextRun[];
}
export declare function inlineRuns(text: string, offset: number): TextRun[];
export declare function parseManuscript(text: string): Block[];
