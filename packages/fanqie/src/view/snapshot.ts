import type { ChapterStatus } from "../domain/status.js";

export interface ChapterRowView {
  id: string;
  title: string;
  position: number;
  status: ChapterStatus;
  wordCount: number;
  revision: string;
}

export interface SerialBufferMetrics {
  publishedThrough: string | null;
  continuousFinalCount: number;
  continuousFinalChars: number;
  publishableDays: number | null;
  postGapFinalChapters: string[];
}

export interface FanqieSnapshotDelta {
  revision: string;
  full: boolean;
  rows: ChapterRowView[];
  removedIds: string[];
  buffer?: SerialBufferMetrics;
}

function parsePositionFromId(id: string): number | null {
  const match = /(\d+)/.exec(id);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function computeSerialBuffer(
  rows: ReadonlyArray<Pick<ChapterRowView, "id" | "position" | "status" | "wordCount">>,
  options: { publishedThrough?: string; dailyTargetChars?: number } = {},
): SerialBufferMetrics {
  const sorted = [...rows].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const published = options.publishedThrough?.trim() || null;

  let startIndex = 0;
  if (published) {
    const exactIndex = sorted.findIndex((row) => row.id === published);
    if (exactIndex !== -1) {
      startIndex = exactIndex + 1;
    } else {
      const pubPos = parsePositionFromId(published);
      if (pubPos !== null) {
        const nextIdx = sorted.findIndex((row) => row.position > pubPos);
        startIndex = nextIdx === -1 ? sorted.length : nextIdx;
      }
    }
  }

  let continuousFinalCount = 0;
  let continuousFinalChars = 0;
  let gapHit = false;
  const postGapFinalChapters: string[] = [];

  for (let i = startIndex; i < sorted.length; i++) {
    const row = sorted[i];
    if (!gapHit) {
      if (row.status === "final") {
        continuousFinalCount += 1;
        continuousFinalChars += row.wordCount;
      } else {
        gapHit = true;
      }
    } else if (row.status === "final") {
      postGapFinalChapters.push(row.id);
    }
  }

  const dailyTarget = options.dailyTargetChars;
  const publishableDays =
    typeof dailyTarget === "number" && dailyTarget > 0
      ? Math.floor(continuousFinalChars / dailyTarget)
      : null;

  return {
    publishedThrough: published,
    continuousFinalCount,
    continuousFinalChars,
    publishableDays,
    postGapFinalChapters,
  };
}
