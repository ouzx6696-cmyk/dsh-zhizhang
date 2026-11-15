import type { ChapterRowView, FanqieSnapshotDelta } from "@zhizhang/fanqie/view";
import { type RowSnapshotState } from "../shared/snapshotState.js";
declare const VIEWS: readonly ["chapters", "overview"];
declare const TABS: readonly ["overview", "library", "inspiration", "writing", "ledger"];
declare const READER_VIEWS: readonly ["official", "candidate", "split"];
export declare const FONT_STEPS: readonly [-2, -1, 0, 1, 2, 3];
export type FanqieView = (typeof VIEWS)[number];
export type PipelineTab = (typeof TABS)[number];
export type ReaderViewMode = (typeof READER_VIEWS)[number];
export type DiagnosticKind = "chapter" | "candidate";
export interface BodySlotState {
    status: "idle" | "loading" | "ready" | "error";
    key: string;
    body: string;
    title: string;
    revision: string;
    chapterStatus: string;
    error: string | null;
}
export interface FanqieDialogState {
    kind: "accept" | "finalize";
    chapterId: string;
    candidateId?: string;
}
export interface FanqieState {
    phase: "boot" | "ready" | "error";
    selection: number;
    work: string;
    rowSnapshot: RowSnapshotState<ChapterRowView>;
    loading: boolean;
    error: string | null;
    lastRefresh: string | null;
    view: FanqieView;
    tab: PipelineTab;
    chapterId: string;
    candidateId: string;
    readerView: ReaderViewMode;
    fontStep: number;
    chapter: BodySlotState;
    bodyEpoch: number;
    edit: boolean;
    diagnosticKind: DiagnosticKind;
    dialog: FanqieDialogState | null;
    busyAction: string;
}
export declare const idleBody: BodySlotState;
export type FanqieAction = {
    type: "loading";
} | {
    type: "snapshot";
    selection: number;
    delta: FanqieSnapshotDelta;
    work: string;
} | {
    type: "snapshotError";
    selection: number;
    error: string;
} | {
    type: "selectWork";
    work: string;
} | {
    type: "view";
    view: FanqieView;
} | {
    type: "tab";
    tab: PipelineTab;
} | {
    type: "fontStep";
    step: number;
} | {
    type: "selectChapter";
    id: string;
} | {
    type: "selectCandidate";
    chapterId: string;
    id: string;
} | {
    type: "readerView";
    view: ReaderViewMode;
} | {
    type: "diagnosticKind";
    kind: DiagnosticKind;
} | {
    type: "edit";
    value: boolean;
} | {
    type: "body";
    value: Partial<BodySlotState> & {
        key: string;
    };
} | {
    type: "reloadBodies";
} | {
    type: "openDialog";
    dialog: FanqieDialogState;
} | {
    type: "closeDialog";
} | {
    type: "busy";
    action: string;
};
export declare function initialState(): FanqieState;
export declare function reducer(state: FanqieState, action: FanqieAction): FanqieState;
export interface FanqieDerived {
    chapters: ChapterRowView[];
    current: ChapterRowView | null;
    revision: string;
}
export declare function derive(state: FanqieState): FanqieDerived;
export declare function bodyKey(state: FanqieState): string;
export {};
//# sourceMappingURL=state.d.ts.map