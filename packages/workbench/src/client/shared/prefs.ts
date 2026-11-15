/**
 * Viewing preferences remembered per browser (never author data). Reads and
 * writes are best effort: blocked storage just means nothing is remembered.
 */
const PREFIX = "zhizhang:";

export const PREF = {
  project: "lastProject",
  work: "lastWork",
  chapter: "lastChapter",
  candidate: "lastCandidate",
  view: "fanqieView",
  tab: "pipelineTab",
  readerView: "readerView",
  fontStep: "fontStep",
  ttRoot: "toutiaoRoot",
  ttArticle: "toutiaoArticle",
  agentDraft: "agentDraft:",
  dockWidth: "dockWidth",
  dockSplit: "dockSplit",
} as const;

export function readPref(key: string, fallback = ""): string {
  try {
    const value = window.localStorage.getItem(PREFIX + key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    const next = value == null ? "" : String(value);
    if (window.localStorage.getItem(PREFIX + key) === next) return;
    if (next) window.localStorage.setItem(PREFIX + key, next);
    else window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable */
  }
}

/** Constrain a stored value to an allowed set. */
export function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
