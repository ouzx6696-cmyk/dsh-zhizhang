import type { ChapterStatus } from "../domain/status.js";
export interface ChapterRowView {
    id: string;
    title: string;
    position: number;
    status: ChapterStatus;
    wordCount: number;
    revision: string;
}
export interface FanqieSnapshotDelta {
    revision: string;
    full: boolean;
    rows: ChapterRowView[];
    removedIds: string[];
}
//# sourceMappingURL=snapshot.d.ts.map