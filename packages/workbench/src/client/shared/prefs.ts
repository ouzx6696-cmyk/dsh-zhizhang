/**
 * Viewing preferences remembered per browser (never author data). Reads and
 * writes are best effort: blocked storage just means nothing is remembered.
 */
const PREFIX = "zhizhang:";
/** 1.3 之前正文草稿留在 localStorage；M0-2 起草稿经 IPC 落写作文件夹。 */
const LEGACY_DRAFT_PREFIX = "zhizhang:draft:";

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

/**
 * 清掉旧版遗留在 localStorage 里的正文草稿键（`zhizhang:draft:*`）。
 * 这是删除不是兼容：不迁移、不读取，草稿一律走 DraftStore。
 */
export function clearLegacyDraftStorage(): void {
  try {
    const storage = window.localStorage;
    const stale: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(LEGACY_DRAFT_PREFIX)) stale.push(key);
    }
    for (const key of stale) storage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}
