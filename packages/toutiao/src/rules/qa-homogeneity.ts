/**
 * 头条台账近稿同质化机械比对（段长分布、小标题位置、引语位置、结尾提问句式）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  END_QUESTION_RATIO,
  HOMOGENEITY_MIN_DRAFTS,
  HOMOGENEITY_WINDOW,
  PARA_BINS,
  PARA_DIST_WARN,
} from "./constants.js";
import { readLedgerFile } from "./ledger-store.js";
import { loadManuscript, type LoadedManuscript } from "./qa-parse.js";

interface HistoryEntry extends LoadedManuscript {
  id: string;
  date: string;
}

export async function loadHistory(
  ledgerPath: string | undefined,
  excludeId: string,
  excludeTitle: string,
): Promise<HistoryEntry[]> {
  if (!ledgerPath) return [];
  const rows = await readLedgerFile(ledgerPath).catch(() => []);
  if (rows.length === 0) return [];
  const root = path.dirname(path.resolve(ledgerPath));
  const out: HistoryEntry[] = [];
  for (const row of rows.slice(-HOMOGENEITY_WINDOW)) {
    const aid = (row["文章ID"] ?? "").trim();
    if (!aid || aid === excludeId) continue;
    if (excludeTitle && (row["主标题"] ?? "").trim() === excludeTitle) continue;
    const draftsDir = path.join(root, aid, "drafts");
    let entries: string[];
    try {
      entries = await fs.readdir(draftsDir);
    } catch {
      continue;
    }
    const revs = entries.filter((name) => /^rev-\d{3}\.md$/.test(name)).sort();
    if (revs.length === 0) continue;
    try {
      const doc = await loadManuscript(path.join(draftsDir, revs[revs.length - 1]));
      out.push({
        ...doc,
        id: aid,
        date: (row["日期"] ?? "").trim(),
        title: (row["主标题"] ?? "").trim() || doc.title,
      });
    } catch {
      // 历史稿不可读时跳过该篇，不阻断当前质检
    }
  }
  return out;
}

function paraHist(paras: string[]): number[] | null {
  const lens = paras.map((p) => p.replace(/\s/g, "").length).filter((n) => n > 0);
  if (lens.length === 0) return null;
  const hist = new Array<number>(PARA_BINS.length + 1).fill(0);
  for (const n of lens) {
    const bucket = PARA_BINS.findIndex((edge) => n < edge);
    hist[bucket === -1 ? PARA_BINS.length : bucket] += 1;
  }
  return hist.map((c) => c / lens.length);
}

function tvDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / 2;
}

function posPattern(indices: number[], total: number): string | null {
  if (total <= 0 || indices.length === 0) return null;
  return indices.map((i) => Math.min(3, Math.floor((i / total) * 4))).join(",");
}

function headingPattern(doc: {
  headings: string[];
  hpos: Array<[string, number]>;
  paras: string[];
}) {
  return {
    count: doc.headings.length,
    pos: posPattern(
      doc.hpos.map(([, idx]) => idx),
      doc.paras.length,
    ),
  };
}

function quotePattern(doc: { paras: string[] }): string | null {
  const indices: number[] = [];
  doc.paras.forEach((p, i) => {
    if (p.includes("“") || p.includes("”")) indices.push(i);
  });
  return indices.length >= 2 ? posPattern(indices, doc.paras.length) : null;
}

function endsQuestion(paras: string[]): boolean {
  const tail = paras.filter((p) => p.trim().length > 0);
  if (tail.length === 0) return false;
  return /[？?]\s*$|你怎么看|评论区|留言/.test(tail[tail.length - 1]);
}

export function checkHomogeneity(
  current: { paras: string[]; headings: string[]; hpos: Array<[string, number]> },
  history: HistoryEntry[],
): Array<["warn" | "note", string]> {
  const checks: Array<["warn" | "note", string]> = [];
  const comparable = history.filter((h) => h.paras.length > 0);
  if (comparable.length < HOMOGENEITY_MIN_DRAFTS) {
    checks.push([
      "note",
      `台账近 ${HOMOGENEITY_WINDOW} 篇里可比稿件只有 ${comparable.length} 篇（样本不足 ${HOMOGENEITY_MIN_DRAFTS} 篇），不做同质化判断`,
    ]);
    return checks;
  }
  const curHist = paraHist(current.paras);
  if (curHist) {
    let best: { dist: number; near: HistoryEntry } | null = null;
    for (const h of comparable) {
      const hHist = paraHist(h.paras);
      if (!hHist) continue;
      const dist = tvDistance(curHist, hHist);
      if (!best || dist < best.dist) best = { dist, near: h };
    }
    if (best && best.dist <= PARA_DIST_WARN) {
      checks.push([
        "warn",
        `同质化：段长分布与 ${best.near.date}《${best.near.title}》几乎一致（分布距离 ${best.dist.toFixed(2)}），换一种分段与节奏打法`,
      ]);
    }
  }
  const curH = headingPattern(current);
  if (curH.count > 0) {
    for (const h of comparable) {
      const hh = headingPattern(h);
      if (hh.count === curH.count && hh.pos === curH.pos) {
        checks.push([
          "warn",
          `同质化：小标题数量与位置模式和 ${h.date}《${h.title}》相同（${curH.count} 节，位置四分位 [${curH.pos ?? ""}]）`,
        ]);
        break;
      }
    }
  }
  const curQ = quotePattern(current);
  if (curQ) {
    for (const h of comparable) {
      if (quotePattern(h) === curQ) {
        checks.push([
          "warn",
          `同质化：引语位置模式和 ${h.date}《${h.title}》相同，把引语挪出四分位同格或改一处转述`,
        ]);
        break;
      }
    }
  }
  if (endsQuestion(current.paras)) {
    const asked = comparable.filter((h) => endsQuestion(h.paras)).length;
    if (asked >= Math.max(2, Math.round(comparable.length * END_QUESTION_RATIO))) {
      checks.push([
        "warn",
        `同质化：可比历史稿 ${asked}/${comparable.length} 篇结尾都是提问式，本篇也是；换一种收口（s4-common 结尾式）`,
      ]);
    }
  }
  return checks;
}
