import { createHash } from "node:crypto";
import { BRACKETED, HINTS, NUMBERED, SEMANTIC_PATTERNS, SEPARATOR, hintOf } from "./patterns.js";
import type { Para, Segment, SegmentOptions, SegmentResult } from "./types.js";

type Level = Segment["level"];
interface Line {
  text: string;
  start: number;
  end: number;
}
interface Heading {
  line: number;
  after: number;
  title: string;
  level: Level;
  semantic?: Segment["semantic"];
  style: string;
  meta?: boolean;
}

function linesOf(text: string): Line[] {
  const result: Line[] = [];
  const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  for (const match of text.matchAll(pattern)) {
    if (!match[0]) continue;
    const content = match[0].replace(/[\r\n]+$/, "");
    result.push({ text: content, start: match.index, end: match.index + content.length });
  }
  return result;
}

/** 作者映射使用 patterns.sample 的标题原文，避免把输入当作可执行正则。 */
function override(
  title: string,
  options: SegmentOptions,
): { level: Level; semantic: NonNullable<Segment["semantic"]> } | false | undefined {
  const rules = options.rules;
  if (rules?.ignore?.includes(title)) return false;
  for (const { semantic, level } of SEMANTIC_PATTERNS) {
    if (rules?.[semantic]?.includes(title)) return { semantic, level };
  }
  return undefined;
}

