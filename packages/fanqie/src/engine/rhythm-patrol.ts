/**
 * 长线节奏巡检（纯函数，不读盘；panel nextHints 接线留给 T11）。
 *
 * 判据来源（packages/fanqie/profiles/default/rhythm.md）：
 *   - 六、长线节奏的三种病：「连续多章受挫……兑现一推再推」「另查：是否连续
 *     多章用同一种冲突模式」「连续两章没有任何可感变化，就不是慢，是空」。
 *   - 一、档位表「受压时长」：快爽「一般不跨 2 章」；稳推「可更长，但每章看
 *     得到人物在想办法」；慢燃「允许长压」——只有快爽有数值上限。
 *
 * 输入由调用方从章纲存储合成（真实字段）：
 *   conflict     = outline.conflict（核心冲突）
 *   progression  = outline.beats + outline.ending（推进节点+章末落点，即
 *                  「本章变化/所得」的现有载体；章纲无独立变化字段）
 *   pressureCount= 本章受压计数（0 = 未受压；受压章连续计，上限按档位）
 */
type StoryPace = "快爽" | "稳推" | "慢燃";

/** 各档受压章数上限；null = 方法无数值刻度，不硬判（由可感变化检查兜底）。 */
const PRESSURE_CAP_BY_PACE: Record<StoryPace, number | null> = {
  快爽: 2,
  稳推: null,
  慢燃: null,
};

/** 巡检窗口默认值：最近 10 章。 */
export const PATROL_WINDOW = 10;

/** 相邻冲突字段判「同一模式」的 bigram 相似度阈值。 */
const SAME_CONFLICT_SIMILARITY = 0.6;
/** 相邻推进/落点判「雷同」的 bigram 相似度阈值。 */
const DUPLICATE_PROGRESSION_SIMILARITY = 0.8;
/** 相似度比较的最短字数：过短的串只按整串相同判，不做 bigram。 */
const COMPARE_MIN_CHARS = 8;

interface RhythmPatrolChapter {
  chapterId: string;
  /** outline.conflict（核心冲突字段）。 */
  conflict: string;
  /** 本章变化/所得代理：beats+ending 合成（章纲无独立变化字段）。 */
  progression: string;
  /** 本章受压计数；0 = 未受压。 */
  pressureCount: number;
}

export interface RhythmPatrolCandidate {
  kind: "same_conflict_run" | "no_perceptible_change" | "pressure_over_cap";
  chapters: string[];
  evidence: string;
}

