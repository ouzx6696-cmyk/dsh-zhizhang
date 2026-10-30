/** Mounted with the workbench, so leaving the reader cannot detach an in-flight save. */
import React from 'react';
import { api } from '../shared/api.js';
import { diagnosticCopy as c } from '../shared/copy.js';
import { changeParagraph, diagnosticScope, editMatches, moveHistory, requestId, revisionPayload } from './edit-state.js';

const { useEffect, useRef, useState } = React;

export function useDiagnostics({ state, stateRef, alive, setEdit, refresh, notify }) {
  const scope = diagnosticScope(state);
  const key = JSON.stringify([scope, state.view, state.bodyEpoch, state[state.diagnosticKind].key]);
  const operation = useRef({ key, generation: 0, controller: null });
  if (operation.current.key !== key) {
    operation.current = { ...operation.current, key, generation: operation.current.generation + 1 };
  }
  const [status, setStatus] = useState({ key, busy: false, error: '' });
  useEffect(() => () => operation.current.controller?.abort(), [key]);
  const current = generation => alive.current && operation.current.key === key && operation.current.generation === generation;

  async function scan() {
    const snapshot = stateRef.current, kind = snapshot.diagnosticKind, slot = snapshot[kind];
    if (status.key === key && status.busy || snapshot.edit?.pendingSave || snapshot.edit?.saving) return;
    if (slot.status !== 'ready' || slot.truncated || !slot.body?.trim()) return;
    if (snapshot.edit?.dirty && !window.confirm(c.discard)) return;
    const generation = ++operation.current.generation, controller = new AbortController();
    operation.current.controller?.abort();
    operation.current.controller = controller;
    setStatus({ key, busy: true, error: '' });
    try {
      const report = await api.diagnose({ base: snapshot.projectId, work: snapshot.work, chapter: snapshot.chapterId,
        kind, candidate: snapshot.candidate.meta?.id, expectedRevision: snapshot.chapter.meta?.revision, bodyHash: slot.meta?.bodyHash }, controller.signal);
      if (!current(generation) || stateRef.current[kind].body !== slot.body || stateRef.current[kind].meta?.bodyHash !== report.source.bodyHash) return;
      setEdit({ scope, base: snapshot.projectId, work: snapshot.work, report, original: slot.body,
        edits: {}, history: [], future: [], dirty: false, requestId: requestId() });
    } catch (error) {
      if (current(generation) && error.code !== 'aborted') setStatus({ key, busy: false, error: error.message });
    } finally {
      if (current(generation)) setStatus(value => ({ ...value, busy: false }));
    }
  }

  async function save() {
    const snapshot = stateRef.current, edit = snapshot.edit;
    if (!edit?.dirty || edit.saving || !editMatches(snapshot, snapshot.diagnosticKind) && !edit.pendingSave) return;
    const generation = ++operation.current.generation;
    setEdit({ ...edit, saving: true, saveError: '' });
    setStatus({ key, busy: true, error: '' });
    try {
      const result = await api.stageRevision(revisionPayload(edit));
      if (!alive.current || stateRef.current.edit?.requestId !== edit.requestId) return;
      setEdit(null);
      if (stateRef.current.projectId === edit.base && stateRef.current.work === edit.work) {
        notify('success', c.saved + result.candidateId);
        await refresh();
      }
    } catch (error) {
      if (!alive.current || stateRef.current.edit?.requestId !== edit.requestId) return;
      const pendingSave = !error.status || error.status >= 500;
      const message = error.message + ' · ' + (pendingSave ? c.retry : c.retained);
      setEdit({ ...edit, saving: false, pendingSave, saveError: message });
      if (current(generation)) setStatus({ key, busy: false, error: message });
    } finally {
      if (current(generation)) setStatus(value => ({ ...value, busy: false }));
    }
  }

  function update(transform) {
    const edit = stateRef.current.edit;
    if (!edit || edit.saving || edit.pendingSave) return;
    setEdit(transform(edit));
  }
  function clear() {
    const edit = stateRef.current.edit;
    if (edit?.saving || edit?.dirty && !window.confirm(c.discard)) return;
    operation.current.generation++;
    operation.current.controller?.abort();
    setEdit(null);
    setStatus({ key, busy: false, error: '' });
  }
  return { busy: status.key === key && status.busy, error: status.key === key ? status.error : '',
    scan, save, clear, change: (index, value) => update(edit => changeParagraph(edit, index, value)),
    undo: (redo = false) => update(edit => moveHistory(edit, redo)) };
}
