/**
 * Panel view state as one reducer. Server data (snapshot, bodies) and viewing
 * choices (mode, chapter, reader view) are separate slices so a poll never
 * resets what the author is reading.
 */
import { PREF, oneOf, readPref } from "./prefs.js";

export const MODES = ["novel", "pipeline"];
export const TABS = ["overview", "library", "inspiration", "writing", "ledger"];
export const READER_VIEWS = ["official", "candidate", "split"];
export const FONT_STEPS = [-2, -1, 0, 1, 2, 3];

const idleBody = { status: "idle", key: "", body: "", meta: null, truncated: false, bodyBytes: 0, error: null };

export function initialState() {
  const fontStep = Number(readPref(PREF.fontStep, "0"));
  return {
    // connection / server data
    phase: "boot", // boot | ready | error
    selection: 0, // bumps when the author picks another project or work
    projects: [],
    projectId: readPref(PREF.project, ""),
    works: [],
    work: readPref(PREF.work, ""),
    base: "",
    snapshot: null,
    signature: "",
    empty: false,
    needWork: false,
    message: "",
    hostOk: true,
    error: null,
    loading: false,
    lastRefresh: null,
    // viewing choices
    mode: oneOf(readPref(PREF.mode, "novel"), MODES, "novel"),
    tab: oneOf(readPref(PREF.tab, "overview"), TABS, "overview"),
    chapterId: readPref(PREF.chapter, ""),
    candidateId: "",
    readerView: oneOf(readPref(PREF.readerView, "official"), READER_VIEWS, "official"),
    fontStep: FONT_STEPS.indexOf(fontStep) >= 0 ? fontStep : 0,
    polling: readPref(PREF.polling, "on") !== "off",
    // bodies loaded on demand
    chapter: idleBody,
    candidate: idleBody,
    bodyEpoch: 0,
    // dialogs and transient feedback
    dialog: null, // { kind: 'accept', cand } | { kind: 'review'|'finalize'|'acknowledge' }
    notices: [],
    unify: { busy: false, message: null, error: null },
  };
}

let noticeSeq = 0;

