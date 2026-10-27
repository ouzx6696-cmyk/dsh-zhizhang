export declare function resolveHappenedText(opts: any): {
    text: string;
    source: string;
    bodyTail: string | undefined;
    warn?: undefined;
} | {
    text: string;
    source: string;
    bodyTail?: undefined;
    warn?: undefined;
} | {
    text: string;
    source: string;
    bodyTail: string;
    warn: string;
};
export declare function formatChapterOutcomeLine(chapterId: string, title: string, text: string): string;
