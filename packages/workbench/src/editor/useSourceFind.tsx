/**
 * 源码编辑态的查找替换：键位、匹配计算、高亮与滚动定位都挂在 TextareaSurface 上。
 * 自 SourceEditor 拆出（M0-2 行数收口），行为与原内联实现一致。
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { WORKBENCH_COPY } from "@zhizhang/ui/copy";
import type { TextareaSurface } from "./TextareaSurface.js";
import { findMatches, matchFrom, matchesToHighlights } from "./find.js";
import { FindBar, isShortcut, typingElsewhere, useFind } from "../client/shared/FindBar.js";

const c = WORKBENCH_COPY.editor;

export function selectionSeed(surface: TextareaSurface | null): string {
  if (!surface) return "";
  const { from, to } = surface.selection();
  const value = surface.value().slice(from, to);
  return value && value.length <= 80 && !value.includes("\n") ? value : "";
}

export interface SourceFindOptions {
  text: string;
  surface: React.RefObject<TextareaSurface | null>;
  root: React.RefObject<HTMLDivElement | null>;
}

export function useSourceFind({ text, surface, root }: SourceFindOptions) {
  const find = useFind();
  const { open: openFind, close: closeFind } = find;
  const [current, setCurrent] = useState(0);
  const [replaced, setReplaced] = useState<number | null>(null);
  const reveal = useRef(false);
  const [revealTick, setRevealTick] = useState(0);
  const requestReveal = () => {
    reveal.current = true;
    setRevealTick((tick) => tick + 1);
  };

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const findMode = isShortcut(event, "f") ? "find" : isShortcut(event, "h") ? "replace" : "";
      if (!findMode || typingElsewhere(event, root.current)) return;
      event.preventDefault();
      openFind(findMode, selectionSeed(surface.current));
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, [openFind, root, surface]);

  const matches = useMemo(
    () => (find.mode ? findMatches(text, find.query, find.matchCase) : []),
    [text, find.mode, find.query, find.matchCase],
  );
  const active = matches.length ? Math.min(current, matches.length - 1) : -1;

  useEffect(() => {
    if (!find.mode) return;
    setReplaced(null);
    const liveText = surface.current?.value() ?? "";
    const fresh = findMatches(liveText, find.query, find.matchCase);
    const caret = surface.current ? surface.current.selection().from : 0;
    requestReveal();
    setCurrent(fresh.length ? matchFrom(fresh, caret) : 0);
  }, [find.mode, find.query, find.matchCase, surface]);

  useLayoutEffect(() => {
    const activeSurface = surface.current;
    if (!activeSurface) return;
    activeSurface.highlight(matchesToHighlights(matches, active));
    if (!reveal.current || active < 0 || !matches[active]) return;
    reveal.current = false;
    const [start, end] = matches[active];
    activeSurface.select(start, end);
    activeSurface.scrollTo(start);
  }, [active, matches, revealTick, surface]);

  const step = (direction: 1 | -1) => {
    if (!matches.length) return;
    setReplaced(null);
    requestReveal();
    setCurrent((active + direction + matches.length) % matches.length);
  };

  const replaceCurrent = () => {
    const activeSurface = surface.current;
    if (!activeSurface) return;
    const fresh = findMatches(activeSurface.value(), find.query, find.matchCase);
    if (!fresh.length) return;
    const at = matchFrom(fresh, activeSurface.selection().from);
    const [start, end] = fresh[at];
    activeSurface.replaceRange(start, end, find.replacement);
    const after = findMatches(activeSurface.value(), find.query, find.matchCase);
    requestReveal();
    setCurrent(after.length ? matchFrom(after, start + find.replacement.length) : 0);
  };

  const replaceAll = () => {
    const activeSurface = surface.current;
    if (!activeSurface) return;
    const currentText = activeSurface.value();
    const fresh = findMatches(currentText, find.query, find.matchCase);
    if (!fresh.length) return;
    let next = "";
    let at = 0;
    for (const [start, end] of fresh) {
      next += currentText.slice(at, start) + find.replacement;
      at = end;
    }
    activeSurface.replaceRange(0, currentText.length, next + currentText.slice(at));
    setReplaced(fresh.length);
  };

  const bar = find.mode ? (
    <FindBar
      find={find}
      label={c.findPanel}
      index={active}
      total={matches.length}
      status={replaced == null ? undefined : c.replacedAll(replaced)}
      onStep={step}
      onReplace={replaceCurrent}
      onReplaceAll={replaceAll}
      onClose={() => {
        closeFind();
        surface.current?.focus();
      }}
      canReplace
    />
  ) : null;

  return { find, matches, active, bar };
}
