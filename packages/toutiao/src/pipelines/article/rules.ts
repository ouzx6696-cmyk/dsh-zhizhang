import { AppError } from "@zhizhang/core/errors";
import { extractClaimCandidates, type ClaimCandidate } from "../../domain/claims.js";
import type {
  AntiGamingCounts,
  AntiGamingReport,
  ArticleReq,
  BlueprintOutput,
  FactCheckOutput,
} from "./schemas.js";

const ORAL_MARKER_WORDS = [
  "说白了",
  "讲真",
  "这事儿",
  "怎么说呢",
  "你别不信",
  "我琢磨",
  "反正",
  "话说回来",
  "得承认",
  "说实话",
  "其实",
  "大概",
  "可能",
  "我也没",
  "不敢瞎说",
  "——",
  "……",
] as const;

const SENTENCE_PARTICLE_RE = /[吧呢啊呗嘛哦呀哈嘿嗯](?=[，。！？…””’\s,.!?]|$)/g;

export function resolveDraftTrack(
  req: Pick<ArticleReq, "genre" | "driver" | "line">,
): "news" | "story" | "micro" {
  if (req.genre === "微头条") return "micro";
  if (req.driver === "故事型" || req.line === "故事线") return "story";
  return "news";
}

export function validateTitleMatrix(
  candidates: Array<{ text: string; motif: string }>,
  titleMax: number,
): { valid: Array<{ text: string; motif: string }>; dropped: string[] } {
  const valid: Array<{ text: string; motif: string }> = [];
  const dropped: string[] = [];
  for (const item of candidates) {
    if (item.text.length <= titleMax) {
      valid.push(item);
    } else {
      dropped.push(`${item.text}（超出 ${titleMax} 字）`);
    }
  }
  const motifs = new Set(valid.map((v) => v.motif));
  if (valid.length < 5 || motifs.size < 3) {
    throw new AppError("model.output_invalid", "标题矩阵需 ≥5 个合规标题且覆盖 ≥3 个母体", {
      validCount: valid.length,
      motifCount: motifs.size,
    });
  }
  return { valid, dropped };
}

export function filterChangedParagraphClaims(
  nextDraft: string,
  prevClaims: ClaimCandidate[],
): { reused: ClaimCandidate[]; toVerify: ClaimCandidate[] } {
  const fresh = extractClaimCandidates(nextDraft);
  const prevByPara = new Map<string, ClaimCandidate[]>();
  for (const c of prevClaims) {
    const list = prevByPara.get(c.paragraphHash) ?? [];
    list.push(c);
    prevByPara.set(c.paragraphHash, list);
  }
  const reused: ClaimCandidate[] = [];
  const toVerify: ClaimCandidate[] = [];
  for (const c of fresh) {
    const matched = prevByPara
      .get(c.paragraphHash)
      ?.find((p) => p.text === c.text && p.status === "supported");
    if (matched) reused.push({ ...matched, id: c.id });
    else toVerify.push(c);
  }
  return { reused, toVerify };
}

