import type { ChapterRowView, FanqieSnapshotDelta } from "@zhizhang/fanqie/view";
import { PREF, oneOf, readPref } from "../shared/prefs.js";
import {
  applySnapshotDelta,
  createRowSnapshotState,
  type RowSnapshotState,
} from "../shared/snapshotState.js";

const VIEWS = ["chapters", "overview"] as const;
const TABS = ["overview", "library", "inspiration", "writing", "ledger"] as const;
const READER_VIEWS = ["official", "candidate", "split"] as const;
export const FONT_STEPS = [-2, -1, 0, 1, 2, 3] as const;

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

export const idleBody: BodySlotState = {
  status: "idle",
  key: "",
  body: "",
  title: "",
  revision: "",
  chapterStatus: "",
  error: null,
};

export type FanqieAction =
  | { type: "loading" }
  | { type: "snapshot"; delta: FanqieSnapshotDelta; work: string }
  | { type: "snapshotError"; work: string; error: string }
  | { type: "selectWork"; work: string }
  | { type: "view"; view: FanqieView }
  | { type: "tab"; tab: PipelineTab }
  | { type: "fontStep"; step: number }
  | { type: "selectChapter"; id: string }
  | { type: "selectCandidate"; chapterId: string; id: string }
  | { type: "readerView"; view: ReaderViewMode }
  | { type: "diagnosticKind"; kind: DiagnosticKind }
  | { type: "edit"; value: boolean }
  | { type: "body"; value: Partial<BodySlotState> & { key: string } }
  | { type: "reloadBodies" }
  | { type: "openDialog"; dialog: FanqieDialogState }
  | { type: "closeDialog" }
  | { type: "busy"; action: string };

export function initialState(): FanqieState {
  const fontStep = Number(readPref(PREF.fontStep, "0"));
  return {
    phase: "boot",
    selection: 0,
    work: readPref(PREF.work, ""),
    rowSnapshot: createRowSnapshotState<ChapterRowView>(),
    loading: false,
    error: null,
    lastRefresh: null,
    view: oneOf(readPref(PREF.view, "chapters"), VIEWS, "chapters"),
    tab: oneOf(readPref(PREF.tab, "overview"), TABS, "overview"),
    chapterId: readPref(PREF.chapter, ""),
    candidateId: readPref(PREF.candidate, ""),
    readerView: oneOf(readPref(PREF.readerView, "official"), READER_VIEWS, "official"),
    fontStep: (FONT_STEPS as readonly number[]).includes(fontStep) ? fontStep : 0,
    chapter: idleBody,
    bodyEpoch: 0,
    edit: false,
    diagnosticKind: "chapter",
    dialog: null,
    busyAction: "",
  };
}

export function reducer(state: FanqieState, action: FanqieAction): FanqieState {
  switch (action.type) {
    case "loading":
      return { ...state, loading: true };
    case "snapshot": {
      // 守卫按作品判定：换作品后发出的请求带着旧 selection，按 selection 会把
      // 新作品的快照误杀在 boot 态（DEF-01）；迟到的是旧作品响应时才丢弃。
      if (action.work !== state.work) return state;
      const rowSnapshot = applySnapshotDelta(state.rowSnapshot, action.delta);
      const chapters = [...rowSnapshot.rows].sort((a, b) => a.position - b.position);
      let chapterId = state.chapterId;
      if (chapterId && !chapters.some((c) => c.id === chapterId)) chapterId = "";
      if (!chapterId && chapters.length) chapterId = chapters[0].id;
      const next: FanqieState = {
        ...state,
        phase: "ready",
        loading: false,
        error: null,
        lastRefresh: new Date().toISOString(),
        work: action.work || state.work,
        rowSnapshot,
        chapterId,
        bodyEpoch: state.chapter.status === "error" ? state.bodyEpoch + 1 : state.bodyEpoch,
      };
      if (next.chapter.key !== bodyKey(next)) {
        next.chapter = idleBody;
      }
      if (chapterId !== state.chapterId) {
        next.dialog = null;
      }
      return next;
    }
    case "snapshotError":
      if (action.work !== state.work) return state;
      return {
        ...state,
        phase: state.rowSnapshot.rows.length ? "ready" : "error",
        loading: false,
        error: action.error,
      };
    case "selectWork":
      if (action.work === state.work) return state;
      return {
        ...state,
        work: action.work,
        selection: state.selection + 1,
        rowSnapshot: createRowSnapshotState<ChapterRowView>(),
        chapterId: "",
        candidateId: "",
        chapter: idleBody,
        dialog: null,
        edit: false,
        phase: "boot",
      };
    case "view":
      return { ...state, view: action.view };
    case "tab":
      return { ...state, tab: action.tab };
    case "fontStep":
      return { ...state, fontStep: action.step };
    case "selectChapter":
      if (action.id === state.chapterId) {
        return {
          ...state,
          diagnosticKind: "chapter",
          readerView: state.readerView === "split" ? "split" : "official",
        };
      }
      return {
        ...state,
        chapterId: action.id,
        diagnosticKind: "chapter",
        dialog: null,
        candidateId: "",
        readerView: state.readerView === "split" ? "split" : "official",
        chapter: idleBody,
        edit: false,
      };
    case "selectCandidate":
      return {
        ...state,
        chapterId: action.chapterId,
        candidateId: action.id,
        diagnosticKind: "candidate",
        dialog: null,
        readerView: state.readerView === "split" ? "split" : "candidate",
        chapter: action.chapterId === state.chapterId ? state.chapter : idleBody,
      };
    case "readerView":
      return {
        ...state,
        readerView: action.view,
        diagnosticKind:
          action.view === "official"
            ? "chapter"
            : action.view === "candidate"
              ? "candidate"
              : state.diagnosticKind,
      };
    case "diagnosticKind":
      return { ...state, diagnosticKind: action.kind };
    case "edit":
      return { ...state, edit: action.value };
    case "body":
      if (action.value.key !== bodyKey(state)) return state;
      return { ...state, chapter: { ...idleBody, ...action.value } };
    case "reloadBodies":
      // 编辑中不重读（D3）：保存 / 取消会先退出编辑再触发重读。
      if (state.edit && state.chapter.status === "ready") return state;
      return { ...state, bodyEpoch: state.bodyEpoch + 1, chapter: idleBody };
    case "openDialog":
      return { ...state, dialog: action.dialog };
    case "closeDialog":
      return { ...state, dialog: null };
    case "busy":
      return { ...state, busyAction: action.action };
    default:
      return state;
  }
}

export interface FanqieDerived {
  chapters: ChapterRowView[];
  current: ChapterRowView | null;
  revision: string;
}

export function derive(state: FanqieState): FanqieDerived {
  const chapters = [...state.rowSnapshot.rows].sort((a, b) => a.position - b.position);
  const current = chapters.find((c) => c.id === state.chapterId) ?? null;
  return {
    chapters,
    current,
    revision: state.rowSnapshot.revision,
  };
}

export function bodyKey(state: FanqieState): string {
  if (state.view !== "chapters" || !state.work || !state.chapterId) return "";
  // 编辑中正文键冻结：后台刷新带来的当前章 revision 变化不重读正文、不把作者踢出编辑器；
  // 退出编辑后键随最新 revision 重算，再按需重读（D3）。保存时的基线冲突由编辑器自己的 base 校验兜住。
  if (state.edit && state.chapter.status === "ready" && state.chapter.key) return state.chapter.key;
  const current = state.rowSnapshot.byId[state.chapterId];
  return JSON.stringify([state.work, state.chapterId, current?.revision ?? "", state.bodyEpoch]);
}
