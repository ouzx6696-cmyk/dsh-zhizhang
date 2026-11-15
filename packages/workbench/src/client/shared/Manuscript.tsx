import React, { useLayoutEffect, useMemo, useRef } from "react";
import { getCustomHighlightApi, supportsCustomHighlight } from "../../editor/TextareaSurface.js";
import { findMatches, type TextMatchRange } from "../../editor/find.js";
import { Empty } from "./components.js";

function splitParagraphs(text: string): string[] {
  return String(text || "").split(/\r?\n/);
}

function renderWithMarks(
  paragraph: string,
  baseOffset: number,
  matches: readonly TextMatchRange[],
  activeIndex: number,
): React.ReactNode {
  if (!matches.length) return paragraph;
  const pEnd = baseOffset + paragraph.length;
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (let i = 0; i < matches.length; i += 1) {
    const [mStart, mEnd] = matches[i];
    if (mEnd <= baseOffset || mStart >= pEnd) continue;
    const localStart = Math.max(0, mStart - baseOffset);
    const localEnd = Math.min(paragraph.length, mEnd - baseOffset);
    if (localStart > cursor) parts.push(paragraph.slice(cursor, localStart));
    parts.push(
      <mark key={`${i}-${localStart}`} data-current={i === activeIndex ? "true" : undefined}>
        {paragraph.slice(localStart, localEnd)}
      </mark>,
    );
    cursor = localEnd;
  }

  if (cursor < paragraph.length) parts.push(paragraph.slice(cursor));
  return parts.length ? parts : paragraph;
}

export interface ManuscriptProps {
  text?: string | null;
  emptyText?: string;
  query?: string;
  matchCase?: boolean;
  activeMatch?: number;
}

function ManuscriptView({
  text,
  emptyText = "暂无正文内容",
  query = "",
  matchCase = false,
  activeMatch = 0,
}: ManuscriptProps) {
  const articleRef = useRef<HTMLElement | null>(null);
  const raw = String(text ?? "");
  const hasContent = raw.trim().length > 0;
  const customHighlight = supportsCustomHighlight();

  const matches = useMemo(
    () => (hasContent && query ? findMatches(raw, query, matchCase) : []),
    [hasContent, raw, query, matchCase],
  );
  const paragraphs = useMemo(() => (hasContent ? splitParagraphs(raw) : []), [hasContent, raw]);

  useLayoutEffect(() => {
    const api = getCustomHighlightApi();
    if (!api) return undefined;

    const cleanup = () => {
      api.registry.delete("wb-find");
      api.registry.delete("wb-find-current");
    };

    const host = articleRef.current;
    if (!host || !matches.length) {
      cleanup();
      return cleanup;
    }

    const pNodes = host.querySelectorAll<HTMLParagraphElement>("p");
    const findRanges: Range[] = [];
    const activeRanges: Range[] = [];

    let offset = 0;
    let matchIdx = 0;

    for (let i = 0; i < paragraphs.length && matchIdx < matches.length; i += 1) {
      const pText = paragraphs[i];
      const lineStart = offset;
      const lineEnd = lineStart + pText.length;
      offset = lineEnd + 1;

      const node = pNodes[i]?.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;

      while (matchIdx < matches.length && matches[matchIdx][1] <= lineStart) {
        matchIdx += 1;
      }

      let cursor = matchIdx;
      while (cursor < matches.length && matches[cursor][0] < lineEnd) {
        const [mStart, mEnd] = matches[cursor];
        const localStart = Math.max(0, mStart - lineStart);
        const localEnd = Math.min(pText.length, mEnd - lineStart);
        if (localEnd > localStart) {
          const domRange = document.createRange();
          domRange.setStart(node, localStart);
          domRange.setEnd(node, localEnd);
          if (cursor === activeMatch) activeRanges.push(domRange);
          else findRanges.push(domRange);
        }
        if (mEnd <= lineEnd) {
          cursor += 1;
          matchIdx = cursor;
        } else {
          break;
        }
      }
    }

    if (findRanges.length) {
      api.registry.set("wb-find", new api.HighlightCtor(...findRanges));
    } else {
      api.registry.delete("wb-find");
    }
    if (activeRanges.length) {
      api.registry.set("wb-find-current", new api.HighlightCtor(...activeRanges));
    } else {
      api.registry.delete("wb-find-current");
    }

    return cleanup;
  }, [matches, paragraphs, activeMatch]);

  if (!hasContent) {
    return <Empty title={emptyText} icon="book" />;
  }

  let offset = 0;
  return (
    <article ref={articleRef} className="wb-manuscript">
      {paragraphs.map((p, index) => {
        const lineStart = offset;
        offset += p.length + 1;
        if (!p.trim()) return <p key={index} className="wb-manuscript-gap" aria-hidden="true" />;
        return (
          <p key={index} className="wb-manuscript-p">
            {customHighlight ? p : renderWithMarks(p, lineStart, matches, activeMatch)}
          </p>
        );
      })}
    </article>
  );
}

export const Manuscript = React.memo(ManuscriptView);
