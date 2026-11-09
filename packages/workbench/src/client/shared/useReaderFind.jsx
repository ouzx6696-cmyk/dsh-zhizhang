/**
 * Ctrl+F in the reader: highlights every match in the rendered text with the CSS Custom Highlight
 * API, so the memoised manuscript is never re-rendered, and steps through them.
 */
import React from "react";
import { FindBar, isShortcut, typingElsewhere, useFind } from "./FindBar.jsx";
import { findMatches } from "./find.js";
import { revealRect, scrollParentOf } from "./reading-position.js";
import { EDITOR_COPY as c } from "../../../../ui/src/copy.js";

const { useCallback, useEffect, useLayoutEffect, useRef, useState } = React;

const ALL = "wb-find";
const CURRENT = "wb-find-current";
const BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, header, section, div";
const SKIPPED = ".wb-visually-hidden, [aria-hidden='true']";

/** Text nodes as one string, with a newline between blocks so no match spans two paragraphs. */
function flatten(root) {
  const nodes = [];
  let text = "";
  let block = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement.closest(SKIPPED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = /** @type {Text} */ (node);
    const owner = textNode.parentElement.closest(BLOCKS);
    if (block && owner !== block) text += "\n";
    block = owner;
    nodes.push({ node: textNode, start: text.length });
    text += textNode.data;
  }
  return { nodes, text };
}

/** The text node holding `offset`; `end` picks the node a match ends in rather than the next one. */
function locate(nodes, offset, end) {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (end ? nodes[mid].start < offset : nodes[mid].start <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { node: nodes[lo].node, offset: offset - nodes[lo].start };
}

function collect(root, query, matchCase) {
  const { nodes, text } = flatten(root);
  return findMatches(text, query, matchCase).map(([start, end]) => {
    const from = locate(nodes, start, false);
    const to = locate(nodes, end, true);
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  });
}

/** First match at or below the top of what the reader is looking at. */
function firstInView(ranges, box) {
  const top = box === document.scrollingElement ? 0 : box.getBoundingClientRect().top;
  const index = ranges.findIndex((range) => range.getBoundingClientRect().bottom >= top);
  return index < 0 ? 0 : index;
}

function clearHighlights() {
  CSS.highlights.delete(ALL);
  CSS.highlights.delete(CURRENT);
}

/**
 * `body` is the reader body element; `enabled` is false while the source editor is open (it has its
 * own find). Returns the find state, for a toolbar button, and the bar to render above the body.
 */
export function useReaderFind(body, enabled) {
  const find = useFind();
  const { open: openFind, close: closeFind } = find;
  const [ranges, setRanges] = useState([]);
  const [current, setCurrent] = useState(0);
  const [content, setContent] = useState(0);
  const reveal = useRef(false);
  const open = enabled && !!find.mode;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!enabled) return undefined;
    const keyboard = (event) => {
      if (document.querySelector("dialog[open]")) return;
      const reader = body.current?.closest(".wb-reader");
      if (isShortcut(event, "f")) {
        if (!reader || typingElsewhere(event, reader)) return;
        event.preventDefault();
        const selected = window.getSelection()?.toString() ?? "";
        openFind("find", selected.length <= 80 && !selected.includes("\n") ? selected : "");
        return;
      }
      if (event.key !== "Escape" || !openRef.current) return;
      // Esc belongs to the bar while it is open: the shell must not close drawers or stop tasks.
      event.preventDefault();
      event.stopImmediatePropagation();
      closeFind();
      body.current?.focus();
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, [enabled, body, openFind, closeFind]);

  // Bodies load, reload and remount (a new chapter) under the open bar. Each render checks which
  // body element is current and watches that one, so the count follows what is on screen.
  const watched = useRef(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- every render on purpose; exits unless the body element changed
  useLayoutEffect(() => {
    const target = open ? body.current : null;
    if (watched.current?.target === target) return;
    watched.current?.stop();
    watched.current = null;
    if (!target) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setContent((value) => value + 1));
    });
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    const stop = () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    watched.current = { target, stop };
    setContent((value) => value + 1);
  });
  useEffect(() => () => watched.current?.stop(), []);

  // A new query starts at what is on screen rather than jumping back to the top; a reload of the
  // same text keeps the current match.
  const searched = useRef(null);
  useLayoutEffect(() => {
    if (!open || !body.current) {
      searched.current = null;
      setRanges([]);
      return;
    }
    setRanges(collect(body.current, find.query, find.matchCase));
    const key = JSON.stringify([find.query, find.matchCase]);
    if (searched.current === key) return;
    searched.current = key;
    reveal.current = true;
    setCurrent(-1);
  }, [open, body, find.query, find.matchCase, content]);

  useLayoutEffect(() => {
    if (!ranges.length) {
      clearHighlights();
      return undefined;
    }
    const box = scrollParentOf(body.current);
    const index = current < 0 ? firstInView(ranges, box) : Math.min(current, ranges.length - 1);
    if (index !== current) {
      setCurrent(index);
      return undefined;
    }
    CSS.highlights.set(ALL, new Highlight(...ranges));
    CSS.highlights.set(CURRENT, new Highlight(ranges[index]));
    if (reveal.current) {
      reveal.current = false;
      revealRect(box, ranges[index].getBoundingClientRect());
    }
    return clearHighlights;
  }, [ranges, current, body]);

  const step = useCallback(
    (direction) => {
      if (!ranges.length) return;
      reveal.current = true;
      setCurrent((index) => (Math.max(index, 0) + direction + ranges.length) % ranges.length);
    },
    [ranges.length],
  );

  const bar = open ? (
    <FindBar
      find={find}
      label={c.readerFindPanel}
      index={Math.max(current, 0)}
      total={ranges.length}
      onStep={step}
      onClose={() => {
        closeFind();
        body.current?.focus();
      }}
    />
  ) : null;
  return { openFind, bar };
}
