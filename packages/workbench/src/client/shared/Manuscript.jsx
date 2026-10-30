import React from 'react';
import { parseManuscript } from '../../../../fanqie/src/engine/domain/manuscript.js';
import { EMPTY_ISSUES } from '../fanqie/edit-state.js';

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function graphemeBoundaries(run) {
  const boundaries = [run.start];
  if (segmenter) {
    for (const segment of segmenter.segment(run.text)) boundaries.push(run.start + segment.index);
  } else {
    let position = run.start;
    for (const character of run.text) { position += character.length; boundaries.push(position); }
  }
  boundaries.push(run.end);
  return boundaries;
}

function floorBoundary(boundaries, value) {
  let lo = 0, hi = boundaries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (boundaries[mid] > value) hi = mid - 1;
    else lo = mid + 1;
  }
  return boundaries[Math.max(0, hi)];
}

export const Manuscript = React.memo(function Manuscript({ text, issues = EMPTY_ISSUES, annotationId = 'wb-reader' }) {
  function marked(run) {
    if (run.text === '\n') return <br key={run.start} />;
    const hits = issues.filter(hit => hit.start < run.end && hit.end > run.start);
    let children = run.text;
    if (hits.length) {
      const boundaries = graphemeBoundaries(run);
      const points = [...new Set([run.start, run.end, ...hits.flatMap(hit => [
        floorBoundary(boundaries, Math.max(run.start, hit.start)), floorBoundary(boundaries, Math.min(run.end, hit.end)),
      ])])].sort((a, b) => a - b);
      children = points.slice(0, -1).map((start, index) => {
        const end = points[index + 1];
        const activeHits = hits.filter(hit => hit.start < end && hit.end > start), hit = activeHits[0];
        const value = text.slice(start, end);
        return hit ? <mark key={start} data-issue-id={hit.id} data-issue-ids={activeHits.map(hit => hit.id).join(" ")} data-category={hit.category} title={activeHits.map(hit => hit.hint).join("\n")}
          tabIndex={0} aria-describedby={activeHits.map(hit => annotationId + '-issue-' + hit.id).join(' ')}
          onClick={event => {
            const reader = event.currentTarget.closest('.wb-reader');
            const item = [...(reader?.querySelectorAll('li[id]') || [])].find(item => item.id === annotationId + '-issue-' + hit.id);
            item?.focus();
          }}>{value}</mark> : <React.Fragment key={start}>{value}</React.Fragment>;
      });
    }
    return run.style ? React.createElement(run.style, { key: run.start }, children) : <React.Fragment key={run.start}>{children}</React.Fragment>;
  }

  function nextMark(event) {
    if (!event.altKey || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const marks = [...event.currentTarget.querySelectorAll('mark')];
    const index = marks.indexOf(document.activeElement);
    const next = marks[(index + (event.key === 'ArrowDown' ? 1 : -1) + marks.length) % marks.length];
    if (next) { event.preventDefault(); next.focus(); next.scrollIntoView({ block: 'center' }); }
  }

  return <article className="wb-manuscript" onKeyDown={nextMark}>
    {parseManuscript(text).map(block => React.createElement(block.kind, { key: block.start },
      block.kind === 'hr' ? undefined : block.kind === 'pre' ? <code>{block.runs.map(run => run.text).join('')}</code> : block.runs.map(marked)))}
  </article>;
});