export function countOralMarkersAndHeadings(text: string): AntiGamingCounts {
  let oralMarkers = 0;
  for (const marker of ORAL_MARKER_WORDS) {
    let idx = 0;
    while ((idx = text.indexOf(marker, idx)) !== -1) {
      oralMarkers++;
      idx += marker.length;
    }
  }
  const particles = text.match(SENTENCE_PARTICLE_RE);
  if (particles) oralMarkers += particles.length;

  const headings = text.split(/\r?\n/).filter((line) => /^##\s+/.test(line.trim())).length;

  return { oralMarkers, headings };
}

export function evaluateAntiGaming(beforeText: string, afterText: string): AntiGamingReport {
  const before = countOralMarkersAndHeadings(beforeText);
  const after = countOralMarkersAndHeadings(afterText);
  const oralDelta = after.oralMarkers - before.oralMarkers;
  const headingDelta = after.headings - before.headings;
  const warnings: string[] = [];
  if (oralDelta > 0) {
    warnings.push(`口语标记在质检改稿后增加 ${oralDelta} 处，请核对是否靠堆口语词凑分`);
  }
  if (headingDelta > 0) {
    warnings.push(`小标题数量在质检改稿后增加 ${headingDelta} 处，请核对是否靠拆小标题凑结构分`);
  }
  return { before, after, oralDelta, headingDelta, warnings };
}

export function pickRotatedStyles(
  recentOpenings: string[] = [],
  recentEndings: string[] = [],
  availableOpenings: readonly string[] = [],
  availableEndings: readonly string[] = [],
): { openingStyle: string; endingStyle: string } {
  const lastOpening = recentOpenings.at(-1);
  const lastEnding = recentEndings.at(-1);
  const openingStyle =
    availableOpenings.find((s) => s !== lastOpening) ?? availableOpenings[0] ?? "";
  const endingStyle = availableEndings.find((s) => s !== lastEnding) ?? availableEndings[0] ?? "";
  return { openingStyle, endingStyle };
}

export function mergeFactResults(
  candidates: ClaimCandidate[],
  factOut: FactCheckOutput,
): { merged: ClaimCandidate[]; notes: string[] } {
  const byId = new Map(factOut.claims.map((c) => [c.id, c]));
  let unlocatedCount = 0;
  let unsupportedCount = 0;
  const merged = candidates.map((cand) => {
    const hit = byId.get(cand.id);
    if (!hit) {
      unlocatedCount++;
      return { ...cand, status: "unlocated" as const };
    }
    if (hit.status === "unlocated") unlocatedCount++;
    if (hit.status === "unsupported") unsupportedCount++;
    return {
      ...cand,
      status: hit.status,
      sourceId: hit.sourceId,
      evidence: hit.evidence,
    };
  });
  const notes: string[] = [];
  if (unlocatedCount > 0) {
    notes.push(`存在 ${unlocatedCount} 条 unlocated 事实待人工核对（不阻断流水线）`);
  }
  if (unsupportedCount > 0) {
    notes.push(`存在 ${unsupportedCount} 条 unsupported 事实需在改稿阶段核实或删改`);
  }
  return { merged, notes };
}

/**
 * 多路起稿轻量择优：结合标题规范、蓝图章节覆盖度、段落密度与口语堆砌惩罚选出最佳初稿，
 * 避免 draft×N 扇出后直接丢弃其余候选稿。
 */
export function selectBestDraftCandidate(
  candidates: readonly string[],
  title: string,
  blueprint: BlueprintOutput,
): { draft: string; index: number; score: number } {
  if (candidates.length === 0) {
    throw new AppError("model.output_invalid", "未生成可用起稿候选");
  }
  if (candidates.length === 1) {
    return { draft: candidates[0], index: 0, score: 0 };
  }

  let bestIndex = 0;
  let bestScore = -Infinity;

  for (let i = 0; i < candidates.length; i++) {
    const text = candidates[i];
    let score = 0;
    if (text.startsWith(`# ${title}`) || text.startsWith("# ")) score += 20;

    const sectionCount = blueprint.sections.length;
    if (sectionCount > 0) {
      let covered = 0;
      for (const sec of blueprint.sections) {
        if (sec.heading && text.includes(sec.heading)) covered++;
      }
      score += Math.round((covered / sectionCount) * 35);
    }

    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !p.startsWith("#"));
    const chars = text.replace(/\s+/g, "").length;
    if (paragraphs.length >= 4) score += 15;
    if (chars >= 600) score += 15;

    const counts = countOralMarkersAndHeadings(text);
    // 过度堆砌口语标记或拆碎小标题扣分
    if (counts.oralMarkers > 15) score -= Math.min(20, (counts.oralMarkers - 15) * 2);
    if (sectionCount > 0 && counts.headings > sectionCount + 3) {
      score -= (counts.headings - sectionCount - 3) * 3;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return { draft: candidates[bestIndex], index: bestIndex, score: bestScore };
}
