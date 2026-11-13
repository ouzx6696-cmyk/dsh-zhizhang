/**
 * Unsaved source-editor text kept in this browser so a crash, power cut or closed window does not
 * lose it. A draft is keyed to the chapter slot or article, not to a revision, so it is still
 * offered after the pipeline or the agent wrote a newer version; the draft records the revision it
 * was typed against (`baseRevision`) and the editor saves it against that revision, so a newer
 * version on disk surfaces as a save conflict instead of being overwritten. Saving or discarding in
 * the editor removes it. Storage errors reach the editor, which tells the author.
 */
const PREFIX = "dsh-writer-draft:";
// Drafts nobody came back to within two weeks are dropped at start-up so storage does not fill up.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
// Mode, root and work (or article) name the work a draft belongs to.
const WORK_PARTS = 3;

function draftKey(parts) {
  return PREFIX + JSON.stringify(parts);
}

/** The draft of one slot ("official" or a candidate id) of a novel chapter. */
export function chapterDraftKey({ base, work, chapter, slot }) {
  return draftKey(["fanqie", base, work, chapter, slot]);
}

/** The draft of a Toutiao article's working text. */
export function articleDraftKey({ root, id }) {
  return draftKey(["toutiao", root, id]);
}

/** Parsed key parts, or null for a key this module did not write. */
function keyParts(key) {
  try {
    const parts = JSON.parse(key.slice(PREFIX.length));
    return Array.isArray(parts) ? parts : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function parseStored(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  return value && typeof value.text === "string" && Number.isFinite(value.savedAt) ? value : null;
}

/** The stored draft, or null; an unreadable entry is removed rather than offered. */
export function readDraft(key) {
  const raw = window.localStorage.getItem(key);
  if (raw == null) return null;
  const draft = parseStored(raw);
  if (draft && "baseRevision" in draft) return draft;
  window.localStorage.removeItem(key);
  return null;
}

/** Returns the time the draft was stored. */
export function writeDraft(key, text, baseRevision) {
  const savedAt = Date.now();
  window.localStorage.setItem(key, JSON.stringify({ text, savedAt, baseRevision }));
  return savedAt;
}

export function clearDraft(key) {
  window.localStorage.removeItem(key);
}

function storedDraftKeys() {
  const storage = window.localStorage;
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

/** Drafts of every other work, offered for clearing when storage is full. */
export function otherDraftKeys(key) {
  const work = JSON.stringify(keyParts(key).slice(0, WORK_PARTS));
  return storedDraftKeys().filter((other) => {
    const parts = keyParts(other);
    return parts !== null && JSON.stringify(parts.slice(0, WORK_PARTS)) !== work;
  });
}

/** Runs once at startup to drop expired and unreadable drafts. */
export function sweepDrafts() {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const key of storedDraftKeys()) {
    const draft = readDraft(key);
    if (draft && draft.savedAt < cutoff) window.localStorage.removeItem(key);
  }
}
