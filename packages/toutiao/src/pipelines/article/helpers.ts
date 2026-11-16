import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import type { ContextBlock, ContextPacket } from "@zhizhang/core/pipeline";
import { extractClaimCandidates, type ClaimCandidate } from "../../domain/claims.js";
import type { AntiGamingCounts, AntiGamingReport, ArticleReq, FactCheckOutput } from "./types.js";

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
const DEFAULT_SCRIPTS_DIR = path.resolve(import.meta.dirname, "../../../skill/scripts");
const DEFAULT_PROFILE_DIR = path.resolve(import.meta.dirname, "../../../profiles/default");

export function resolveScriptsDir(req: ArticleReq): string {
  return req.scriptsDir || process.env.ZHIZHANG_TOUTIAO_SCRIPTS_DIR || DEFAULT_SCRIPTS_DIR;
}

export function resolveProfileDir(req: ArticleReq): string {
  return req.profileDir || process.env.WRITER_TOUTIAO_DEFAULT_DIR || DEFAULT_PROFILE_DIR;
}

export function extractJsonBlock<T>(raw: string): T {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch (err) {
    throw new AppError("model.output_invalid", "模型输出不是合法 JSON", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

export function makePacket(blocks: ContextBlock[], userBlocks: ContextBlock[] = []): ContextPacket {
  return {
    prefix: blocks,
    suffix: userBlocks,
    omitted: [],
    estimate: blocks.reduce((acc, b) => acc + b.tokens, 0),
  };
}

export function refBlock(id: string, ref: string, text: string): ContextBlock {
  return {
    id,
    layer: 2,
    text,
    required: true,
    tokens: Math.ceil(text.length / 2),
    reason: `stage reference: ${ref}`,
    source: { kind: "reference", ref },
  };
}

export function validateTitleMatrix(
  candidates: Array<{ text: string; motif: string }>,
  titleMax: number,
): { valid: Array<{ text: string; motif: string }>; dropped: string[] } {
  const valid: Array<{ text: string; motif: string }> = [];
  const dropped: string[] = [];
  for (const item of candidates) {
    if (item.text.length <= titleMax) valid.push(item);
    else dropped.push(`${item.text}（超出 ${titleMax} 字）`);
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
