/** Where the author is reading, kept as a share of the scroll range across view changes. */
import { useCallback, useLayoutEffect, useRef } from "react";

/** The scrolling box that actually moves for `element`: the reader body, or the host's column. */
export function scrollParentOf(element) {
  for (let node = element; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight)
      return node;
  }
  return document.scrollingElement;
}

/** Scroll position as a share of the scrollable range, so it survives a change of layout. */
export function readScrollRatio(box) {
  const range = box.scrollHeight - box.clientHeight;
  return range > 0 ? box.scrollTop / range : 0;
}

export function applyScrollRatio(box, ratio) {
  box.scrollTop = ratio * (box.scrollHeight - box.clientHeight);
}

/** Brings a rectangle inside `box` to about a third of the way down, where the eye expects it. */
export function revealRect(box, rect) {
  const frame = box.getBoundingClientRect();
  const top = box === document.scrollingElement ? 0 : frame.top;
  const visible = box === document.scrollingElement ? window.innerHeight : box.clientHeight;
  if (rect.top >= top + 24 && rect.bottom <= top + visible - 24) return;
  box.scrollTop += rect.top - top - visible / 3;
}

// After leaving the editor the body may still reload (a save brings the new revision); keep
// putting the reader back where the editor was until then.
const SETTLE_MS = 3000;

/**
 * Carries the reading position into the source editor and back. `content` is the text the reader
 * shows once it is ready (null while editing or loading); `position` is shared with the editor.
 */
export function useReadingPosition(content) {
  const body = useRef(null);
  const position = useRef(0);
  const restore = useRef(null);
  const enter = useCallback(() => {
    position.current = readScrollRatio(scrollParentOf(body.current));
  }, []);
  const leave = useCallback(() => {
    restore.current = { until: Date.now() + SETTLE_MS, shown: null };
  }, []);
  useLayoutEffect(() => {
    const pending = restore.current;
    if (!pending || content == null || !body.current || pending.shown === content) return;
    if (Date.now() > pending.until) {
      restore.current = null;
      return;
    }
    pending.shown = content;
    applyScrollRatio(scrollParentOf(body.current), position.current);
  });
  return { body, position, enter, leave };
}
