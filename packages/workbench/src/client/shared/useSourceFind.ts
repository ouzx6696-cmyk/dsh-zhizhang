/** SourceEditor 查找与替换状态桥接 Hook。 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { TextareaSurface } from "../../editor/TextareaSurface.js";
import { findMatches, matchFrom, matchesToHighlights } from "../../editor/find.js";
import { useFind } from "./FindBar.js";

export function selectionSeed(surface: TextareaSurface | null): string {
  if (!surface) return "";
  const { from, to } = surface.selection();
  const value = surface.value().slice(from, to);
  return value && value.length <= 80 && !value.includes("\n") ? value : "";
}

export function useSourceFind(text: string, surfaceRef: MutableRefObject<TextareaSurface | null>) {
  const find = useFind();
  const [current, setCurrent] = useState(0);
  const [replaced, setReplaced] = useState<number | null>(null);
  const reveal = useRef(false);
  const [revealTick, setRevealTick] = useState(0);

  const requestReveal = () => {
    reveal.current = true;
    setRevealTick((tick) => tick + 1);
  };

  const matches = useMemo(
    () => (find.mode ? findMatches(text, find.query, find.matchCase) : []),
    [text, find.mode, find.query, find.matchCase],
  );
  const active = matches.length ? Math.min(current, matches.length - 1) : -1;

  useEffect(() => {
    if (!find.mode) return;
    setReplaced(null);
    const surface = surfaceRef.current;
    const liveText = surface?.value() ?? "";
    const fresh = findMatches(liveText, find.query, find.matchCase);
    const caret = surface ? surface.selection().from : 0;
    reveal.current = true;
    setRevealTick((tick) => tick + 1);
    setCurrent(fresh.length ? matchFrom(fresh, caret) : 0);
  }, [find.mode, find.query, find.matchCase, surfaceRef]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.highlight(matchesToHighlights(matches, active));
    if (!reveal.current || active < 0 || !matches[active]) return;
    reveal.current = false;
    const [start, end] = matches[active];
    surface.select(start, end);
    surface.scrollTo(start);
  }, [active, matches, revealTick, surfaceRef]);

  const step = (direction: 1 | -1) => {
    if (!matches.length) return;
    setReplaced(null);
    requestReveal();
    setCurrent((active + direction + matches.length) % matches.length);
  };

  const replaceCurrent = () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const fresh = findMatches(surface.value(), find.query, find.matchCase);
    if (!fresh.length) return;
    const at = matchFrom(fresh, surface.selection().from);
    const [start, end] = fresh[at];
    surface.replaceRange(start, end, find.replacement);
    const after = findMatches(surface.value(), find.query, find.matchCase);
    requestReveal();
    setCurrent(after.length ? matchFrom(after, start + find.replacement.length) : 0);
  };

  const replaceAll = () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const currentText = surface.value();
    const fresh = findMatches(currentText, find.query, find.matchCase);
    if (!fresh.length) return;
    let next = "";
    let at = 0;
    for (const [start, end] of fresh) {
      next += currentText.slice(at, start) + find.replacement;
      at = end;
    }
    surface.replaceRange(0, currentText.length, next + currentText.slice(at));
    setReplaced(fresh.length);
  };

  return { find, matches, active, replaced, step, replaceCurrent, replaceAll };
}
