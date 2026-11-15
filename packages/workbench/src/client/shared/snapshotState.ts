/** 增量行快照结构共享：供番茄章节表与头条文章表统一消费服务端增量回执。 */
export interface RowSnapshotState<TRow extends { id: string }> {
  revision: string;
  rows: TRow[];
  byId: Record<string, TRow>;
}

export interface SnapshotDelta<TRow extends { id: string }> {
  revision: string;
  full: boolean;
  rows: readonly TRow[];
  removedIds?: readonly string[];
}

export function createRowSnapshotState<TRow extends { id: string }>(): RowSnapshotState<TRow> {
  return { revision: "", rows: [], byId: {} };
}

export function applySnapshotDelta<TRow extends { id: string }>(
  prev: RowSnapshotState<TRow>,
  delta: SnapshotDelta<TRow>,
): RowSnapshotState<TRow> {
  if (
    delta.revision &&
    delta.revision === prev.revision &&
    !delta.full &&
    delta.rows.length === 0 &&
    !delta.removedIds?.length
  ) {
    return prev;
  }
  const byId: Record<string, TRow> = delta.full ? {} : { ...prev.byId };
  if (!delta.full && delta.removedIds) {
    for (const id of delta.removedIds) {
      delete byId[id];
    }
  }
  for (const row of delta.rows) {
    byId[row.id] = row;
  }
  return {
    revision: delta.revision,
    rows: Object.values(byId),
    byId,
  };
}
