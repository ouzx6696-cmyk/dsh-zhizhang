/**
 * 拆书量化测绘、分层抽样与逐字引文核验（纯函数模块）。
 * 与 novel_scanner.py / quote_check.py 保持一致的章界、章末钩子与核心汉字比对口径。
 */

const CHAPTER_PAT =
  /^\s*(?:#{1,4}\s*)?(序章|楔子|引子|尾声|番外.*|C\d{3,4}[\s·:：].*|第[零一二三四五六七八九十百千万0-9]{1,6}[章节回幕折]\s*.*)$/;

const HOOK_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "悬念提问型", pattern: /[？?]|到底|究竟|是谁|怎么会/ },
  { label: "危机降临型", pattern: /不好|完了|快跑|杀|死|血|猛地|骤然|轰|警报/ },
  { label: "反转揭秘型", pattern: /竟然|居然|原来|根本不是|而是|露出|真正的/ },
  { label: "收获期待型", pattern: /到账|突破|成了|系统|奖励|到手|发财|归我/ },
];

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

export interface ScannedChapter {
  index: number;
  title: string;
  startLine: number;
  endLine: number;
  charCount: number;
  hookType: string;
  body: string;
}

export interface SamplingReport {
  totalChars: number;
  chapterCount: number;
  sampledCount: number;
  readScope: "full" | "sampled";
  sample: string;
  chunks: string[];
  hookSummary: string;
}

export type QuoteAuditStatus = "verified" | "partial" | "unverified";

export interface QuoteAuditResult {
  status: QuoteAuditStatus;
  sourceLine?: number;
  overlap: number;
}

function classifyHook(tail: string): string {
  const matched = HOOK_PATTERNS.filter((h) => h.pattern.test(tail)).map((h) => h.label);
  return matched.length > 0 ? matched.join("+") : "余韵/动作落点型";
}

function cjkCore(text: string): string {
  return (text.match(CJK_RE) ?? []).join("");
}

/** 按章节标题切分原文并统计字数与章末钩子类型。 */
export function scanSourceChapters(text: string): ScannedChapter[] {
  const lines = text.split(/\r?\n/);
  const headings: Array<{ line: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.length > 60) continue;
    if (CHAPTER_PAT.test(trimmed)) {
      headings.push({ line: i + 1, title: trimmed });
    }
  }
  if (headings.length === 0) return [];

  return headings.map((h, idx) => {
    const startLine = h.line;
    const endLine = idx + 1 < headings.length ? headings[idx + 1].line - 1 : lines.length;
    const bodyLines = lines
      .slice(startLine, endLine)
      .map((l) => l.trim())
      .filter(Boolean);
    const body = bodyLines.join("\n");
    const tail = bodyLines.slice(-3).join(" / ");
    return {
      index: idx + 1,
      title: h.title,
      startLine,
      endLine,
      charCount: body.replace(/\s+/g, "").length,
      hookType: classifyHook(tail),
      body,
    };
  });
}

/**
 * 分层抽样（开篇前 3 章 + 中段等距锚点 + 末尾 2 章），确保长书拆解有明确阅读范围标注；
 * 无章节标题时按块切分，并诚实标记 full / sampled。
 */