function cjkBigrams(text: string) {
  const chars = text.match(/[\u4e00-\u9fff]/g) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + 2 <= chars.length; i++) out.add(chars.slice(i, i + 2).join(""));
  return out;
}
function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit++;
  return hit / (a.size + b.size - hit);
}
function compactLength(text: string) {
  return text.replace(/\s+/g, "").length;
}
/** 近同判定：整串相同，或两串都够长且 CJK bigram 相似度达阈值。返回相似度供证据引用。 */
function samePattern(a: string, b: string, threshold: number) {
  const ta = a.trim();
  const tb = b.trim();
  if (!ta || !tb) return { similar: false, value: 0 };
  const value = jaccard(cjkBigrams(ta), cjkBigrams(tb));
  const similar =
    ta === tb ||
    (compactLength(ta) >= COMPARE_MIN_CHARS &&
      compactLength(tb) >= COMPARE_MIN_CHARS &&
      value >= threshold);
  return { similar, value };
}
/** 按 same[i]（全局序 i 与 i+1 是否同组）把章节切成连跑段，返回全局下标段。 */
function collectRuns(samePair: boolean[]) {
  const runs: number[][] = [];
  let run = [0];
  for (let i = 0; i < samePair.length; i++) {
    if (samePair[i]) {
      run.push(i + 1);
      continue;
    }
    runs.push(run);
    run = [i + 1];
  }
  runs.push(run);
  return runs;
}
function clip(text: string, max: number) {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function conflictRunCandidates(chapters: RhythmPatrolChapter[]): RhythmPatrolCandidate[] {
  const out: RhythmPatrolCandidate[] = [];
  const pairs = chapters
    .slice(0, -1)
    .map((ch, i) => samePattern(ch.conflict, chapters[i + 1].conflict, SAME_CONFLICT_SIMILARITY));
  for (const run of collectRuns(pairs.map((p) => p.similar))) {
    if (run.length < 3) continue;
    const lowest = Math.min(...run.slice(0, -1).map((i) => pairs[i].value));
    out.push({
      kind: "same_conflict_run",
      chapters: run.map((i) => chapters[i].chapterId),
      evidence: `冲突字段连续近同（相邻 bigram 相似度最低 ${lowest.toFixed(2)} ≥ ${SAME_CONFLICT_SIMILARITY}）：「${clip(
        chapters[run[0]].conflict,
        40,
      )}」——rhythm：连续多章同一冲突模式应回规划重排，不在正文硬救`,
    });
  }
  return out;
}

function noChangeCandidates(chapters: RhythmPatrolChapter[]): RhythmPatrolCandidate[] {
  const out: RhythmPatrolCandidate[] = [];
  const reasons = chapters.map((ch, i) => {
    if (!ch.progression.trim()) return { id: ch.chapterId, reason: "章纲未写推进与落点" };
    if (i > 0) {
      const { similar, value } = samePattern(
        ch.progression,
        chapters[i - 1].progression,
        DUPLICATE_PROGRESSION_SIMILARITY,
      );
      if (similar) return { id: ch.chapterId, reason: `与前章雷同（${value.toFixed(2)}）` };
    }
    return null;
  });
  let run: string[] = [];
  const detail: string[] = [];
  const flush = () => {
    if (run.length >= 2)
      out.push({
        kind: "no_perceptible_change",
        chapters: run,
        evidence: `${detail.join("；")}——rhythm：连续两章没有任何可感变化，就不是慢，是空`,
      });
    run = [];
    detail.length = 0;
  };
  for (let i = 0; i < chapters.length; i++) {
    const reason = reasons[i];
    if (!reason) {
      flush();
      continue;
    }
    run.push(reason.id);
    detail.push(`第 ${reason.id} 章${reason.reason}`);
  }
  flush();
  return out;
}

function pressureCandidates(
  pace: StoryPace | undefined,
  chapters: RhythmPatrolChapter[],
): RhythmPatrolCandidate[] {
  const cap = pace ? PRESSURE_CAP_BY_PACE[pace] : null;
  // 稳推/慢燃在 rhythm 档位表无数值受压上限（稳推按每章想办法、慢燃允许长压），
  // 不硬造刻度；未定档同理。
  if (cap === null) return [];
  const pressured = chapters.map((ch) => ch.pressureCount > 0);
  const out: RhythmPatrolCandidate[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > cap)
      out.push({
        kind: "pressure_over_cap",
        chapters: run,
        evidence: `${pace}档受压连跑 ${run.length} 章，超档位上限 ${cap} 章（rhythm 档位表：受压一般不跨 ${cap} 章）——按受压上限尽快兑现一次，让回本路径可见`,
      });
    run = [];
  };
  for (let i = 0; i < chapters.length; i++) {
    if (pressured[i]) {
      run.push(chapters[i].chapterId);
      continue;
    }
    flush();
  }
  flush();
  return out;
}

/** 巡检最近一段章节，输出三类候选（候选清单，不是质量判定；不命中即空数组）。 */
export function patrolRhythm(input: { pace?: StoryPace; chapters: RhythmPatrolChapter[] }): {
  candidates: RhythmPatrolCandidate[];
} {
  const chapters = input.chapters;
  if (chapters.length < 2) return { candidates: [] };
  return {
    candidates: [
      ...conflictRunCandidates(chapters),
      ...noChangeCandidates(chapters),
      ...pressureCandidates(input.pace, chapters),
    ],
  };
}
