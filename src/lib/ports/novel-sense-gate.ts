/**
 * NovelSenseGate — soft sensor for 「不像一本小说」:
 * same-skeleton re-demo vs prev chapter, no book-debt at end, overly closed short-story ending.
 * Heuristics are humble (not a quality law). Default soft warn; strictNovel → deny.
 * Do NOT stack default hard deny with HumanFeelGate.
 */
import { allow, deny, warn, info, type GateDecision, type GateMessage } from "./types.js";
import { QUALITY_BOOK_DEBT_CUE_RE } from "./quality-policy.js";

export type NovelSenseHitCode =
  | "same_skeleton_redemo"
  | "no_book_debt"
  | "closed_short_story";

export interface NovelSenseHit {
  code: NovelSenseHitCode;
  text: string;
  evidence: string;
}

export interface NovelSenseAuditResult {
  hitCount: number;
  hits: NovelSenseHit[];
  summary: string;
}

const MIN_CHARS = 160;

/** Discovery / pairing ritual motifs often reused when re-demoing a prior chapter. */
const RITUAL_MOTIFS: Array<{ id: string; re: RegExp }> = [
  { id: "frost", re: /霜|结霜|霜面|霜结/ },
  { id: "mirror_shelf", re: /门内|对面|倒影|对轨|映出|空城/ },
  { id: "reach_swap", re: /伸手|抽出来|抽回来|换回|握住.*抽/ },
  { id: "equal_weight", re: /等重|同价位|同一瓶|同样的弧度|同样的重量/ },
  { id: "stock_gap", re: /少了一|少一罐|少一件|空着一个|缺口|差额/ },
  { id: "scan_ritual", re: /扫码|滴一声|复核|盘点|货架上/ },
];

/** Open book-debt cues — from QualityPolicy (excludes ledger-inventory words). */
const DEBT_CUE_RE = QUALITY_BOOK_DEBT_CUE_RE;

/** Strong short-story closure cues. */
const CLOSED_CUE_RE =
  /就像什么都没发生|一切(?:又)?恢复|一切如常|故事到此|就此结束|圆满|完整闭环|睡了个好觉|终于安心|尘埃落定|画上了句号|像从没发生过|岁月静好/;

export function auditNovelSense(
  text: string,
  opts?: { prevBody?: string | null },
): NovelSenseAuditResult {
  const body = String(text ?? "").trim();
  const hits: NovelSenseHit[] = [];
  if (body.length < MIN_CHARS) {
    return {
      hitCount: 0,
      hits: [],
      summary: `正文过短（${body.length} 字），书感软雷达跳过`,
    };
  }

  const prev = String(opts?.prevBody ?? "").trim();
  if (prev.length >= MIN_CHARS) {
    const iso = detectSameSkeletonRedemo(body, prev);
    if (iso) hits.push(iso);
  }

  const closed = detectClosedShortStory(body);
  if (closed) hits.push(closed);

  // Flat landing without strong closure phrase
  if (!closed) {
    const debt = detectNoBookDebt(body);
    if (debt) hits.push(debt);
  }

  const summary =
    hits.length === 0
      ? "书感软雷达未命中（启发式；≠质量过关）"
      : `书感软雷达命中 ${hits.length} 类：${hits.map((h) => h.code).join("、")}`;

  return { hitCount: hits.length, hits, summary };
}

function detectSameSkeletonRedemo(curr: string, prev: string): NovelSenseHit | null {
  const prevHits = RITUAL_MOTIFS.filter((m) => m.re.test(prev)).map((m) => m.id);
  const currHits = RITUAL_MOTIFS.filter((m) => m.re.test(curr)).map((m) => m.id);
  const shared = prevHits.filter((id) => currHits.includes(id));

  // Need a real ritual chain in both, not a single motif mention
  if (shared.length < 4) {
    // Fallback: dense shared 4-gram reuse of content phrases
    const reuse = sharedPhraseReuse(curr, prev);
    if (reuse.count < 5) return null;
    return {
      code: "same_skeleton_redemo",
      text: `同构再演示：与前章共用 ${reuse.count} 处较长短语，场面骨架像换皮重演。改法：相邻章换问题/主动权/办法。`,
      evidence: reuse.samples.slice(0, 3).join(" · "),
    };
  }

  return {
    code: "same_skeleton_redemo",
    text: `同构再演示：与前章共享发现链母题 ${shared.length} 项（${shared.join("、")}）。读感像再演示设定。改法：换主戏（人压/关系/新压力）。`,
    evidence: `前章母题=${prevHits.join(",")}；本章=${currHits.join(",")}`,
  };
}

