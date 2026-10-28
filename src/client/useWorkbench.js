/**
 * Data side of the panel: one reducer, one polling loop and on-demand body
 * loaders. Everything here is local to the mounted panel (registrant-private
 * state in DSH terms); nothing is shared through module-level singletons.
 */
import React from "react";
import { api } from "./api.js";
import { t, diagnosticCopy } from "./copy.js";
import { useDiagnostics } from "./useDiagnostics.js";
import { diagnosticScope } from "./edit-state.js";
import { PREF, writePref } from "./prefs.js";
import { bodyKey, derive, initialState, reducer, snapshotSignature } from "./state.js";

const { useCallback, useEffect, useMemo, useReducer, useRef } = React;

export const POLL_MS = 6000;
export const POLL_HIDDEN_MS = 30000;
export const POLL_MAX_BACKOFF_MS = 60000;

function messageOf(err) {
  if (!err) return "";
  if (err.code === "forbidden") return t("forbiddenHint");
  if (err.code === "rate_limited") return t("rateLimitedHint");
  return (err.code && err.code !== "network" && err.code !== "timeout" ? "[" + err.code + "] " : "") + (err.message || String(err));
}

export function useWorkbench() {
  const [state, rawDispatch] = useReducer(reducer, undefined, initialState);
  const ref = useRef(state);
  ref.current = state;
  const setEdit = useCallback(value => {
    ref.current = { ...ref.current, edit: value };
    rawDispatch({ type: "edit", value });
  }, []);
  const dispatch = useCallback(action => {
    const previous = ref.current;
    const navigation = ["selectProject", "selectWork", "selectChapter", "selectCandidate", "mode", "readerView", "diagnosticKind", "reloadBodies"].includes(action.type);
    if (navigation) {
      const next = reducer(previous, action);
      const changesSource = diagnosticScope(next) !== diagnosticScope(previous) || next.mode !== previous.mode || action.type === "reloadBodies";
      if (changesSource && previous.edit) {
        if (previous.edit.saving) return false;
        if (previous.edit.dirty && !window.confirm(diagnosticCopy.discard)) return false;
        setEdit(null);
      }
      ref.current = { ...next, edit: ref.current.edit };
    }
    rawDispatch(action);
    return true;
  }, [setEdit]);
  const view = useMemo(() => derive(state), [state.snapshot, state.chapterId, state.candidateId]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewRef = useRef(view);
  viewRef.current = view;
  const inflight = useRef(null);
  const failures = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (inflight.current) inflight.current.abort();
    };
  }, []);

  useEffect(() => {
    const handler = event => { if(ref.current.edit?.dirty){event.preventDefault();event.returnValue="";} };
    window.addEventListener("beforeunload",handler);
    return ()=>window.removeEventListener("beforeunload",handler);
  }, []);

  // Persist viewing choices (never author data).
  useEffect(() => writePref(PREF.mode, state.mode), [state.mode]);
  useEffect(() => writePref(PREF.tab, state.tab), [state.tab]);
  useEffect(() => writePref(PREF.readerView, state.readerView), [state.readerView]);
  useEffect(() => writePref(PREF.fontStep, String(state.fontStep)), [state.fontStep]);
  useEffect(() => writePref(PREF.polling, state.polling ? "on" : "off"), [state.polling]);
  useEffect(() => writePref(PREF.project, state.projectId), [state.projectId]);
  useEffect(() => writePref(PREF.work, state.work), [state.work]);
  useEffect(() => writePref(PREF.chapter, state.chapterId), [state.chapterId]);

  /** Read the snapshot for the current project/work. `soft` keeps the UI as is. */
  const refresh = useCallback(async ({ soft = false, projects = false } = {}) => {
    if (inflight.current) {
      if (soft) return;
      inflight.current.abort();
    }
    const ctrl = new AbortController();
    const selected = ref.current;
    const selection = selected.selection;
    let projectId = selected.projectId;
    inflight.current = ctrl;
    if (!soft) dispatch({ type: "loading" });
    try {
      if (projects || !ref.current.projects.length) {
        try {
          const data = await api.projects(!soft && projects, ctrl.signal);
          if (Array.isArray(data.projects)) {
            projectId = projectId && data.projects.some(p => p.id === projectId) ? projectId : data.current || "";
            if (alive.current && !ctrl.signal.aborted) dispatch({ type: "projects", selection, projects: data.projects, current: projectId });
          }
        } catch (err) {
          if (err.code === "aborted") throw err;
          /* project index is optional: the snapshot still resolves the default root */
        }
      }
      if (!alive.current || ctrl.signal.aborted || ref.current.selection !== selection) return;
      const data = await api.snapshot(projectId, selected.work, ctrl.signal, selected.mode === "novel" ? "work" : "all");
      if (!alive.current || ctrl.signal.aborted) return;
      failures.current = 0;
      dispatch({ type: "snapshot", selection, data, signature: snapshotSignature(data) });
    } catch (err) {
      if (!alive.current || (err && err.code === "aborted")) return;
      failures.current += 1;
      dispatch({ type: "snapshotError", selection, error: messageOf(err) });
    } finally {
      if (inflight.current === ctrl) inflight.current = null;
    }
  }, []);

  // First load, and a full reload whenever the selected project or work changes.
  useEffect(() => {
    refresh({ projects: true });
  }, [refresh, state.selection, state.mode]);

  // One polling loop: visible tabs poll often, hidden tabs rarely, failures back off,
  // and nothing polls while a confirmation dialog is open.
  useEffect(() => {
    if (!state.polling) return undefined;
    let timer = null;
    let stopped = false;
    let running = false;
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const schedule = () => {
      if (stopped) return;
      clearTimeout(timer);
      const base = hidden() ? POLL_HIDDEN_MS : POLL_MS;
      const delay = Math.min(POLL_MAX_BACKOFF_MS, base * Math.pow(2, Math.min(failures.current, 4)));
      timer = setTimeout(tick, delay);
    };
    const tick = async () => {
      if (stopped || running) return;
      running = true;
      try { if (!ref.current.dialog) await refresh({ soft: true }); }
      finally { running = false; if (alive.current) schedule(); }
    };
    const onVisible = () => {
      if (hidden()) return;
      const last = ref.current.lastRefresh ? Date.parse(ref.current.lastRefresh) : 0;
      if (Date.now() - last > POLL_MS) {
        clearTimeout(timer);
        tick();
      }
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.polling, refresh]);

  // Current chapter body, fetched on demand and keyed so polls never refetch it.
  const chapterKey = bodyKey(state, "chapter");
  useEffect(() => {
    if (!chapterKey) return undefined;
    if (ref.current.chapter.key === chapterKey && ref.current.chapter.status === "ready") return undefined;
    const ctrl = new AbortController();
    const { projectId, work, chapterId } = ref.current;
    dispatch({ type: "body", slot: "chapter", value: { status: "loading", key: chapterKey } });
    api
      .chapter(projectId, work, chapterId, ctrl.signal)
      .then((data) => {
        dispatch({
          type: "body",
          slot: "chapter",
          value: { status: "ready", key: chapterKey, body: data.body || "", meta: data.meta || null, truncated: !!data.truncated, bodyBytes: data.bodyBytes || 0 },
        });
      })
      .catch((err) => {
        if (err.code === "aborted") return;
        dispatch({ type: "body", slot: "chapter", value: { status: "error", key: chapterKey, error: messageOf(err) } });
      });
    return () => ctrl.abort();
  }, [chapterKey]);

  // Candidate body for the candidate and split views.
  const candidateKey = bodyKey(state, "candidate");
  useEffect(() => {
    if (!candidateKey) return undefined;
    if (ref.current.candidate.key === candidateKey && ref.current.candidate.status === "ready") return undefined;
    const ctrl = new AbortController();
    const { projectId, work } = ref.current;
    const id = viewRef.current.activeCand.id;
    dispatch({ type: "body", slot: "candidate", value: { status: "loading", key: candidateKey } });
    api
      .candidate(projectId, work, id, ctrl.signal)
      .then((data) => {
        dispatch({
          type: "body",
          slot: "candidate",
          value: { status: "ready", key: candidateKey, body: data.body || "", meta: { ...(data.meta || {}), id }, truncated: !!data.truncated, bodyBytes: data.bodyBytes || 0 },
        });
      })
      .catch((err) => {
        if (err.code === "aborted") return;
        dispatch({ type: "body", slot: "candidate", value: { status: "error", key: candidateKey, error: messageOf(err) } });
      });
    return () => ctrl.abort();
  }, [candidateKey]);

  const actions = useMemo(() => {
    const notify = (tone, text) => dispatch({ type: "notice", tone, text });
    return {
      refresh: () => { if (!dispatch({ type: "reloadBodies" })) return; return refresh({ projects: true }); },
      dispatch,
      notify,
      /** Adopt a candidate through the same Accept gates as the tool. */
      async accept(cand, opts, target) {
        const s = ref.current;
        if (s.edit?.dirty || s.edit?.saving) throw new Error(diagnosticCopy.finishEditing);
        if (!target || target.selection !== s.selection || target.projectId !== s.projectId || target.work !== s.work || target.cand?.id !== cand.id)
          throw new Error("当前作品或候选已切换，请重新确认。");
        const chapterMeta = target.meta;
        const isEdit = !!cand.editOf;
        try {
          const data = await api.accept({
            base: s.projectId || undefined,
            work: s.work,
            candidate: cand.id,
            expectedRevision: chapterMeta && chapterMeta.id === cand.chapterId ? chapterMeta.revision : undefined,
            confirm: true,
            force: !!opts.force,
            skipBrief: !!opts.skipBrief,
            acceptAfterEdit: isEdit,
            confirmAcceptAfterEdit: isEdit,
          });
          if (alive.current && ref.current.selection === s.selection) {
            dispatch({ type: "closeDialog" });
            dispatch({ type: "readerView", view: s.readerView === "split" ? "split" : "official" });
            dispatch({ type: "reloadBodies" });
            notify("success", data.receipt || t("acceptDone"));
          }
        } finally {
          // A timeout may still have committed server-side: reconcile before any retry.
          if (alive.current) {
            if (ref.current.selection === s.selection) dispatch({ type: "reloadBodies" });
            await refresh({ soft: false });
          }
        }
      },
      /** Review / finalize / acknowledge bound to the revision actually loaded. */
      async chapterAction(kind, extra, target) {
        const s = ref.current;
        if (s.edit?.dirty || s.edit?.saving) throw new Error(diagnosticCopy.finishEditing);
        const meta = target?.meta;
        if (!target || target.selection !== s.selection || target.projectId !== s.projectId || target.work !== s.work || target.chapterId !== s.chapterId || meta?.id !== s.chapterId || !meta?.revision || s.chapter.status !== "ready" || s.chapter.truncated || s.chapter.meta?.revision !== meta.revision)
          throw new Error("章节或已读版本已变化，请完整加载后重新确认。");
        try {
          await api.chapterAction(kind, {
            base: target.projectId || undefined, work: target.work, chapter: target.chapterId,
            expectedRevision: meta.revision, confirm: true, ...(extra || {}),
          });
          if (alive.current && ref.current.selection === s.selection && ref.current.chapterId === s.chapterId) {
            dispatch({ type: "closeDialog" });
            dispatch({ type: "reloadBodies" });
            notify("success", t("actionDone"));
          }
        } finally {
          // A failed or timed-out lifecycle write may already have committed.
          if (alive.current) {
            if (ref.current.selection === s.selection) dispatch({ type: "reloadBodies" });
            await refresh({ soft: false });
          }
        }
      },
      async unifyPrepare() {
        const s = ref.current;
        const ids = viewRef.current.chapterPending.map((c) => c.id);
        if (!s.work || !s.chapterId || ids.length < 2) return;
        dispatch({ type: "unify", value: { busy: true, message: null, error: null } });
        try {
          const data = await api.unifyPrepare({ base: s.projectId || undefined, work: s.work, chapter: s.chapterId, candidate_ids: ids });
          const brief = data.brief || "";
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(brief);
          } catch {
            /* clipboard permission denied: the message still explains the next step */
          }
          if (!alive.current || ref.current.selection !== s.selection || ref.current.chapterId !== s.chapterId) return;
          dispatch({ type: "unify", value: { busy: false, message: t("unifyDone", { n: (data.candidateIds || ids).length }) } });
        } catch (err) {
          if (!alive.current || ref.current.selection !== s.selection || ref.current.chapterId !== s.chapterId) return;
          dispatch({ type: "unify", value: { busy: false, error: messageOf(err) } });
        }
      },
    };
  }, [refresh]);

  const diagnostics = useDiagnostics({ state, stateRef: ref, alive, setEdit, refresh: actions.refresh, notify: actions.notify });
  return { state, view, actions: { ...actions, diagnostics } };
}

export const __messageOf = messageOf;
