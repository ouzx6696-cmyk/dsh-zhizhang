/**
 * 纯逻辑：正式稿与候选稿的段落级对齐、变更定位与逐段局部采纳（Cherry-pick）合成。
 * 不依赖 DOM / React，便于在 node:test 中直接做单元测试。
 */

export type DiffRowKind = "same" | "modified" | "added" | "removed";

export interface ParagraphDiffRow {
  index: number;
  kind: DiffRowKind;
  official: string;
  candidate: string;
}

export interface ParagraphDiffSummary {
  rows: ParagraphDiffRow[];
  changeIndices: number[];
  added: number;
  modified: number;
  removed: number;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function charBigramSet(text: string): Set<string> {
  const clean = text.replace(/\s+/g, "");
  const out = new Set<string>();
  if (clean.length <= 1) {
    if (clean) out.add(clean);
    return out;
  }
  for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2));
  return out;
}

function similarity(a: string, b: string): number {
  const sa = charBigramSet(a);
  const sb = charBigramSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const item of sa) if (sb.has(item)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/** 将正式稿与候选稿按段落 LCS + 相似度配对，生成逐段差异行。 */
export function buildParagraphDiff(
  officialText: string,
  candidateText: string,
): ParagraphDiffSummary {
  const official = splitParagraphs(officialText);
  const candidate = splitParagraphs(candidateText);
  const m = official.length;
  const n = candidate.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        official[i] === candidate[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: ParagraphDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && official[i] === candidate[j]) {
      rows.push({
        index: rows.length,
        kind: "same",
        official: official[i],
        candidate: candidate[j],
      });
      i += 1;
      j += 1;
      continue;
    }
    const delStart = i;
    const addStart = j;
    while (i < m && (j === n || dp[i + 1][j] >= dp[i][j + 1])) {
      if (j < n && official[i] === candidate[j]) break;
      i += 1;
    }
    while (j < n && (i === m || dp[i][j + 1] > dp[i + 1][j])) {
      if (i < m && official[i] === candidate[j]) break;
      j += 1;
    }
    const delSlice = official.slice(delStart, i);
    const addSlice = candidate.slice(addStart, j);

    const usedAdd = new Set<number>();
    const pairedDel = new Map<number, number>();
    for (let di = 0; di < delSlice.length; di++) {
      let bestAj = -1;
      let bestSim = 0.22;
      for (let aj = 0; aj < addSlice.length; aj++) {
        if (usedAdd.has(aj)) continue;
        const sim = similarity(delSlice[di], addSlice[aj]);
        if (sim >= bestSim) {
          bestSim = sim;
          bestAj = aj;
        }
      }
      if (bestAj !== -1) {
        usedAdd.add(bestAj);
        pairedDel.set(di, bestAj);
      }
    }

    for (let di = 0; di < delSlice.length; di++) {
      const aj = pairedDel.get(di);
      if (aj !== undefined) {
        rows.push({
          index: rows.length,
          kind: "modified",
          official: delSlice[di],
          candidate: addSlice[aj],
        });
      } else {
        rows.push({ index: rows.length, kind: "removed", official: delSlice[di], candidate: "" });
      }
    }
    for (let aj = 0; aj < addSlice.length; aj++) {
      if (usedAdd.has(aj)) continue;
      rows.push({ index: rows.length, kind: "added", official: "", candidate: addSlice[aj] });
    }
  }

  const changeIndices: number[] = [];
  let added = 0;
  let modified = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind !== "same") changeIndices.push(row.index);
    if (row.kind === "added") added += 1;
    else if (row.kind === "modified") modified += 1;
    else if (row.kind === "removed") removed += 1;
  }
  return { rows, changeIndices, added, modified, removed };
}

/** 按逐段选择（"official" | "candidate"）合成最终正文。 */
export function mergeParagraphChoices(
  rows: readonly ParagraphDiffRow[],
  choices: Readonly<Record<number, "official" | "candidate">>,
): string {
  const out: string[] = [];
  for (const row of rows) {
    if (row.kind === "same") {
      if (row.official) out.push(row.official);
      continue;
    }
    const pick = choices[row.index] ?? "candidate";
    const text = pick === "official" ? row.official : row.candidate;
    if (text) out.push(text);
  }
  return out.join("\n\n");
}
