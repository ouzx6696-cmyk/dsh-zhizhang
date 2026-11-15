export declare const CHAPTER_STATUSES: readonly ["planned", "drafting", "drafted", "reviewed", "final"];
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];
export declare const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string>;
export declare const MAX_EDITOR_REJECTIONS = 2;
export declare function assertCanFinalize(opts: {
    status: ChapterStatus;
    requireEditorPass: boolean;
    editorPass?: boolean;
    editorRejections?: number;
}): void;
export declare function downgradeOnEdit(status: ChapterStatus): ChapterStatus;
//# sourceMappingURL=status.d.ts.map