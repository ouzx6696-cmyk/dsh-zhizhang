/**
 * 纯逻辑：正式稿与候选稿的段落级对齐、行内增删切分、变更统计与逐段局部采纳（Cherry-pick）合成。
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

export interface InlineDiffSegment {
  kind: "same" | "del" | "add";
  text: string;
}

export interface DiffCharStats {
  changes: number;
  addedChars: number;
  removedChars: number;
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

function tokenizeInline(text: string): string[] {
  const tokens = text.match(/[A-Za-z0-9_]+|[\s]+|./gu);
  return tokens ?? [];
}

function mergeSegments(raw: InlineDiffSegment[]): InlineDiffSegment[] {
  const merged: InlineDiffSegment[] = [];
  for (const seg of raw) {
    if (!seg.text) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === seg.kind) prev.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
}

/** 行内精细差异（用于左右双稿纸内的红色删除线与绿色新增下划线）。 */
export function buildInlineDiff(official: string, candidate: string): InlineDiffSegment[] {
  if (official === candidate) return official ? [{ kind: "same", text: official }] : [];
  if (!official) return [{ kind: "add", text: candidate }];
  if (!candidate) return [{ kind: "del", text: official }];

  const a = tokenizeInline(official);
  const b = tokenizeInline(candidate);
  // 极长单段保护，避免大矩阵卡顿主线程
  if (a.length * b.length > 160_000) {
    return mergeSegments([
      { kind: "del", text: official },
      { kind: "add", text: candidate },
    ]);
  }

  const m = a.length;
  const n = b.length;
  const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: InlineDiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) {
      out.push({ kind: "add", text: b[j] });
      j += 1;
    } else if (i < m) {
      out.push({ kind: "del", text: a[i] });
      i += 1;
    }
  }
  return mergeSegments(out);
}

/** 汇总所有差异段落的新增与删除有效字数，供决策卡状态 chip 展示。 */
export function computeDiffStats(summary: ParagraphDiffSummary): DiffCharStats {
  let addedChars = 0;
  let removedChars = 0;
  for (const row of summary.rows) {
    if (row.kind === "same") continue;
    if (row.kind === "added") {
      addedChars += row.candidate.replace(/\s+/g, "").length;
    } else if (row.kind === "removed") {
      removedChars += row.official.replace(/\s+/g, "").length;
    } else {
      const segs = buildInlineDiff(row.official, row.candidate);
      for (const seg of segs) {
        const len = seg.text.replace(/\s+/g, "").length;
        if (seg.kind === "add") addedChars += len;
        else if (seg.kind === "del") removedChars += len;
      }
    }
  }
  return { changes: summary.changeIndices.length, addedChars, removedChars };
}