function sharedPhraseReuse(
  curr: string,
  prev: string,
): { count: number; samples: string[] } {
  const grams = (t: string): Set<string> => {
    const clean = t.replace(/\s+/g, "");
    const out = new Set<string>();
    for (let i = 0; i + 4 <= clean.length; i++) {
      const g = clean.slice(i, i + 4);
      // skip pure punctuation / digits
      if (!/[\u4e00-\u9fff]{3}/.test(g)) continue;
      out.add(g);
    }
    return out;
  };
  const a = grams(curr);
  const b = grams(prev);
  const samples: string[] = [];
  let count = 0;
  for (const g of a) {
    if (b.has(g)) {
      count += 1;
      if (samples.length < 6) samples.push(g);
    }
  }
  // Normalize: raw 4-gram overlap is huge for same genre; require high absolute + density
  // Use unique shared 4-grams relative to shorter text length
  const shorter = Math.min(curr.replace(/\s+/g, "").length, prev.replace(/\s+/g, "").length);
  const density = shorter > 0 ? count / shorter : 0;
  // Only treat as reuse hit when both absolute and density look like copy-skeleton
  if (count < 40 || density < 0.08) {
    return { count: 0, samples: [] };
  }
  return { count, samples };
}

function endingSlice(text: string): string {
  const clean = text.trim();
  const byRatio = Math.floor(clean.length * 0.18);
  const n = Math.max(180, Math.min(360, byRatio || 220));
  return clean.slice(-n);
}

function detectNoBookDebt(text: string): NovelSenseHit | null {
  const end = endingSlice(text);
  if (DEBT_CUE_RE.test(end)) return null;
  // Also allow soft openers: unfinished action / unfinished dialogue at very end
  const tail = end.slice(-40);
  if (/[…？?]|没|还|先|再|门外|门口|钥匙|条子|悬|欠/.test(tail)) return null;

  return {
    code: "no_book_debt",
    text: `无书债：章末约 ${end.length} 字未见追读钩（下次/未知/选择/未了之事等）。回报在场后请留下行动、局面变化或有分量未知。`,
    evidence: end.slice(-72),
  };
}

function detectClosedShortStory(text: string): NovelSenseHit | null {
  // Use a tight tail so mid-chapter 账/数字不误伤「回报后留债」判断
  const clean = text.trim();
  const tail = clean.slice(-Math.min(140, Math.max(80, Math.floor(clean.length * 0.12))));
  if (!CLOSED_CUE_RE.test(tail)) return null;
  // 回报在场后再留债：尾句仍有追读钩则不算过闭环
  const tip = clean.slice(-64);
  if (DEBT_CUE_RE.test(tip)) return null;

  return {
    code: "closed_short_story",
    text: `过闭环：章末像独立短篇收束（恢复如常/尘埃落定类），且缺少继续动力。你在写长篇的一章，不是可单独完结的小品。`,
    evidence: tail.match(CLOSED_CUE_RE)?.[0] ?? tip.slice(0, 48),
  };
}

export function formatNovelSenseAudit(label: string, result: NovelSenseAuditResult): string {
  const head = [
    `书感软雷达 · ${label}`,
    `- 命中类数：${result.hitCount}`,
    `- ${result.summary}`,
    "",
    "说明：启发式传感，不是质量法；默认 accept 仅警告，strict_novel=true 可硬拒。与人味闸默认分轨（均 warn）。",
  ];
  if (result.hits.length === 0) return [...head, "", "未发现书感类命中。"].join("\n");
  const lines = result.hits.map(
    (h, i) => `${i + 1}. [${h.code}] ${h.text}${h.evidence ? `\n   例：${h.evidence}` : ""}`,
  );
  return [...head, "", ...lines].join("\n");
}

export const NovelSenseGate = {
  audit: auditNovelSense,

  evaluateAccept(opts: {
    body: string;
    prevBody?: string | null;
    strictNovel: boolean;
  }): GateDecision {
    const result = auditNovelSense(opts.body, { prevBody: opts.prevBody });
    if (opts.strictNovel && result.hitCount > 0) {
      return deny(
        "novel_sense_strict",
        `strict_novel=true：书感软雷达命中 ${result.hitCount} 类（${result.hits.map((h) => h.code).join("、")}），拒绝采纳。请改稿后重扫，或关闭 strict_novel（默认仅警告 novel_sense_hits）。`,
      );
    }
    if (result.hitCount > 0) {
      const msgs: GateMessage[] = result.hits.map((h) =>
        warn("novel_sense_hits", `${h.code}：${h.text}`),
      );
      return allow(msgs);
    }
    return allow([info("novel_sense_ok", result.summary)]);
  },
};
