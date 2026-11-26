export type LegacyEncoding = "utf-8" | "utf-8-bom" | "gb18030";

export interface LegacyChapterChunk {
  number: number | null;
  title: string;
  body: string;
  volume?: string;
  kind?: "prelude" | "chapter";
  sourceFilename?: string;
}

export interface LegacySplitReport {
  chunks: LegacyChapterChunk[];
  hasPrelude: boolean;
  preludeChars: number;
  emptyHeadings: string[];
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CN_UNITS: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
  万: 10000,
};

const VOLUME_HEADING_RE = /^\s*第([零〇一二三四五六七八九十百千万两\d]+)[卷部](?:\s+.*|\s*)$/;

const CHAPTER_HEADING_RE =
  /^\s*(?:第([零〇一二三四五六七八九十百千万两\d]+)[章节回](?:\s*[:：.\-—]?\s*(.*))?|(?:Chapter|CHAPTER)\s+(\d+)\s*[:：.\-]?\s*(.*))$/;

export function decodeTextBufferWithEncoding(buf: Uint8Array): {
  text: string;
  encoding: LegacyEncoding;
} {
  const hasUtf8Bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return {
      text: utf8.replace(/^\uFEFF/, ""),
      encoding: hasUtf8Bom ? "utf-8-bom" : "utf-8",
    };
  } catch {
    return {
      text: new TextDecoder("gb18030").decode(buf).replace(/^\uFEFF/, ""),
      encoding: "gb18030",
    };
  }
}

export function decodeTextBuffer(buf: Uint8Array): string {
  return decodeTextBufferWithEncoding(buf).text;
}

export function parseChineseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);

  let total = 0;
  let section = 0;
  let current = 0;
  let sawValid = false;

  for (const ch of trimmed) {
    if (ch in CN_DIGITS) {
      current = CN_DIGITS[ch];
      sawValid = true;
    } else if (ch in CN_UNITS) {
      const unit = CN_UNITS[ch];
      sawValid = true;
      if (unit === 10000) {
        section = (section + current) * unit;
        total += section;
        section = 0;
        current = 0;
      } else {
        const factor = current === 0 && unit === 10 && section === 0 ? 1 : current;
        section += factor * unit;
        current = 0;
      }
    } else {
      return null;
    }
  }
  return sawValid ? total + section + current : null;
}

export function splitLegacyChaptersDetailed(rawText: string): LegacySplitReport {
  const normalized = rawText.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const rawChunks: Array<{
    number: number | null;
    title: string;
    volume?: string;
    lines: string[];
  }> = [];
  let current: { number: number | null; title: string; volume?: string; lines: string[] } | null =
    null;
  let currentVolume: string | undefined;
  const preludeLines: string[] = [];

  for (const line of lines) {
    if (VOLUME_HEADING_RE.test(line)) {
      currentVolume = line.trim();
      continue;
    }
    const match = CHAPTER_HEADING_RE.exec(line);
    if (match) {
      if (current) rawChunks.push(current);
      const rawNum = match[1] ?? match[3] ?? "";
      const parsedNum = parseChineseNumber(rawNum);
      current = {
        number: parsedNum,
        title: line.trim(),
        ...(currentVolume ? { volume: currentVolume } : {}),
        lines: [],
      };
    } else if (current) {
      current.lines.push(line);
    } else {
      preludeLines.push(line);
    }
  }
  if (current) rawChunks.push(current);

  const emptyHeadings: string[] = [];
  const cleaned: LegacyChapterChunk[] = [];
  for (const chunk of rawChunks) {
    const body = chunk.lines.join("\n").trim();
    if (body.length === 0) {
      emptyHeadings.push(chunk.title);
      continue;
    }
    cleaned.push({
      number: chunk.number,
      title: chunk.title,
      body,
      ...(chunk.volume ? { volume: chunk.volume } : {}),
      kind: "chapter",
    });
  }

  if (cleaned.length === 0) {
    const whole = normalized.trim();
    if (!whole) {
      return { chunks: [], hasPrelude: false, preludeChars: 0, emptyHeadings };
    }
    return {
      chunks: [{ number: 1, title: "第1章", body: whole, kind: "chapter" }],
      hasPrelude: false,
      preludeChars: 0,
      emptyHeadings,
    };
  }

  const prelude = preludeLines.join("\n").trim();
  if (prelude.length > 0) {
    return {
      chunks: [{ number: 0, title: "楔子", body: prelude, kind: "prelude" }, ...cleaned],
      hasPrelude: true,
      preludeChars: prelude.length,
      emptyHeadings,
    };
  }
  return { chunks: cleaned, hasPrelude: false, preludeChars: 0, emptyHeadings };
}

export function splitLegacyChapters(rawText: string): LegacyChapterChunk[] {
  return splitLegacyChaptersDetailed(rawText).chunks;
}

export function formatChapterId(index: number): string {
  return `C${String(index).padStart(3, "0")}`;
}

export function extractFilenameOrder(filename: string): number {
  const stem = filename.replace(/\.[^.]+$/, "");
  const cnMatch = /第([零〇一二三四五六七八九十百千万两\d]+)[章节回]/.exec(stem);
  if (cnMatch) {
    const parsed = parseChineseNumber(cnMatch[1]);
    if (parsed !== null) return parsed;
  }
  const numMatch = /(\d+)/.exec(stem);
  return numMatch ? Number.parseInt(numMatch[1], 10) : Number.MAX_SAFE_INTEGER;
}

export function extractMarkdownTitleAndBody(
  raw: string,
  fallbackTitle: string,
): { title: string; body: string } {
  const normalized = raw.replace(/\r\n?/g, "\n").trim();
  const firstBreak = normalized.indexOf("\n");
  const firstLine = (firstBreak === -1 ? normalized : normalized.slice(0, firstBreak)).trim();
  if (firstLine.startsWith("# ")) {
    const title = firstLine.slice(2).trim() || fallbackTitle;
    const body = firstBreak === -1 ? "" : normalized.slice(firstBreak + 1).trim();
    return { title, body };
  }
  return { title: fallbackTitle, body: normalized };
}
