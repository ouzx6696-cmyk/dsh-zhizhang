import React from 'react';
import { Button } from '../shared/ui.jsx';
import { diagnosticCopy as c } from '../shared/copy.js';
import { diagnosticScope, editMatches } from './edit-state.js';

const { useEffect, useRef, useState } = React;

export function Diagnostics({ state, view, actions, annotationId }) {
  const root = useRef(null);
  const [selected, setSelected] = useState(0);
  const { busy, error, scan, save, clear, change, undo } = actions.diagnostics;
  const kind = state.diagnosticKind, slot = state[kind], edit = state.edit;
  const valid = edit?.scope === diagnosticScope(state);
  const conflict = valid && !editMatches(state, kind);
  const blocks = valid ? edit.report.blocks : [];
  const index = Math.min(selected, Math.max(0, blocks.length - 1));
  const block = blocks[index];
  const body = valid ? edit.original : slot.body;
  const locked = busy || edit?.saving || edit?.pendingSave;
  useEffect(() => setSelected(0), [edit?.report]);

  function locate(issue) {
    setSelected(Math.max(0, blocks.findIndex(block => issue.start >= block.start && issue.end <= block.end)));
    const reader = root.current?.closest('.wb-reader');
    const mark = [...(reader?.querySelectorAll('mark[data-issue-id]') || [])].find(mark => (mark.dataset.issueIds || mark.dataset.issueId).split(' ').includes(issue.id));
    mark?.scrollIntoView({ block: 'center' });
    mark?.focus();
  }

  return <section ref={root} className="wb-diagnostics" aria-label={c.title}>
    <h3>{c.title}</h3>
    <p className="wb-muted">{c.explain}</p>
    <select className="wb-select" disabled={locked} aria-label={c.target} value={kind}
      onChange={event => actions.dispatch({ type: 'diagnosticKind', kind: event.target.value })}>
      <option value="chapter">{c.chapter}</option>
      <option value="candidate" disabled={!view.activeCand || state.readerView === 'official'}>{c.candidate}</option>
    </select>
    <Button disabled={locked || slot.status !== 'ready' || slot.truncated || !slot.body?.trim()} onClick={scan}>
      {busy ? c.busy : c.scan}
    </Button>
    {error || edit?.saveError ? <p role="alert">{error || edit.saveError}</p> : null}
    {edit && !valid ? <p role="alert">{c.other}<Button disabled={edit.saving} onClick={clear}>{c.clear}</Button></p> : null}
    {conflict ? <p role="alert">{c.conflict}</p> : null}
    {valid ? <>
      <p>{c.count}{edit.report.issues.length} / {edit.report.totalHits}{edit.report.limited ? c.limited : ''}</p>
      <p className="wb-muted">{c.lengths}{edit.report.summary.sentenceCount} / {edit.report.summary.min}–{edit.report.summary.max}</p>
      <ol>{edit.report.issues.map(issue => <li id={annotationId + '-issue-' + issue.id} tabIndex={-1} key={issue.id} data-category={issue.category}>
        <Button variant="outline" size="sm" onClick={() => locate(issue)}>{issue.match}</Button>
        <p>{issue.hint}</p><span className="wb-muted">{issue.origin === 'statistic' ? c.statistic : c.optional}</span>
      </li>)}</ol>
      {block ? <>
        <label>{c.paragraph}<select className="wb-select" disabled={locked} value={index} onChange={event => setSelected(Number(event.target.value))}>
          {blocks.map((block, index) => <option key={block.start} value={index}>{index + 1}</option>)}
        </select></label>
        <div className="wb-edit-diff">
          <pre>{body.slice(block.start, block.end)}</pre>
          <textarea className="wb-textarea" disabled={locked} aria-label={c.edit}
            value={edit.edits[index] ?? body.slice(block.start, block.end)} onChange={event => change(index, event.target.value)} />
        </div>
        <Button disabled={!edit.history.length || locked} onClick={() => undo()}>{c.undo}</Button>
        <Button disabled={!edit.future.length || locked} onClick={() => undo(true)}>{c.redo}</Button>
        <Button disabled={!edit.dirty || busy || conflict && !edit.pendingSave} onClick={save}>{edit.pendingSave ? c.retrySave : c.save}</Button>
        <Button disabled={busy || edit.saving} onClick={clear}>{c.clear}</Button>
        {edit.dirty ? <p>{c.original}</p> : null}
      </> : null}
    </> : null}
  </section>;
}
