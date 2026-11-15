import type { ArticleRowView } from "@zhizhang/toutiao/view";
import { PREF, readPref } from "../shared/prefs.js";
import {
  applySnapshotDelta,
  createRowSnapshotState,
  type RowSnapshotState,
  type SnapshotDelta,
} from "../shared/snapshotState.js";

export interface ToutiaoState {
  phase: "boot" | "ready" | "error";
  root: string;
  rowSnapshot: RowSnapshotState<ArticleRowView>;
  selectedId: string;
  loading: boolean;
  error: string | null;
  busyAction: string;
  lastDeliveryPath: string;
}

export type ToutiaoAction =
  | { type: "loading" }
  | { type: "articles"; delta: SnapshotDelta<ArticleRowView> }
  | { type: "error"; error: string }
  | { type: "select"; id: string }
  | { type: "root"; root: string }
  | { type: "busy"; action: string }
  | { type: "delivered"; deliveryPath: string };

export function initialToutiaoState(): ToutiaoState {
  return {
    phase: "boot",
    root: readPref(PREF.ttRoot, ""),
    rowSnapshot: createRowSnapshotState<ArticleRowView>(),
    selectedId: readPref(PREF.ttArticle, ""),
    loading: false,
    error: null,
    busyAction: "",
    lastDeliveryPath: "",
  };
}

export function toutiaoReducer(state: ToutiaoState, action: ToutiaoAction): ToutiaoState {
  switch (action.type) {
    case "loading":
      return { ...state, loading: true };
    case "articles": {
      const rowSnapshot = applySnapshotDelta(state.rowSnapshot, action.delta);
      const rows = rowSnapshot.rows;
      let selectedId = state.selectedId;
      if (selectedId && !rowSnapshot.byId[selectedId]) selectedId = "";
      if (!selectedId && rows.length) selectedId = rows[0].id;
      return {
        ...state,
        phase: "ready",
        loading: false,
        error: null,
        rowSnapshot,
        selectedId,
      };
    }
    case "error":
      return {
        ...state,
        phase: state.rowSnapshot.rows.length ? "ready" : "error",
        loading: false,
        error: action.error,
      };
    case "select":
      return { ...state, selectedId: action.id, lastDeliveryPath: "" };
    case "root":
      return {
        ...state,
        root: action.root,
        rowSnapshot: createRowSnapshotState<ArticleRowView>(),
        selectedId: "",
        phase: "boot",
      };
    case "busy":
      return { ...state, busyAction: action.action };
    case "delivered":
      return { ...state, lastDeliveryPath: action.deliveryPath };
    default:
      return state;
  }
}

export function deriveToutiao(state: ToutiaoState): {
  rows: ArticleRowView[];
  selected: ArticleRowView | null;
} {
  return {
    rows: state.rowSnapshot.rows,
    selected: state.selectedId ? (state.rowSnapshot.byId[state.selectedId] ?? null) : null,
  };
}
