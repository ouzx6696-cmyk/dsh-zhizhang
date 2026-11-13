import { sha256 } from "../../../../core/src/fsx.js";
/** Separate content identity, contextual applicability, and declared review. */

export const fingerprint = (value: unknown) => sha256(JSON.stringify(value ?? null));
/** Prefix identifies the planning facts used for an inspiration session. */
const PLANNING_BASIS_PREFIX = "basis2:";
/**
 * A-01: the planning facts an inspiration session was prepared against — foundation, volume and
 * unit plans, pacing and each chapter's outline and position. Accepting, reviewing or finalizing a
 * chapter changes word counts, status and the continuity index, none of which is planning.
 */
export function planningBasis(
  meta: import("../types.js").WorkMeta,
  outlines: Readonly<Record<string, unknown>>,
) {
  return (
    PLANNING_BASIS_PREFIX +
    fingerprint({
      key: meta.key,
      genre: meta.genre,
      premise: meta.premise,
      pace: meta.pace ?? null,
      foundation: meta.foundation,
      planning: meta.planning ?? null,
      chapters: meta.chapters.map((c) => ({
        id: c.id,
        position: c.position,
        outline: outlines[c.id] ?? null,
      })),
    })
  );
}
/** Compare the current planning facts with the session's recorded basis. */
export function planningUnchanged(
  meta: import("../types.js").WorkMeta,
  outlines: Readonly<Record<string, unknown>>,
  stored: unknown,
) {
  return typeof stored === "string" && stored === planningBasis(meta, outlines);
}
export interface ChapterDependency {
  chapterId: string;
  revision: string;
  kind: "final" | "working";
}
export interface ContextBasis {
  targetRevision: string;
  foundation: string;
  planning: string;
  previous?: ChapterDependency;
}
export interface ChapterReview {
  revision: string;
  basis: ContextBasis;
  result: "pass" | "blocked";
  summary: string;
  declaredBy: string;
  at: string;
}
export function contextBasis(
  meta: import("../types.js").WorkMeta,
  chapter: { revision: string },
  previous?: ChapterDependency,
): ContextBasis {
  return {
    targetRevision: chapter.revision,
    foundation: fingerprint(meta.foundation),
    planning: fingerprint(meta.planning),
    ...(previous ? { previous } : {}),
  };
}
