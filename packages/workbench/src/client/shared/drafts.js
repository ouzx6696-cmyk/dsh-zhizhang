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

// Until 1.0.1 the key ended with the revision. Converted once at start-up; remove in 1.0.2.
const LEGACY = {
  fanqie: { length: 6, keep: 5, base: (parts) => parts[5] },
  toutiao: { length: 5, keep: 3, base: (parts) => ({ rev: parts[3], sha256: parts[4] }) },
};

function legacyShape(parts) {
  const shape = parts && Object.hasOwn(LEGACY, parts[0]) ? LEGACY[parts[0]] : null;
  return shape && parts.length === shape.length ? shape : null;
}

/** Moves one old-format draft under its new key; the newest draft of a slot wins. */
function convertLegacy(key, parts, shape) {
  const draft = parseStored(window.localStorage.getItem(key));
  if (!draft) {
    // Kept as it is: conversion must never be the step that loses an author's text.
    console.warn(`草稿旧格式无法解析，原条目保留未改：${key}`);
    return;
  }
  const target = draftKey(parts.slice(0, shape.keep));
  const existing = readDraft(target);
  if (!existing || existing.savedAt < draft.savedAt)
    window.localStorage.setItem(
      target,
      JSON.stringify({ text: draft.text, savedAt: draft.savedAt, baseRevision: shape.base(parts) }),
    );
  window.localStorage.removeItem(key);
}

/**
 * Runs once when the app starts, not when an editor opens: converts old-format keys, then drops
 * drafts older than two weeks and unreadable entries.
 */
export function sweepDrafts() {
  for (const key of storedDraftKeys()) {
    const parts = keyParts(key);
    const shape = legacyShape(parts);
    if (shape) convertLegacy(key, parts, shape);
  }
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const key of storedDraftKeys()) {
    if (legacyShape(keyParts(key))) continue;
    const draft = readDraft(key);
    if (draft && draft.savedAt < cutoff) window.localStorage.removeItem(key);
  }
}