function headingsOf(lines: Line[], options: SegmentOptions): Heading[] {
  const headings: Heading[] = [];
  const styles = new Map<string, Level>();
  let fence: { marker: string; length: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const title = lines[i].text.trim();
    if (!title) continue;
    const mapped = override(title, options);
    if (mapped === false) continue;
    if (options.format === "md") {
      if (i === 0 && title === "---") {
        const close = lines.findIndex((line, index) => index > 0 && line.text.trim() === "---");
        if (close > 0) {
          headings.push({
            line: i,
            after: close + 1,
            title: "meta",
            level: 1,
            style: "meta",
            meta: true,
          });
          i = close;
          continue;
        }
      }
      const code = /^\s{0,3}(`{3,}|~{3,})(.*)$/u.exec(lines[i].text);
      if (fence) {
        if (
          code &&
          code[1][0] === fence.marker &&
          code[1].length >= fence.length &&
          !code[2].trim()
        )
          fence = undefined;
        continue;
      }
      if (code) {
        fence = { marker: code[1][0], length: code[1].length };
        continue;
      }
      const atx = /^\s{0,3}(#{1,6})\s+(.*)$/u.exec(lines[i].text);
      const setext = i + 1 < lines.length ? /^\s{0,3}(=+|-+)\s*$/u.exec(lines[i + 1].text) : null;
      if (!atx && !setext && !mapped) continue;
      const rawLevel = atx ? atx[1].length : setext?.[1][0] === "=" ? 1 : 2;
      const level: Level =
        rawLevel === 1
          ? 1
          : rawLevel === 2
            ? 2
            : rawLevel === 3
              ? 3
              : rawLevel === 4
                ? 4
                : rawLevel === 5
                  ? 5
                  : 6;
      const label = atx ? atx[2].replace(/\s+#+\s*$/u, "").trim() : title;
      const explicit = override(label, options);
      if (explicit === false) continue;
      const semantic = SEMANTIC_PATTERNS.find(({ pattern }) => pattern.test(label));
      headings.push({
        line: i,
        after: i + (atx || !setext ? 1 : 2),
        title: label,
        level: explicit ? explicit.level : (semantic?.level ?? level),
        semantic: explicit ? explicit.semantic : semantic?.semantic,
        style: atx ? `atx-${level}` : "setext",
      });
      if (!atx && setext) i++;
      continue;
    }
    const semantic = SEMANTIC_PATTERNS.find(({ pattern }) => pattern.test(title));
    const numbered = NUMBERED.exec(title);
    const bracketed = BRACKETED.test(title);
    const setting = HINTS.some(
      ([pattern, hint]) => !hint.startsWith("outline-") && pattern.test(title),
    );
    const isolated = title.length < 40 && !lines[i - 1]?.text.trim() && !lines[i + 1]?.text.trim();
    const score =
      (semantic ? 5 : 0) +
      (setting ? 4 : 0) +
      (numbered ? 3 : 0) +
      (bracketed ? 2 : 0) +
      (isolated ? 2 : 0) +
      (i > 0 && SEPARATOR.test(lines[i - 1].text.trim()) ? 1 : 0) -
      (/[。，,.]$/u.test(title) ? 4 : 0);
    if (!mapped && score < 5) continue;
    const style =
      semantic?.semantic ??
      (numbered
        ? `number-${numbered[1].replace(/[一二三四五六七八九十\d①-⑳]+/gu, "n")}`
        : bracketed
          ? "bracket"
          : "keyword");
    if (!mapped && !semantic && !styles.has(style))
      styles.set(style, styles.size === 0 ? 4 : styles.size === 1 ? 5 : 6);
    headings.push({
      line: i,
      after: i + 1,
      title,
      level: mapped ? mapped.level : (semantic?.level ?? styles.get(style) ?? 6),
      semantic: mapped ? mapped.semantic : semantic?.semantic,
      style,
    });
  }
  return headings;
}

function paragraphs(
  text: string,
  lines: Line[],
  start: number,
  end: number,
  id: number,
  lineMode: boolean,
  md: boolean,
): Para[] {
  const result: Para[] = [];
  let from: number | undefined;
  let to = 0;
  const flush = () => {
    if (from === undefined) return;
    const body = text.slice(from, to);
    result.push({
      id: `P${id}.${result.length + 1}`,
      start: from,
      end: to,
      hash: createHash("sha256").update(body).digest("hex").slice(0, 12),
    });
    from = undefined;
  };
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (!line.text.trim()) {
      flush();
      continue;
    }
    const row = md && line.text.includes("|");
    const item = md && /^\s*(?:[-+*]\s|\d+[.)]\s)/u.test(line.text);
    if (lineMode || row || item) flush();
    if (from === undefined) from = line.start;
    to = line.end;
    if (lineMode || row) flush();
  }
  flush();
  return result;
}

export function segment(text: string, options: SegmentOptions): SegmentResult {
  const lines = linesOf(text);
  const headings = headingsOf(lines, options);
  const nonempty = lines.filter((line) => line.text.trim());
  const indented = nonempty.filter((line) => line.text.startsWith("　　")).length;
  const noBlank = lines.every((line) => line.text.trim());
  const lineMode =
    options.format === "txt" &&
    nonempty.length > 0 &&
    (indented / nonempty.length >= 0.6 ||
      (noBlank && nonempty.every((line) => line.text.length < 200)));
  const result: SegmentResult = {
    format: options.format,
    segments: [],
    unassigned: [],
    patterns: [],
  };
  const path: Array<{ title: string; level: Level }> = [];
  const push = (
    id: number,
    title: string,
    level: Level,
    start: number,
    first: number,
    last: number,
    heading?: Heading,
  ) => {
    const end = last < lines.length ? lines[last].start : text.length;
    const paras = paragraphs(text, lines, first, last, id, lineMode, options.format === "md");
    // front matter 原样作为一段保留，后续可把它作为 meta 区识别。
    if (heading?.meta) {
      for (let i = 0; i < paras.length; i++) paras[i].id = `P${id}.${i + 2}`;
      paras.unshift({
        id: `P${id}.1`,
        start,
        end: lines[heading.after - 1].end,
        hash: createHash("sha256")
          .update(text.slice(start, lines[heading.after - 1].end))
          .digest("hex")
          .slice(0, 12),
      });
    }
    while (path.length && path[path.length - 1].level >= level) path.pop();
    path.push({ title, level });
    const firstBody = paras[0] ? text.slice(paras[0].start, paras[0].end) : "";
    result.segments.push({
      id: `S${id}`,
      title,
      level,
      start,
      end,
      paras,
      titlePath: path.map((item) => item.title),
      ...(heading?.semantic ? { semantic: heading.semantic } : {}),
      hint: heading?.meta ? "meta" : hintOf(`${title}\n${firstBody}`, heading?.semantic),
    });
  };
  if (!headings.length) {
    if (nonempty.length) push(1, "", 1, 0, 0, lines.length);
    return result;
  }
  const first = headings[0];
  if (lines.slice(0, first.line).some((line) => line.text.trim())) {
    push(0, "前言", 1, 0, 0, first.line);
    path.length = 0;
  }
  const samples = new Set<string>();
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    push(
      i + 1,
      heading.title,
      heading.level,
      lines[heading.line].start,
      heading.after,
      heading.meta ? heading.after : (headings[i + 1]?.line ?? lines.length),
      heading,
    );
    if (!samples.has(heading.title))
      result.patterns.push({
        sample: heading.title,
        level: heading.level,
        ...(heading.semantic ? { semantic: heading.semantic } : {}),
      });
    samples.add(heading.title);
    if (heading.meta) {
      path.length = 0;
      const next = headings[i + 1]?.line ?? lines.length;
      if (lines.slice(heading.after, next).some((line) => line.text.trim())) {
        push(0, "前言", 1, lines[heading.after].start, heading.after, next);
        path.length = 0;
      }
    }
  }
  return result;
}
