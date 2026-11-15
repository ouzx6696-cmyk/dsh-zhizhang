/** 增量行快照结构共享：供番茄章节表与头条文章表统一消费服务端增量回执。 */
export interface RowSnapshotState<TRow extends {
    id: string;
}> {
    revision: string;
    rows: TRow[];
    byId: Record<string, TRow>;
}
export interface SnapshotDelta<TRow extends {
    id: string;
}> {
    revision: string;
    full: boolean;
    rows: readonly TRow[];
    removedIds?: readonly string[];
}
export declare function createRowSnapshotState<TRow extends {
    id: string;
}>(): RowSnapshotState<TRow>;
export declare function applySnapshotDelta<TRow extends {
    id: string;
}>(prev: RowSnapshotState<TRow>, delta: SnapshotDelta<TRow>): RowSnapshotState<TRow>;
//# sourceMappingURL=snapshotState.d.ts.map