export function reducer(state, action) {
  switch (action.type) {
    case "projects":
      if (action.selection !== state.selection) return state;
      return {
        ...state,
        projects: action.projects,
        projectId: state.projectId && action.projects.some((p) => p.id === state.projectId) ? state.projectId : action.current || state.projectId,
      };
    case "loading":
      return { ...state, loading: true };
    case "snapshot": {
      if (action.selection !== state.selection) return state;
      const { data, signature } = action;
      const snap = data.snapshot || null;
      const works = data.works || [];
      const chapters = (snap && snap.chapters) || [];
      let chapterId = state.chapterId;
      if (chapterId && !chapters.some((c) => c.id === chapterId)) chapterId = "";
      if (!chapterId && chapters.length) chapterId = chapters[0].id;
      const same = signature === state.signature && state.phase === "ready";
      const next = {
        ...state,
        phase: "ready",
        loading: false,
        hostOk: true,
        error: null,
        lastRefresh: new Date().toISOString(),
        // Unchanged polls keep object identity so memoised views do not re-render.
        snapshot: same ? state.snapshot : snap,
        works: same ? state.works : works,
        signature,
        work: (snap && snap.workKey) || state.work || (works[0] && works[0].key) || "",
        base: data.base || (snap && snap.storageBase) || state.base,
        projectId: data.projectId || state.projectId,
        empty: !!data.empty,
        needWork: !!data.needWork,
        message: data.message || "",
        chapterId,
      };
      for (const slot of ["chapter", "candidate"])
        if (next[slot].key !== bodyKey(next, slot)) next[slot] = idleBody;
      if (chapterId !== state.chapterId) next.dialog = null;
      return next;
    }
    case "snapshotError":
      if (action.selection !== state.selection) return state;
      return {
        ...state,
        phase: state.snapshot || state.empty || state.needWork ? "ready" : "error",
        loading: false,
        hostOk: false,
        error: action.error,
      };
    case "selectProject":
      return {
        ...state,
        projectId: action.id,
        base: "",
        dialog: null,
        notices: [],
        unify: { busy: false, message: null, error: null },
        selection: state.selection + 1,
        work: "",
        works: [],
        snapshot: null,
        signature: "",
        chapterId: "",
        candidateId: "",
        chapter: idleBody,
        candidate: idleBody,
        empty: false,
        needWork: false,
        phase: "boot",
      };
    case "selectWork":
      return action.work === state.work
        ? state
        : { ...state, work: action.work, selection: state.selection + 1, snapshot: null, signature: "", chapterId: "", candidateId: "", chapter: idleBody, candidate: idleBody, dialog: null, notices: [], unify: { busy: false, message: null, error: null }, empty: false, needWork: false, phase: "boot" };
    case "mode":
      return { ...state, mode: action.mode };
    case "tab":
      return { ...state, tab: action.tab };
    case "polling":
      return { ...state, polling: action.on };
    case "fontStep":
      return { ...state, fontStep: action.step };
    case "selectChapter":
      if (action.id === state.chapterId) return { ...state, readerView: state.readerView === "split" ? "split" : "official" };
      return {
        ...state,
        chapterId: action.id,
        dialog: null,
        candidateId: "",
        readerView: state.readerView === "split" ? "split" : "official",
        chapter: idleBody,
        candidate: idleBody,
        unify: { busy: false, message: null, error: null },
      };
    case "selectCandidate":
      return {
        ...state,
        chapterId: action.chapterId,
        dialog: null,
        candidateId: action.id,
        readerView: state.readerView === "split" ? "split" : "candidate",
        chapter: action.chapterId === state.chapterId ? state.chapter : idleBody,
        candidate: action.chapterId === state.chapterId && action.id === derive(state).activeCand?.id ? state.candidate : idleBody,
      };
    case "readerView":
      return { ...state, readerView: action.view };
    case "body": {
      const slot = action.slot; // chapter | candidate
      if (action.value.key !== bodyKey(state, slot)) return state;
      return { ...state, [slot]: { ...idleBody, ...action.value } };
    }
    case "reloadBodies":
      return { ...state, bodyEpoch: state.bodyEpoch + 1, chapter: idleBody, candidate: idleBody };
    case "openDialog":
      return { ...state, dialog: { ...action.dialog, selection: state.selection, projectId: state.projectId, work: state.work, chapterId: action.dialog.cand?.chapterId || state.chapterId, meta: state.chapter.meta, chapter: derive(state).current } };
    case "closeDialog":
      return { ...state, dialog: null };
    case "notice": {
      noticeSeq += 1;
      const notices = state.notices.filter((n) => n.text !== action.text).concat({ id: noticeSeq, tone: action.tone, text: action.text });
      return { ...state, notices: notices.slice(-3) };
    }
    case "dismissNotice":
      return { ...state, notices: state.notices.filter((n) => n.id !== action.id) };
    case "unify":
      return { ...state, unify: { ...state.unify, ...action.value } };
    default:
      return state;
  }
}

/** Derived data the views need; pure over the snapshot. */
export function derive(state) {
  const snap = state.snapshot;
  const chapters = (snap && snap.chapters) || [];
  const pending = ((snap && snap.candidates) || []).filter((c) => c.pending && !c.unavailable);
  const byChapter = new Map();
  for (const cand of pending) {
    const list = byChapter.get(cand.chapterId) || [];
    list.push(cand);
    byChapter.set(cand.chapterId, list);
  }
  const impacts = new Set(((snap && snap.revisionImpacts) || []).map((v) => v.chapterId));
  const current = chapters.find((c) => c.id === state.chapterId) || null;
  const chapterPending = byChapter.get(state.chapterId) || [];
  const activeCand = chapterPending.find((c) => c.id === state.candidateId) || chapterPending[0] || null;
  return { snap, chapters, pending, byChapter, impacts, current, chapterPending, activeCand };
}

/** Stable comparison key for a snapshot response (bodies are never included). */
export function snapshotSignature(data) {
  try {
    // generatedAt changes on every read; it says nothing about the content.
    const snap = data.snapshot ? { ...data.snapshot, generatedAt: undefined, html: undefined } : null;
    return JSON.stringify([data.projectId, data.base, data.empty, data.needWork, data.message, data.works, snap]);
  } catch {
    return String(Date.now());
  }
}

/** Bind body responses to the selected project, work, chapter and observed version. */
export function bodyKey(state, slot) {
  if (state.mode !== "novel" || !state.work || !state.chapterId) return "";
  const view = derive(state);
  if (slot === "candidate" && (state.readerView === "official" || !view.activeCand)) return "";
  return JSON.stringify([state.projectId, state.work, state.chapterId, slot === "chapter" ? view.current?.updatedAt : view.activeCand?.id, slot === "chapter" ? "" : view.activeCand?.stagedAt, state.bodyEpoch]);
}
