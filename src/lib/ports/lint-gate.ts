/**
 * LintGate — token = sensor ran; hitCount echoed; hits soft-warn by default.
 */
import type { CandidateFile } from "../types.js";
import { markCandidateLinted } from "../store.js";
import { allow, deny, warn, type GateDecision } from "./types.js";

export const LintGate = {
  async issueToken(
    dir: string,
    candidateId: string,
    hitCount: number,
  ): Promise<{ token: string; lintedAt: string; hitCount: number; chapterId: string }> {
    return markCandidateLinted(dir, candidateId, hitCount);
  },

  hitCountOf(cand: CandidateFile): number {
    return typeof cand.lintHitCount === "number" ? cand.lintHitCount : 0;
  },

  evaluateAccept(opts: { hitCount: number; strictLint: boolean }): GateDecision {
    const { hitCount, strictLint } = opts;
    if (strictLint && hitCount > 0) {
      return deny(
        "lint_hits_strict",
        `strict_lint=true：语感雷达命中 ${hitCount} 处，拒绝采纳。扫过≠过关；请改稿后重新 stage→lint，或关闭 strict_lint（默认允许并警告 lint_hits_present）。`,
      );
    }
    if (hitCount > 0) {
      return allow([
        warn(
          "lint_hits_present",
          `雷达命中 ${hitCount} 处。扫过≠过关；建议对照命中改稿。默认仍允许采纳；strict_lint=true 时可硬拒。`,
        ),
      ]);
    }
    return allow();
  },

  /** Always include on accept receipt. */
  echoLines(hitCount: number): string[] {
    return [
      `lintHitCount：${hitCount}（语感雷达命中数；lintPassToken 仅证明已扫过，扫过≠质量过关）`,
    ];
  },
};
