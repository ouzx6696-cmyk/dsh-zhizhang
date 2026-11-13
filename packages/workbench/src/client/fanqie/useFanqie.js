import { dismissNotice, notify } from "@writer/ui/notify";
import { canLeaveEdit, leaveState, useSourceGuard } from "../shared/useSourceGuard.js";
import { confirmAction } from "../shared/confirm.js";
/**
 * Data side of the panel: one reducer and event refreshes and on-demand body
 * loaders. Everything here is local to the mounted panel (registrant-private
 * component state); nothing is shared through module-level singletons.
 */
import React from "react";
import { fanqie } from "../shared/api.js";
import { useDiagnostics } from "./useDiagnostics.js";
import { diagnosticScope } from "./edit-state.js";
import { PREF, writePref } from "../shared/prefs.js";
import { bodyKey, derive, initialState, reducer, snapshotSignature } from "./state.js";
import { createFanqieActions, messageOf } from "./actions.js";
import { PROJECT_INDEX_FAILED } from "@writer/ui/copy";

const { useCallback, useEffect, useMemo, useReducer, useRef } = React;

const NAVIGATION = new Set([
  "selectProject",
  "selectWork",
  "selectChapter",
  "selectCandidate",
  "view",
  "readerView",
  "diagnosticKind",
  "reloadBodies",
]);

/** Which open editors a navigation leaves: the source editor, the paragraph edit, or both. */
function leavePlan(previous, action) {
  const next = reducer(previous, action);
  const changesSource =
    diagnosticScope(next) !== diagnosticScope(previous) ||
    next.view !== previous.view ||
    action.type === "reloadBodies";
  const leavesSource =
    action.type !== "reloadBodies" && (changesSource || next.readerView !== previous.readerView);
  return { changesSource, leavesSource };
}

