export interface Hunk {
  kind: "delete" | "expand" | "dialogue" | "action" | "split" | "word";
  before: string;
  after: string;
  context: [string, string];
}

export function splitSentences(paragraph: string): string[] {
  const trimmed = paragraph.trim();
  if (!trimmed) return [];
  const matches = trimmed.match(/[^。！？!?；;…]+[。！？!?；;…]*[”」\x22\x27]?/g);
  if (!matches) return [trimmed];
  return matches.map((s) => s.trim()).filter(Boolean);
}

function charBigramSet(text: string): Set<string> {
  const clean = text.replace(/\s+/g, "");
  const out = new Set<string>();
  if (clean.length <= 1) {
    if (clean) out.add(clean);
    return out;
  }
  for (let i = 0; i < clean.length - 1; i++) {
    out.add(clean.slice(i, i + 2));
  }
  return out;
}

function jaccardSimilarity(a: string, b: string): number {
  const sa = charBigramSet(a);
  const sb = charBigramSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const item of sa) {
    if (sb.has(item)) inter += 1;
  }
  return inter / (sa.size + sb.size - inter);
}

function hasDialogue(text: string): boolean {
  return /[“”「」]/.test(text);
}

function inferPairedKind(before: string, after: string): Hunk["kind"] {
  const afterSents = splitSentences(after);
  if (afterSents.length > 1 && before.length >= 20) {
    return "split";
  }
  const beforeClauses = before.split(/[，,；;]/).filter(Boolean).length;
  const afterClauses = after.split(/[，,。；;！？!?]/).filter(Boolean).length;
  if (afterClauses > beforeClauses + 1 && before.length >= 25) {
    return "split";
  }
  if (hasDialogue(before) || hasDialogue(after)) {
    return "dialogue";
  }
  if (jaccardSimilarity(before, after) >= 0.45) {
    return "word";
  }
  return "action";
}

export function alignSentences(
  beforePara: string,
  afterPara: string,
  context: [string, string] = ["", ""],
): Hunk[] {
  const before = splitSentences(beforePara);
  const after = splitSentences(afterPara);
  const m = before.length;
  const n = after.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        before[i] === after[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && before[i] === after[j]) {
      i += 1;
      j += 1;
      continue;
    }

    const delStart = i;
    const addStart = j;
    while (i < m && (j === n || dp[i + 1][j] >= dp[i][j + 1])) {
      if (j < n && before[i] === after[j]) break;
      i += 1;
    }
    while (j < n && (i === m || dp[i][j + 1] > dp[i + 1][j])) {
      if (i < m && before[i] === after[j]) break;
      j += 1;
    }

    const delSlice = before.slice(delStart, i);
    const addSlice = after.slice(addStart, j);
    const prevCtx = delStart > 0 ? before[delStart - 1] : context[0];
    const nextCtx = i < m ? before[i] : context[1];

    if (delSlice.length === 1 && addSlice.length > 1) {
      // One long sentence split into multiple sentences
      hunks.push({
        kind: "split",
        before: delSlice[0],
        after: addSlice.join(""),
        context: [prevCtx, nextCtx],
      });
      continue;
    }

    const pairedCount = Math.min(delSlice.length, addSlice.length);
    for (let k = 0; k < pairedCount; k++) {
      hunks.push({
        kind: inferPairedKind(delSlice[k], addSlice[k]),
        before: delSlice[k],
        after: addSlice[k],
        context: [prevCtx, nextCtx],
      });
    }
    for (let k = pairedCount; k < addSlice.length; k++) {
      hunks.push({
        kind: hasDialogue(addSlice[k]) ? "dialogue" : "expand",
        before: "",
        after: addSlice[k],
        context: [prevCtx, nextCtx],
      });
    }
    for (let k = pairedCount; k < delSlice.length; k++) {
      hunks.push({
        kind: "delete",
        before: delSlice[k],
        after: "",
        context: [prevCtx, nextCtx],
      });
    }
  }

  return hunks;
}

export function alignParagraphs(beforeText: string, afterText: string): Hunk[] {
  const before = beforeText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const after = afterText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const m = before.length;
  const n = after.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        before[i] === after[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && before[i] === after[j]) {
      i += 1;
      j += 1;
      continue;
    }
    const prevCtx = i > 0 ? before[i - 1] : "";
    const nextCtx = i + 1 < m ? before[i + 1] : "";
    if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) {
      hunks.push({
        kind: after[j].includes("“") ? "dialogue" : "expand",
        before: "",
        after: after[j],
        context: [prevCtx, nextCtx],
      });
      j += 1;
    } else if (i < m) {
      hunks.push({
        kind: "delete",
        before: before[i],
        after: "",
        context: [prevCtx, nextCtx],
      });
      i += 1;
    }
  }
  return hunks;
}

export function alignTwoLevel(beforeText: string, afterText: string): Hunk[] {
  const before = beforeText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const after = afterText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const m = before.length;
  const n = after.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        before[i] === after[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && before[i] === after[j]) {
      i += 1;
      j += 1;
      continue;
    }

    const delStart = i;
    const addStart = j;
    while (i < m && (j === n || dp[i + 1][j] >= dp[i][j + 1])) {
      if (j < n && before[i] === after[j]) break;
      i += 1;
    }
    while (j < n && (i === m || dp[i][j + 1] > dp[i + 1][j])) {
      if (i < m && before[i] === after[j]) break;
      j += 1;
    }

    const delParas = before.slice(delStart, i);
    const addParas = after.slice(addStart, j);
    const prevCtx = delStart > 0 ? before[delStart - 1] : "";
    const nextCtx = i < m ? before[i] : "";

    const usedAdd = new Set<number>();
    const pairedDel = new Set<number>();

    for (let di = 0; di < delParas.length; di++) {
      let bestAj = -1;
      let bestSim = 0.25;
      for (let aj = 0; aj < addParas.length; aj++) {
        if (usedAdd.has(aj)) continue;
        const sim = jaccardSimilarity(delParas[di], addParas[aj]);
        if (sim >= bestSim) {
          bestSim = sim;
          bestAj = aj;
        }
      }
      if (bestAj !== -1) {
        pairedDel.add(di);
        usedAdd.add(bestAj);
        hunks.push(...alignSentences(delParas[di], addParas[bestAj], [prevCtx, nextCtx]));
      }
    }

    for (let aj = 0; aj < addParas.length; aj++) {
      if (usedAdd.has(aj)) continue;
      hunks.push({
        kind: hasDialogue(addParas[aj]) ? "dialogue" : "expand",
        before: "",
        after: addParas[aj],
        context: [prevCtx, nextCtx],
      });
    }
    for (let di = 0; di < delParas.length; di++) {
      if (pairedDel.has(di)) continue;
      hunks.push({
        kind: "delete",
        before: delParas[di],
        after: "",
        context: [prevCtx, nextCtx],
      });
    }
  }

  return hunks;
}
