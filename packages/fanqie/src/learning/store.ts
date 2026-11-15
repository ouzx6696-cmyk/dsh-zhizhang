import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, sha256 } from "@zhizhang/core/fs";
import type { LockService } from "@zhizhang/core/lock";
import type { StyleContract } from "../bible/types.js";
import type { ClassifiedEdit, EditCategory } from "./classify.js";

export interface LearningPattern {
  signature: string;
  kind: EditCategory;
  condition: string;
  change: string;
  why: string;
  count: number;
  examples: Array<{ before: string; after: string; chapter?: string }>;
  promoted: boolean;
  updatedAt: string;
}

export interface LearningState {
  patterns: LearningPattern[];
}

const EMPTY_LEARNING: LearningState = { patterns: [] };
const EMPTY_STYLE: StyleContract = { contract: "", rules: [], voiceSamples: [] };
const PROMOTE_THRESHOLD = 3;

async function readJsonOrFallback<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return fallback;
    throw new AppError("storage.format_unsupported", `Invalid learning/style file: ${file}`, { file });
  }
}

function ruleIdOf(signature: string): string {
  return `learn-${sha256(signature).slice(0, 8)}`;
}

export function createLearningStore(lock: LockService) {
  const learningPath = (workPath: string) => path.join(workPath, "bible", "learning.json");
  const stylePath = (workPath: string) => path.join(workPath, "bible", "style.json");

  async function read(workPath: string): Promise<LearningState> {
    return readJsonOrFallback(learningPath(workPath), EMPTY_LEARNING);
  }

  async function record(
    workPath: string,
    edits: ClassifiedEdit[],
    meta: { chapter?: string; nowIso?: string } = {}
  ): Promise<{ state: LearningState; promotedRules: StyleContract["rules"] }> {
    return lock.write({ kind: "work", path: workPath }, async () => {
      const state = await read(workPath);
      const patterns = [...state.patterns];
      const nowIso = meta.nowIso ?? systemClock.iso();
      const newlyPromoted: LearningPattern[] = [];

      for (const edit of edits) {
        const existingIdx = patterns.findIndex((p) => p.signature === edit.signature);
        if (existingIdx === -1) {
          const created: LearningPattern = {
            signature: edit.signature,
            kind: edit.kind,
            condition: edit.condition,
            change: edit.change,
            why: edit.why,
            count: 1,
            examples: [{ before: edit.before, after: edit.after, chapter: meta.chapter }],
            promoted: false,
            updatedAt: nowIso,
          };
          patterns.push(created);
        } else {
          const prev = patterns[existingIdx];
          const nextCount = prev.count + 1;
          const nextExamples = [
            ...prev.examples.slice(-4),
            { before: edit.before, after: edit.after, chapter: meta.chapter },
          ];
          const shouldPromote = !prev.promoted && nextCount >= PROMOTE_THRESHOLD;
          const updated: LearningPattern = {
            ...prev,
            count: nextCount,
            examples: nextExamples,
            promoted: prev.promoted || shouldPromote,
            updatedAt: nowIso,
          };
          patterns[existingIdx] = updated;
          if (shouldPromote) {
            newlyPromoted.push(updated);
          }
        }
      }

      const nextState: LearningState = { patterns };
      await atomicWrite(learningPath(workPath), JSON.stringify(nextState, null, 2));

      const promotedRules: StyleContract["rules"] = [];
      if (newlyPromoted.length > 0) {
        const style = await readJsonOrFallback(stylePath(workPath), EMPTY_STYLE);
        const rules = [...style.rules];
        for (const pattern of newlyPromoted) {
          const id = ruleIdOf(pattern.signature);
          if (!rules.some((r) => r.id === id)) {
            const rule = {
              id,
              condition: pattern.condition,
              change: pattern.change,
              why: pattern.why,
            };
            rules.push(rule);
            promotedRules.push(rule);
          }
        }
        const nextStyle: StyleContract = { ...style, rules };
        await atomicWrite(stylePath(workPath), JSON.stringify(nextStyle, null, 2));
      }

      return { state: nextState, promotedRules };
    });
  }

  return { read, record };
}
