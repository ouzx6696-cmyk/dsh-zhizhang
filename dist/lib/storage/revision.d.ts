export declare function chapterRevision(chapter: {
    body: string;
    outline: unknown;
    position: number;
}): string;
/** Called under the work lock, before changing authoritative files. */
export declare function preserveChapter(dir: string, id: string, expectedHash: string): Promise<string>;
