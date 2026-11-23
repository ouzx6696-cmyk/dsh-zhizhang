import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readJson, sha256 } from "@zhizhang/core/fs";
import type { LockService } from "@zhizhang/core/lock";
import { arr, bool, int, lit, obj, opt, str } from "@zhizhang/core/schema";
import type { StyleContract } from "../bible/types.js";
import type { ClassifiedEdit, EditCategory } from "./classify.js";

type LearningStatus = "observing" | "proposed" | "accepted" | "dismissed";

export interface LearningPattern {
  signature: string;
  kind: EditCategory;
  condition: string;
  change: string;
  why: string;
  count: number;
  examples: Array<{ before: string; after: string; chapter?: string }>;
  promoted: boolean;
  status?: LearningStatus;
  updatedAt: string;
}

export interface LearningState {
  patterns: LearningPattern[];
}

const EditCategorySchema = lit("delete", "expand", "dialogue", "action", "split", "word");
const LearningStatusSchema = lit("observing", "proposed", "accepted", "dismissed");

const LearningPatternSchema = obj({
  signature: str({ min: 1 }),
  kind: EditCategorySchema,
  condition: str(),
  change: str(),
  why: str(),
  count: int({ min: 0 }),
  examples: arr(
    obj({
      before: str(),
      after: str(),
      chapter: opt(str()),
    }),
  ),
  promoted: bool,
  status: opt(LearningStatusSchema),
  updatedAt: str(),
});

const LearningStateSchema = obj({
  patterns: arr(LearningPatternSchema),
});

const StyleContractSchema = obj({
  contract: str(),
  rules: arr(
    obj({
      id: str({ min: 1 }),
      condition: str(),
      change: str(),
      why: str(),
    }),
  ),
  voiceSamples: arr(str()),
});

const EMPTY_LEARNING: LearningState = { patterns: [] };
const EMPTY_STYLE: StyleContract = { contract: "", rules: [], voiceSamples: [] };
const PROMOTE_THRESHOLD = 3;

async function readLearningOrEmpty(file: string): Promise<LearningState> {
  return (await readJson(file, LearningStateSchema)) ?? EMPTY_LEARNING;
}

async function readStyleOrEmpty(file: string): Promise<StyleContract> {
  return (await readJson(file, StyleContractSchema)) ?? EMPTY_STYLE;
}

function ruleIdOf(signature: string): string {
  return `learn-${sha256(signature).slice(0, 8)}`;
}

export function createLearningStore(lock: LockService) {
  const learningPath = (workPath: string) => path.join(workPath, "bible", "learning.json");
  const stylePath = (workPath: string) => path.join(workPath, "bible", "style.json");

  async function read(workPath: string): Promise<LearningState> {
    return readLearningOrEmpty(learningPath(workPath));
  }

  async function record(
    workPath: string,
    edits: ClassifiedEdit[],
    meta: { chapter?: string; nowIso?: string; proposeOnly?: boolean } = {},
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
            status: "observing",
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
          const reached = nextCount >= PROMOTE_THRESHOLD;
          const shouldPromote = !meta.proposeOnly && !prev.promoted && reached;
          const nextStatus: LearningStatus =
            prev.status === "dismissed"
              ? "dismissed"
              : shouldPromote || prev.promoted
                ? "accepted"
                : reached
                  ? "proposed"
                  : "observing";
          const updated: LearningPattern = {
            ...prev,
            count: nextCount,
            examples: nextExamples,
            promoted: prev.promoted || shouldPromote,
            status: nextStatus,
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
        const style = await readStyleOrEmpty(stylePath(workPath));
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

  async function decide(
    workPath: string,
    signature: string,
    decision: "accept" | "dismiss",
    nowIso: string = systemClock.iso(),
  ): Promise<{ state: LearningState; rules: StyleContract["rules"] }> {
    return lock.write({ kind: "work", path: workPath }, async () => {
      const state = await read(workPath);
      const idx = state.patterns.findIndex((p) => p.signature === signature);
      if (idx === -1) {
        throw new AppError("input.not_found", `未找到学习模式：${signature}`, { signature });
      }
      const target = state.patterns[idx];
      const nextPattern: LearningPattern = {
        ...target,
        promoted: decision === "accept",
        status: decision === "accept" ? "accepted" : "dismissed",
        updatedAt: nowIso,
      };
      const patterns = [...state.patterns];
      patterns[idx] = nextPattern;
      const nextState: LearningState = { patterns };
      await atomicWrite(learningPath(workPath), JSON.stringify(nextState, null, 2));

      const style = await readStyleOrEmpty(stylePath(workPath));
      const id = ruleIdOf(signature);
      const rules =
        decision === "accept"
          ? style.rules.some((r) => r.id === id)
            ? style.rules
            : [
                ...style.rules,
                { id, condition: target.condition, change: target.change, why: target.why },
              ]
          : style.rules.filter((r) => r.id !== id);
      await atomicWrite(stylePath(workPath), JSON.stringify({ ...style, rules }, null, 2));
      return { state: nextState, rules };
    });
  }

  return { read, record, decide };
}
