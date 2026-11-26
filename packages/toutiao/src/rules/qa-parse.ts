/**
 * 头条文稿解析、标点规范检查、标题力评分与标记密集区检测。
 */
import fs from "node:fs/promises";
import {
  EXT_SHINGLE,
  HEAD8_EXTRA,
  HOOK_T,
  IMG_MARK_RE,
  IMG_RE,
  MARKER_BOLD_RUN,
  MARKER_QUOTE_RUN,
  NUM_T,
  PERSON_T,
  PUNCT_RULES,
  SENT_SPLIT,
  SHORT_SECTION_LIMIT,
  TITLE_BAN,
} from "./constants.js";

export interface LoadedManuscript {
  title: string;
  headings: string[];
  paras: string[];
  images: number;
  hpos: Array<[string, number]>;
  bold: number;
  boldByPara: number[];
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function countStr(text: string, sub: string): number {
  if (!sub) return 0;
  let total = 0;
  let pos = 0;
  while ((pos = text.indexOf(sub, pos)) !== -1) {
    total += 1;
    pos += sub.length;
  }
  return total;
}

export function countMatches(text: string, pattern: string | RegExp): number {
  const re =
    typeof pattern === "string"
      ? new RegExp(pattern, "g")
      : new RegExp(
          pattern.source,
          pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
        );
  let count = 0;
  while (re.exec(text) !== null) count += 1;
  return count;
}

export function cnLen(s: string): number {
  return s.replace(/[^\u4e00-\u9fa5]/g, "").length;
}

export function splitSents(text: string): string[] {
  return text
    .split(SENT_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normH(h: string | undefined): string {
  return (h ?? "").replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "");
}

export function splitExt(
  paras: string[],
  hpos: Array<[string, number]>,
  extStart: string | undefined,
): [string[], string[]] | null {
  const key = normH(extStart);
  if (!key) return null;
  for (const [h, idx] of hpos) {
    const nh = normH(h);
    if (nh && (nh === key || nh.includes(key) || key.includes(nh))) {
      return [paras.slice(0, idx), paras.slice(idx)];
    }
  }
  return null;
}

export function extOverlap(main: string[], ext: string[], k = EXT_SHINGLE): number {
  const cm = main.join("").replace(/[^\u4e00-\u9fa5]/g, "");
  const ce = ext.join("").replace(/[^\u4e00-\u9fa5]/g, "");
  if (ce.length < k) return 0;
  const gm = new Set<string>();
  for (let i = 0; i <= cm.length - k; i += 1) gm.add(cm.slice(i, i + k));
  let hit = 0;
  const total = ce.length - k + 1;
  for (let i = 0; i < total; i += 1) {
    if (gm.has(ce.slice(i, i + k))) hit += 1;
  }
  return hit / total;
}

export function punctIssues(chunks: string[]): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const [pat, label, fix] of PUNCT_RULES) {
    let found = 0;
    for (const chunk of chunks) {
      const text = chunk ?? "";
      const re = new RegExp(pat.source, pat.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const a = Math.max(0, m.index - 6);
        const b = m.index + m[0].length + 6;
        out.push([label, fix, text.slice(a, b).trim()]);
        found += 1;
        if (found >= 2) break;
      }
      if (found >= 2) break;
    }
  }
  return out;
}

export async function loadManuscript(filePath: string): Promise<LoadedManuscript> {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split(/\r\n|\n|\r/);
  let title = "";
  const headings: string[] = [];
  const paras: string[] = [];
  let images = 0;
  const hpos: Array<[string, number]> = [];
  const boldByPara: number[] = [];
  let bold = 0;
  for (const ln of lines) {
    const spans = Math.floor(countMatches(ln, /\*\*|__|~~/g) / 2);
    bold += spans;
    let s = ln.replace(/\*\*|__|~~/g, "").trim();
    if (!s) continue;
    if (s.startsWith("#")) {
      const h = s.replace(/^#+/, "").trim();
      if (s.startsWith("# ") && !title) {
        title = h;
      } else {
        headings.push(h);
        hpos.push([h, paras.length]);
      }
      continue;
    }
    if (IMG_RE.test(s) || IMG_MARK_RE.test(s)) {
      images += 1;
      continue;
    }
    if (/^[-*_]{3,}$/.test(s)) continue;
    s = s.replace(/^(>\s*)+/, "");
    s = s.replace(/^([-*+]|\d+[.、])\s+/, "");
    if (s) {
      paras.push(s);
      boldByPara.push(spans);
    }
  }
  return { title, headings, paras, images, hpos, bold, boldByPara };
}

export function titleScore(t: string, micro: boolean, names: readonly string[]): number {
  const validNames = names.filter((n) => n && n.length >= 2).map(escapeRe);
  let hl = 55;
  if (micro) {
    hl += t.length >= 8 && t.length <= 30 ? 20 : t.length <= 45 ? 10 : 0;
  } else {
    hl += t.length >= 18 && t.length <= 28 ? 20 : t.length >= 14 ? 10 : 0;
  }
  if (new RegExp(NUM_T).test(t)) hl += 6;
  const person = validNames.length ? `${PERSON_T}|${validNames.join("|")}` : PERSON_T;
  if (new RegExp(person).test(t)) hl += 8;
  if (new RegExp(HOOK_T).test(t)) hl += 6;
  if (new RegExp(`${NUM_T}|${person}|${HOOK_T}${HEAD8_EXTRA}`).test(t.slice(0, 8))) hl += 5;
  else hl -= 6;
  if (/[？！?!]/.test(t)) hl += 3;
  if (new RegExp(TITLE_BAN).test(t)) hl -= 35;
  return clamp(hl);
}

export function markerDensityHints(
  paras: string[],
  boldByPara: number[],
  hpos: Array<[string, number]>,
): string[] {
  const hints: string[] = [];
  const runs = (flags: boolean[], minRun: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    let start: number | null = null;
    const ext = [...flags, false];
    for (let i = 0; i < ext.length; i += 1) {
      if (ext[i] && start === null) start = i;
      else if (!ext[i] && start !== null) {
        if (i - start >= minRun) out.push([start, i - 1]);
        start = null;
      }
    }
    return out;
  };
  for (const [a, b] of runs(
    boldByPara.map((n) => n >= 1),
    MARKER_BOLD_RUN,
  )) {
    hints.push(
      `标记密集区：第 ${a + 1}–${b + 1} 段连续加粗，粘到头条编辑器一片黑，只留最关键的一处`,
    );
  }
  for (const [a, b] of runs(
    paras.map((p) => p.includes("“") || p.includes("”")),
    MARKER_QUOTE_RUN,
  )) {
    hints.push(
      `标记密集区：第 ${a + 1}–${b + 1} 段每段都带引语，读起来像问答体，隔开一段或改一处转述`,
    );
  }
  let shortSections = 0;
  for (let i = 1; i < hpos.length; i += 1) {
    const diff = hpos[i][1] - hpos[i - 1][1];
    if (diff > 0 && diff <= SHORT_SECTION_LIMIT) shortSections += 1;
  }
  if (shortSections >= 3) {
    hints.push(
      `标记密集区：有 ${shortSections} 处相邻小标题之间只有 1~2 段，小标题过密，合并或加内容`,
    );
  }
  return hints;
}
