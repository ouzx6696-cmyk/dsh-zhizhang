import type { ArticleRowView } from "@zhizhang/toutiao/view";
import { type RowSnapshotState, type SnapshotDelta } from "../shared/snapshotState.js";
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
export type ToutiaoAction = {
    type: "loading";
} | {
    type: "articles";
    delta: SnapshotDelta<ArticleRowView>;
} | {
    type: "error";
    error: string;
} | {
    type: "select";
    id: string;
} | {
    type: "root";
    root: string;
} | {
    type: "busy";
    action: string;
} | {
    type: "delivered";
    deliveryPath: string;
};
export declare function initialToutiaoState(): ToutiaoState;
export declare function toutiaoReducer(state: ToutiaoState, action: ToutiaoAction): ToutiaoState;
export declare function deriveToutiao(state: ToutiaoState): {
    rows: ArticleRowView[];
    selected: ArticleRowView | null;
};
//# sourceMappingURL=state.d.ts.map