export function stratifiedSampleSource(
  text: string,
  maxChunks = 10,
  chunkSize = 4000,
): SamplingReport {
  const totalChars = text.replace(/\s+/g, "").length;
  const chapters = scanSourceChapters(text);

  if (chapters.length > 0) {
    const pickedIndices = new Set<number>();
    if (chapters.length <= maxChunks) {
      for (let i = 0; i < chapters.length; i++) pickedIndices.add(i);
    } else {
      for (let i = 0; i < Math.min(3, chapters.length); i++) pickedIndices.add(i);
      for (let i = Math.max(0, chapters.length - 2); i < chapters.length; i++) pickedIndices.add(i);
      const middleSlots = Math.max(0, maxChunks - pickedIndices.size);
      if (middleSlots > 0) {
        const start = 3;
        const end = chapters.length - 2;
        const step = Math.max(1, (end - start) / (middleSlots + 1));
        for (let slot = 1; slot <= middleSlots; slot++) {
          const idx = Math.min(end - 1, Math.floor(start + step * slot));
          pickedIndices.add(idx);
        }
      }
    }

    const ordered = Array.from(pickedIndices)
      .sort((a, b) => a - b)
      .map((idx) => chapters[idx]);

    const hookCounts = new Map<string, number>();
    for (const ch of ordered) {
      hookCounts.set(ch.hookType, (hookCounts.get(ch.hookType) ?? 0) + 1);
    }
    const hookSummary = Array.from(hookCounts.entries())
      .map(([kind, count]) => `${kind} ${count} 章`)
      .join("；");

    const chunks = ordered.map(
      (ch) =>
        `[第${ch.index}章 ${ch.title} | L${ch.startLine}-${ch.endLine} | ${ch.charCount}字 | 章末:${ch.hookType}]\n${ch.body.slice(0, chunkSize)}`,
    );
    const readScope =
      ordered.length === chapters.length && ordered.every((c) => c.body.length <= chunkSize)
        ? "full"
        : "sampled";
    return {
      totalChars,
      chapterCount: chapters.length,
      sampledCount: ordered.length,
      readScope,
      sample: chunks[0]?.slice(0, 2200) ?? text.slice(0, 2000),
      chunks,
      hookSummary,
    };
  }

  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < maxChunks; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  const readScope = chunks.length * chunkSize >= text.length ? "full" : "sampled";
  return {
    totalChars,
    chapterCount: 0,
    sampledCount: chunks.length,
    readScope,
    sample: text.slice(0, 2000),
    chunks,
    hookSummary: "片段样章（未检测到卷章标题）",
  };
}

/** 核对引文是否为原文逐字内容（去标点与空白后比对核心汉字串）。 */
export function verifyQuoteAgainstSource(sourceText: string, quote: string): QuoteAuditResult {
  const target = cjkCore(quote);
  if (target.length < 4) {
    return { status: "unverified", overlap: 0 };
  }

  const lines = sourceText.split(/\r?\n/);
  const chars: string[] = [];
  const lineOf: number[] = [];
  for (let no = 0; no < lines.length; no++) {
    const core = cjkCore(lines[no]);
    for (let j = 0; j < core.length; j++) {
      chars.push(core[j]);
      lineOf.push(no + 1);
    }
  }
  const src = chars.join("");
  const exactPos = src.indexOf(target);
  if (exactPos >= 0) {
    return { status: "verified", sourceLine: lineOf[exactPos], overlap: 1 };
  }

  // 滑动窗口检测最长连续公共片段，判断是否为部分命中（记错/删改）
  const probeLen = Math.max(4, Math.floor(target.length / 2));
  let bestMatch = 0;
  let bestLine: number | undefined;
  for (let start = 0; start <= target.length - probeLen; start++) {
    const sub = target.slice(start, start + probeLen);
    const hit = src.indexOf(sub);
    if (hit < 0) continue;
    let len = probeLen;
    while (
      start + len < target.length &&
      hit + len < src.length &&
      target[start + len] === src[hit + len]
    ) {
      len += 1;
    }
    if (len > bestMatch) {
      bestMatch = len;
      bestLine = lineOf[hit];
    }
  }
  const overlap = Number((bestMatch / target.length).toFixed(2));
  return {
    status: overlap >= 0.5 ? "partial" : "unverified",
    ...(bestLine !== undefined ? { sourceLine: bestLine } : {}),
    overlap,
  };
}

export interface QuoteAuditableCard {
  example: string;
  quoteStatus?: QuoteAuditStatus;
  quoteLine?: number;
}

/** 批量核验技法卡引文，并返回核验统计。 */
export function auditTechniqueCards<T extends QuoteAuditableCard>(
  sourceText: string,
  cards: readonly T[],
): {
  cards: T[];
  stats: { verified: number; partial: number; unverified: number };
} {
  let verified = 0;
  let partial = 0;
  let unverified = 0;
  const audited = cards.map((card) => {
    const check = verifyQuoteAgainstSource(sourceText, card.example);
    if (check.status === "verified") verified += 1;
    else if (check.status === "partial") partial += 1;
    else unverified += 1;
    return {
      ...card,
      quoteStatus: check.status,
      ...(check.sourceLine !== undefined ? { quoteLine: check.sourceLine } : {}),
    };
  });
  return {
    cards: audited,
    stats: { verified, partial, unverified },
  };
}
