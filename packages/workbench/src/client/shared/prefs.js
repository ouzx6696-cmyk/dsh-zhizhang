/**
 * Viewing preferences remembered per browser (never author data). Reads and
 * writes are best effort: blocked storage just means nothing is remembered.
 */
// Existing author preferences keep their persisted namespace.
const PREFIX = "dsh-writer:";

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
};

export function readPref(key, fallback = "") {
  try {
    const value = window.localStorage.getItem(PREFIX + key);
    return value == null ? fallback : value;
    // allow-catch: viewing preferences only; denied localStorage must not block opening author files.
  } catch {
    return fallback;
  }
}

export function writePref(key, value) {
  try {
    const next = value == null ? "" : String(value);
    if (window.localStorage.getItem(PREFIX + key) === next) return;
    if (next) window.localStorage.setItem(PREFIX + key, next);
    else window.localStorage.removeItem(PREFIX + key);
    // allow-catch: viewing preferences only; denied localStorage must not block opening author files.
  } catch {
    /* storage unavailable */
  }
}

/** Constrain a stored value to an allowed set. */
export function oneOf(value, allowed, fallback) {
  return allowed.indexOf(value) >= 0 ? value : fallback;
}
