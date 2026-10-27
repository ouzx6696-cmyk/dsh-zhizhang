/** Separate content identity, contextual applicability, and declared review. */
import { createHash } from "node:crypto";
export const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
export function contextBasis(meta, chapter, previous) {
    return { targetRevision: chapter.revision, foundation: fingerprint(meta.foundation), planning: fingerprint(meta.planning), ...(previous ? { previous } : {}) };
}
