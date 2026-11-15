import React, { useLayoutEffect, useMemo, useRef } from "react";
import { WORKBENCH_COPY as W } from "@zhizhang/ui/copy";
import { getCustomHighlightApi, supportsCustomHighlight } from "../../editor/TextareaSurface.js";
import { findMatches, type TextMatchRange } from "../../editor/find.js";
import { Empty } from "./components.js";

const HEADING = /^(#{1,3})\s+/;

interface Line {
  text: string;
  /** 该行在全文里的起点偏移。 */
  start: number;
  /** 显示时去掉的前缀长度（Markdown 标题的 `# `）。 */
  prefix: number;
  kind: "p" | "gap" | "h1" | "h2" | "h3";
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const raw of String(text || "").split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const head = HEADING.exec(line);
    const kind: Line["kind"] = !line.trim()
      ? "gap"
      : head
        ? head[1].length === 1
          ? "h1"
          : head[1].length === 2
            ? "h2"
            : "h3"
        : "p";
    lines.push({ text: line, start, prefix: head ? head[0].length : 0, kind });
    start += raw.length + 1;
  }
  return lines;
}

function renderWithMarks(
  line: Line,
  matches: readonly TextMatchRange[],
  activeIndex: number,
): React.ReactNode {
  const shown = line.text.slice(line.prefix);
  if (!matches.length) return shown;
  const base = line.start + line.prefix;
  const end = base + shown.length;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < matches.length; i += 1) {
    const [mStart, mEnd] = matches[i];
    if (mEnd <= base || mStart >= end) continue;
    const localStart = Math.max(0, mStart - base);
    const localEnd = Math.min(shown.length, mEnd - base);
    if (localStart > cursor) parts.push(shown.slice(cursor, localStart));
    parts.push(
      <mark key={`${i}-${localStart}`} data-current={i === activeIndex ? "true" : undefined}>
        {shown.slice(localStart, localEnd)}
      </mark>,
    );
    cursor = localEnd;
  }
  if (cursor < shown.length) parts.push(shown.slice(cursor));
  return parts.length ? parts : shown;
}

export interface ManuscriptProps {
  text?: string | null;
  emptyText?: string;
  /** 稿纸标题：正文首行是 `# 标题` 时以它为准（章名只出现一次），否则用这里的值。 */
  title?: string;
  query?: string;
  matchCase?: boolean;
  activeMatch?: number;
  /** 标题下的一行弱色元信息（状态、字数）；每项一个片段，之间自动加间隔点。 */
  meta?: readonly React.ReactNode[];
}

function MetaLine({ items }: { items?: readonly React.ReactNode[] }) {
  if (!items?.length) return null;
  return (
    <p className="wb-manuscript-meta" data-testid="manuscript-meta">
      {items.map((item, index) => (
        <span key={index}>{item}</span>
      ))}
    </p>
  );
}

function ManuscriptView({
  text,
  emptyText = W.empty,
  title,
  query = "",
  matchCase = false,
  activeMatch = 0,
  meta,
}: ManuscriptProps) {
  const articleRef = useRef<HTMLElement | null>(null);
  const raw = String(text ?? "");
  const hasContent = raw.trim().length > 0;
  const customHighlight = supportsCustomHighlight();

  const matches = useMemo(
    () => (hasContent && query ? findMatches(raw, query, matchCase) : []),
    [hasContent, raw, query, matchCase],
  );
  const lines = useMemo(() => (hasContent ? splitLines(raw) : []), [hasContent, raw]);
  const leadIndex = lines.findIndex((line) => line.kind !== "gap");
  const leadHeading = leadIndex >= 0 && lines[leadIndex].kind === "h1" ? leadIndex : -1;

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
    const nodes = host.querySelectorAll<HTMLElement>("[data-line]");
    const findRanges: Range[] = [];
    const activeRanges: Range[] = [];
    nodes.forEach((el) => {
      const line = lines[Number(el.dataset.line)];
      const node = el.firstChild;
      if (!line || !node || node.nodeType !== Node.TEXT_NODE) return;
      const base = line.start + line.prefix;
      const end = line.start + line.text.length;
      matches.forEach(([mStart, mEnd], index) => {
        if (mEnd <= base || mStart >= end) return;
        const localStart = Math.max(0, mStart - base);
        const localEnd = Math.min(end - base, mEnd - base);
        if (localEnd <= localStart) return;
        const range = document.createRange();
        range.setStart(node, localStart);
        range.setEnd(node, localEnd);
        (index === activeMatch ? activeRanges : findRanges).push(range);
      });
    });
    if (findRanges.length) api.registry.set("wb-find", new api.HighlightCtor(...findRanges));
    else api.registry.delete("wb-find");
    if (activeRanges.length)
      api.registry.set("wb-find-current", new api.HighlightCtor(...activeRanges));
    else api.registry.delete("wb-find-current");
    return cleanup;
  }, [matches, lines, activeMatch]);

  if (!hasContent) {
    return (
      <article ref={articleRef} className="wb-manuscript">
        {title ? <h1 className="wb-manuscript-title">{title}</h1> : null}
        <MetaLine items={meta} />
        <Empty title={emptyText} icon="book" />
      </article>
    );
  }

  const content = (line: Line) =>
    customHighlight ? line.text.slice(line.prefix) : renderWithMarks(line, matches, activeMatch);

  return (
    <article ref={articleRef} className="wb-manuscript">
      {leadHeading < 0 && title ? <h1 className="wb-manuscript-title">{title}</h1> : null}
      {leadHeading < 0 ? <MetaLine items={meta} /> : null}
      {lines.map((line, index) => {
        if (line.kind === "gap")
          return <p key={index} className="wb-manuscript-gap" aria-hidden="true" />;
        if (index === leadHeading)
          return (
            <React.Fragment key={index}>
              <h1 className="wb-manuscript-title" data-line={index}>
                {content(line)}
              </h1>
              <MetaLine items={meta} />
            </React.Fragment>
          );
        if (line.kind !== "p") {
          const Tag = line.kind === "h1" ? "h2" : line.kind;
          return (
            <Tag key={index} className="wb-manuscript-h" data-line={index}>
              {content(line)}
            </Tag>
          );
        }
        return (
          <p key={index} className="wb-manuscript-p" data-line={index}>
            {content(line)}
          </p>
        );
      })}
    </article>
  );
}

export const Manuscript = React.memo(ManuscriptView);
