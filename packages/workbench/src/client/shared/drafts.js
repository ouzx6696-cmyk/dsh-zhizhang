/**
 * Unsaved source-editor text kept in this browser so a crash, power cut or closed window does not
 * lose it. A draft is keyed to the exact revision it was typed against; saving or discarding in the
 * editor removes it. Storage errors reach the editor, which tells the author the draft is not kept.
 */
const PREFIX = "dsh-writer-draft:";
// Drafts nobody came back to within two weeks are dropped so storage does not fill up.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** `parts` names the work, the chapter or article, the slot and the revision the text is based on. */
export function draftKey(parts) {
  return PREFIX + JSON.stringify(parts);
}

function parseDraft(raw) {
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
  const draft = parseDraft(raw);
  if (!draft) window.localStorage.removeItem(key);
  return draft;
}

/** Returns the time the draft was stored. */
export function writeDraft(key, text) {
  const savedAt = Date.now();
  window.localStorage.setItem(key, JSON.stringify({ text, savedAt }));
  return savedAt;
}

export function clearDraft(key) {
  window.localStorage.removeItem(key);
}

export function pruneDrafts() {
  const storage = window.localStorage;
  const cutoff = Date.now() - MAX_AGE_MS;
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  for (const key of keys) {
    const draft = readDraft(key);
    if (draft && draft.savedAt < cutoff) storage.removeItem(key);
  }
}
