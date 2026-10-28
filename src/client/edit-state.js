/** One source of truth for local paragraph edits; no network or component state. */
export const EMPTY_ISSUES = Object.freeze([]);
const HISTORY_BYTES = 2 * 1024 * 1024;
const HISTORY_STEPS = 50;

let requestSequence = 0;
export function requestId() {
  // Correlation only, never authentication; remains available in non-secure LAN contexts.
  return Date.now().toString(36) + '-' + (++requestSequence).toString(36) + '-' + Math.random().toString(36).slice(2);
}

export function diagnosticScope(state, kind = state.diagnosticKind) {
  return JSON.stringify([state.selection, state.projectId, state.work, state.chapterId, kind,
    kind === 'candidate' ? state.candidate.meta?.id || state.candidateId : '']);
}

export function editMatches(state, kind) {
  const edit = state.edit, slot = state[kind];
  return !!edit && edit.scope === diagnosticScope(state, kind) && edit.report.source.kind === kind &&
    slot.status === 'ready' && !slot.truncated && edit.original === slot.body &&
    edit.report.source.bodyHash === slot.meta?.bodyHash &&
    edit.report.source.targetRevision === state.chapter.meta?.revision;
}

function snapshotBytes(snapshot) {
  return Object.entries(snapshot).reduce((bytes, [key, value]) => bytes + 2 * (key.length + value.length) + 16, 0);
}
function boundedHistory(snapshots) {
  const kept = [];
  let bytes = 0;
  for (let index = snapshots.length - 1; index >= 0 && kept.length < HISTORY_STEPS; index--) {
    bytes += snapshotBytes(snapshots[index]);
    if (bytes > HISTORY_BYTES) break;
    kept.push(snapshots[index]);
  }
  return kept.reverse();
}

function changed(edit, edits) {
  return Object.entries(edits).some(([index, value]) => {
    const block = edit.report.blocks[index];
    return value !== edit.original.slice(block.start, block.end);
  });
}

export function changeParagraph(edit, index, value) {
  const edits = { ...edit.edits, [index]: value };
  return { ...edit, edits, saveError: '', history: boundedHistory([...edit.history, edit.edits]), future: [],
    dirty: changed(edit, edits), requestId: requestId() };
}

export function moveHistory(edit, redo = false) {
  const from = redo ? edit.future : edit.history;
  if (!from.length) return edit;
  const edits = from[from.length - 1];
  return { ...edit, edits, saveError: '', dirty: changed(edit, edits), requestId: requestId(),
    history: redo ? boundedHistory([...edit.history, edit.edits]) : from.slice(0, -1),
    future: redo ? from.slice(0, -1) : boundedHistory([...edit.future, edit.edits]) };
}

export function revisionPayload(edit) {
  const edits = Object.entries(edit.edits).flatMap(([index, after]) => {
    const block = edit.report.blocks[index], before = edit.original.slice(block.start, block.end);
    return before === after ? [] : [{ ...block, before, after }];
  });
  return { base: edit.base, work: edit.work, source: edit.report.source, edits, requestId: edit.requestId, confirm: true };
}
