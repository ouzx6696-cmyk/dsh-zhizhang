export function createRowSnapshotState() {
    return { revision: "", rows: [], byId: {} };
}
export function applySnapshotDelta(prev, delta) {
    if (delta.revision &&
        delta.revision === prev.revision &&
        !delta.full &&
        delta.rows.length === 0 &&
        !delta.removedIds?.length) {
        return prev;
    }
    const byId = delta.full ? {} : { ...prev.byId };
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
