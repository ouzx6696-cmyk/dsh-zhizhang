import type { ChapterStatus } from "../domain/status.js";
export interface StructureVolume {
    volume: number;
    title: string;
    summary?: string;
    startChapter: number;
    endChapter: number;
}
export interface ExportOptions {
    finalOnly?: boolean;
    onlyFinal?: boolean;
    outPath?: string;
}
export type ExportTxtOptions = ExportOptions;
export interface ExportChapterSection {
    id: string;
    position: number;
    title: string;
    heading: string;
    volume?: number;
    volumeTitle?: string;
    status: ChapterStatus;
    wordCount: number;
    paragraphs: string[];
    text: string;
}
export interface ExportVolumeSection {
    volume?: number;
    title?: string;
    chapters: ExportChapterSection[];
}
export interface ExportBookPayload {
    title: string;
    chapterCount: number;
    totalWords: number;
    chapters: ExportChapterSection[];
    volumes: ExportVolumeSection[];
    text: string;
}
export interface ExportTxtResult {
    title: string;
    chapterCount: number;
    totalWords: number;
    content: string;
    outPath?: string;
    chapters: ExportChapterSection[];
}
export interface ExportDocxOptions extends ExportOptions {
    pack?: (payload: ExportBookPayload) => Promise<Uint8Array>;
}
export interface ExportDocxResult {
    title: string;
    chapterCount: number;
    totalWords: number;
    payload: ExportBookPayload;
    outPath?: string;
}
export declare function stripExportMarkers(text: string): string;
export declare function assembleBookExport(workPath: string, opts?: ExportOptions): Promise<ExportBookPayload>;
export declare function exportWorkTxt(workPath: string, opts?: ExportTxtOptions): Promise<ExportTxtResult>;
export declare function exportWorkDocx(workPath: string, opts?: ExportDocxOptions): Promise<ExportDocxResult>;
//# sourceMappingURL=export.d.ts.map