export function useFanqie({ onTarget, onSourceEditState } = {}) {
  // 提示进全应用队列；记下本写作区发出的，换项目或作品时收起，不留给新范围。
  const noticeIds = useRef(new Set());
  const pushNotice = useCallback((tone, text) => {
    noticeIds.current.add(notify({ tone, text }));
  }, []);
  const clearNotices = useCallback(() => {
    for (const id of noticeIds.current) dismissNotice(id);
    noticeIds.current.clear();
  }, []);
  const sourceGuard = useSourceGuard(onSourceEditState);
  const { editorState: sourceState, close: closeSource, canLeave: canLeaveSource } = sourceGuard;
  const targetSink = useRef(onTarget);
  targetSink.current = onTarget;
  const [state, rawDispatch] = useReducer(reducer, undefined, initialState);
  const ref = useRef(state);
  ref.current = state;
  const setEdit = useCallback((value) => {
    ref.current = { ...ref.current, edit: value };
    rawDispatch({ type: "edit", value });
  }, []);
  // One leave question at a time: navigation while the author is still deciding is dropped.
  const deciding = useRef(false);
  /** Asks about the open editors for a navigation that leaves them; resolves false to stay. */
  const confirmLeave = useCallback(
    async ({ leavesSource, changesSource }) => {
      if (leavesSource && !(await canLeaveSource())) return false;
      const edit = changesSource ? ref.current.edit : null;
      if (!edit) return true;
      if (!(await canLeaveEdit(edit, confirmAction))) return false;
      setEdit(null);
      return true;
    },
    [canLeaveSource, setEdit],
  );
  /**
   * Resolves false when the author keeps an unsaved edit. With nothing to ask, the state changes
   * before this returns, so callers dispatching several actions in a row keep their order.
   */
  const dispatch = useCallback(
    async (action) => {
      if (action.type === "notice") {
        pushNotice(action.tone, action.text);
        return true;
      }
      const previous = ref.current;
      if (NAVIGATION.has(action.type)) {
        if (deciding.current) return false;
        const plan = leavePlan(previous, action);
        const edit = plan.changesSource ? previous.edit : null;
        const states = [plan.leavesSource ? sourceState() : "clean", leaveState(edit)];
        // A running save blocks the move outright, without opening a question.
        if (states.includes("saving")) return false;
        if (states.includes("dirty")) {
          deciding.current = true;
          try {
            if (!(await confirmLeave(plan))) return false;
          } finally {
            deciding.current = false;
          }
        } else {
          if (plan.leavesSource) closeSource();
          if (edit) setEdit(null);
        }
        // The author may have taken a while to answer; apply the move to the state as it is now.
        ref.current = { ...reducer(ref.current, action), edit: ref.current.edit };
      }
      if (
        action.type === "selectProject" ||
        (action.type === "selectWork" && action.work !== previous.work)
      )
        clearNotices();
      rawDispatch(action);
      return true;
    },
    [confirmLeave, sourceState, closeSource, setEdit, pushNotice, clearNotices],
  );
  // derive reads only snapshot and the selected IDs; body/editor state must not invalidate it.
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
    const handler = (event) => {
      if (ref.current.edit?.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Persist viewing choices (never author data).
  useEffect(() => writePref(PREF.view, state.view), [state.view]);
  useEffect(() => writePref(PREF.tab, state.tab), [state.tab]);
  useEffect(() => writePref(PREF.readerView, state.readerView), [state.readerView]);
  useEffect(() => writePref(PREF.fontStep, String(state.fontStep)), [state.fontStep]);
  useEffect(() => writePref(PREF.project, state.projectId), [state.projectId]);
  useEffect(() => writePref(PREF.work, state.work), [state.work]);
  useEffect(() => writePref(PREF.chapter, state.chapterId), [state.chapterId]);
  useEffect(() => writePref(PREF.candidate, state.candidateId), [state.candidateId]);

  /** Read the snapshot for the current project/work. `soft` keeps the UI as is. */
  const refresh = useCallback(
    async ({ soft = false, projects = false } = {}) => {
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
            const data = await fanqie.projects(!soft && projects, ctrl.signal);
            if (Array.isArray(data.projects)) {
              projectId =
                projectId && data.projects.some((p) => p.id === projectId)
                  ? projectId
                  : data.current || "";
              if (alive.current && !ctrl.signal.aborted)
                dispatch({
                  type: "projects",
                  selection,
                  projects: data.projects,
                  current: projectId,
                });
            }
          } catch (err) {
            // allow-catch: the project index only fills the switcher and the snapshot still resolves
            // the default root. Explicit loads say why it is missing; polls stay quiet so a dismissed
            // warning is not raised again every few seconds.
            if (err.code === "aborted") throw err;
            if (!soft && alive.current)
              pushNotice("warning", PROJECT_INDEX_FAILED + messageOf(err));
          }
        }
        if (!alive.current || ctrl.signal.aborted || ref.current.selection !== selection) return;
        const data = await fanqie.snapshot(
          projectId,
          selected.work,
          ctrl.signal,
          selected.view === "chapters" ? "work" : "all",
        );
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
    },
    [dispatch, pushNotice],
  );

  useEffect(() => {
    // 未形成有效快照不代表作者选择了项目根；后台写入期间尤其不能清掉作品。
    if (!state.base || !state.snapshot?.workKey) return;
    const current = state.view === "chapters" ? view.current : null;
    const candidate = current && state.readerView !== "official" ? view.activeCand : null;
    const loaded = state.readerView === "candidate" ? state.candidate : state.chapter;
    targetSink.current?.({
      mode: "fanqie",
      root: state.base,
      ...(state.snapshot?.workKey ? { work: state.snapshot.workKey } : {}),
      focus: {
        workTitle: state.snapshot?.title,
        chapter: current?.id,
        title: current?.title,
        candidate: candidate?.id,
        source: current
          ? state.readerView === "split"
            ? "split"
            : candidate
              ? "candidate"
              : "chapter"
          : undefined,
        revision:
          loaded.status === "ready"
            ? (loaded.meta?.revision ?? loaded.meta?.readVersion)
            : undefined,
        dirty: !!state.edit?.dirty || sourceGuard.dirty,
      },
    });
  }, [
    view,
    state.chapter,
    state.candidate,
    state.base,
    state.snapshot?.workKey,
    state.snapshot?.title,
    state.view,
    state.readerView,
    state.chapterId,
    view.activeCand?.id,
    state.chapter.status,
    state.chapter.meta,
    state.candidate.status,
    state.candidate.meta,
    state.edit?.dirty,
    sourceGuard.dirty,
  ]);

  // First load, and a full reload whenever the selected project or work changes.
  useEffect(() => {
    refresh({ projects: true });
  }, [refresh, state.selection, state.view]);

  // 写作 Agent 投递能力：换项目、换作品、手动刷新时重查（便宜的 GET）。
  useEffect(() => {
    const ctrl = new AbortController();
    fanqie
      .capabilities(state.projectId, ctrl.signal)
      .then((data) => {
        if (alive.current)
          dispatch({
            type: "deliver",
            value: { caps: { deliver: !!data.deliver, reason: data.deliverReason || "" } },
          });
      })
      .catch((err) => {
        if (alive.current && err.code !== "aborted")
          dispatch({
            type: "deliver",
            value: { caps: { deliver: false, reason: messageOf(err) } },
          });
      });
    return () => ctrl.abort();
  }, [state.projectId, state.selection, state.bodyEpoch, state.lastRefresh, dispatch]);

  // Current chapter body, fetched on demand and keyed so polls never refetch it.
  const chapterKey = bodyKey(state, "chapter");
  useEffect(() => {
    if (!chapterKey) return undefined;
    if (ref.current.chapter.key === chapterKey && ref.current.chapter.status === "ready")
      return undefined;
    const ctrl = new AbortController();
    const { projectId, work, chapterId } = ref.current;
    dispatch({ type: "body", slot: "chapter", value: { status: "loading", key: chapterKey } });
    fanqie
      .chapter(projectId, work, chapterId, ctrl.signal)
      .then((data) => {
        dispatch({
          type: "body",
          slot: "chapter",
          value: {
            status: "ready",
            key: chapterKey,
            body: data.body || "",
            meta: data.meta || null,
            outline: data.outline || null,
            truncated: !!data.truncated,
            bodyBytes: data.bodyBytes || 0,
            writer: data.writer || null,
          },
        });
      })
      .catch((err) => {
        if (err.code === "aborted") return;
        dispatch({
          type: "body",
          slot: "chapter",
          value: { status: "error", key: chapterKey, error: messageOf(err) },
        });
      });
    return () => ctrl.abort();
  }, [chapterKey, dispatch]);

  // Candidate body for the candidate and split views.
  const candidateKey = bodyKey(state, "candidate");
  useEffect(() => {
    if (!candidateKey) return undefined;
    if (ref.current.candidate.key === candidateKey && ref.current.candidate.status === "ready")
      return undefined;
    const ctrl = new AbortController();
    const { projectId, work } = ref.current;
    const id = viewRef.current.activeCand.id;
    dispatch({ type: "body", slot: "candidate", value: { status: "loading", key: candidateKey } });
    fanqie
      .candidate(projectId, work, id, ctrl.signal)
      .then((data) => {
        dispatch({
          type: "body",
          slot: "candidate",
          value: {
            status: "ready",
            key: candidateKey,
            body: data.body || "",
            meta: { ...(data.meta || {}), id },
            truncated: !!data.truncated,
            bodyBytes: data.bodyBytes || 0,
          },
        });
      })
      .catch((err) => {
        if (err.code === "aborted") return;
        dispatch({
          type: "body",
          slot: "candidate",
          value: { status: "error", key: candidateKey, error: messageOf(err) },
        });
      });
    return () => ctrl.abort();
  }, [candidateKey, dispatch]);

  const actions = useMemo(
    () => createFanqieActions({ ref, viewRef, alive, refresh, dispatch }),
    [refresh, dispatch],
  );

  const diagnostics = useDiagnostics({
    state,
    stateRef: ref,
    alive,
    setEdit,
    refresh: actions.refresh,
    notify: actions.notify,
  });
  return {
    state,
    view,
    sourceGuard,
    actions: { ...actions, diagnostics, sourceEditState: sourceGuard.report },
  };
}
