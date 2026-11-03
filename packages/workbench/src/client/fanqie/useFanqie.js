import { useNotices } from "../../../../ui/src/use-notices.js";
import { newRequestId } from "../../../../ui/src/request.js";
import { canLeaveEdit, useSourceGuard } from "../shared/useSourceGuard.js";
/**
 * Data side of the panel: one reducer and event refreshes and on-demand body
 * loaders. Everything here is local to the mounted panel (registrant-private
 * component state); nothing is shared through module-level singletons.
 */
import React from "react";
import { fanqie } from "../shared/api.js";
import { t } from "../../../../ui/src/copy.js";
import { diagnosticCopy } from "../../../../ui/src/copy.js";
import { useDiagnostics } from "./useDiagnostics.js";
import { diagnosticScope } from "./edit-state.js";
import { PREF, writePref } from "../shared/prefs.js";
import { bodyKey, derive, initialState, reducer, snapshotSignature } from "./state.js";

const { useCallback, useEffect, useMemo, useReducer, useRef } = React;

function messageOf(err) {
  if (!err) return "";
  if (err.code === "forbidden") return t("forbiddenHint");
  if (err.code === "rate_limited") return t("rateLimitedHint");
  return (
    (err.code && err.code !== "network" && err.code !== "timeout" ? "[" + err.code + "] " : "") +
    (err.message || String(err))
  );
}

export function useFanqie({ onTarget, onSourceEditState } = {}) {
  const { notices, push: pushNotice, dismiss: dismissNotice, clear: clearNotices } = useNotices();
  const sourceGuard = useSourceGuard(onSourceEditState);
  const canLeaveSource = sourceGuard.canLeave;
  const targetSink = useRef(onTarget);
  targetSink.current = onTarget;
  const [state, rawDispatch] = useReducer(reducer, undefined, initialState);
  const ref = useRef(state);
  ref.current = state;
  const setEdit = useCallback((value) => {
    ref.current = { ...ref.current, edit: value };
    rawDispatch({ type: "edit", value });
  }, []);
  const dispatch = useCallback(
    (action) => {
      if (action.type === "notice") {
        pushNotice(action.tone, action.text);
        return true;
      }
      if (action.type === "dismissNotice") {
        dismissNotice(action.id);
        return true;
      }

      const previous = ref.current;
      const navigation = [
        "selectProject",
        "selectWork",
        "selectChapter",
        "selectCandidate",
        "view",
        "readerView",
        "diagnosticKind",
        "reloadBodies",
      ].includes(action.type);
      if (navigation) {
        const next = reducer(previous, action);
        const changesSource =
          diagnosticScope(next) !== diagnosticScope(previous) ||
          next.view !== previous.view ||
          action.type === "reloadBodies";
        if (
          action.type !== "reloadBodies" &&
          (changesSource || next.readerView !== previous.readerView) &&
          !canLeaveSource()
        )
          return false;
        if (changesSource && previous.edit) {
          if (!canLeaveEdit(previous.edit, window.confirm)) return false;
          setEdit(null);
        }
        ref.current = { ...next, edit: ref.current.edit };
      }
      if (
        action.type === "selectProject" ||
        (action.type === "selectWork" && action.work !== previous.work)
      )
        clearNotices();
      rawDispatch(action);
      return true;
    },
    [setEdit, canLeaveSource, pushNotice, dismissNotice, clearNotices],
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
  useEffect(() => writePref(PREF.polling, state.polling ? "on" : "off"), [state.polling]);
  useEffect(() => writePref(PREF.project, state.projectId), [state.projectId]);
  useEffect(() => writePref(PREF.work, state.work), [state.work]);
  useEffect(() => writePref(PREF.chapter, state.chapterId), [state.chapterId]);
  useEffect(() => writePref(PREF.candidate, state.candidateId), [state.candidateId]);

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
          if (err.code === "aborted") throw err;
          /* project index is optional: the snapshot still resolves the default root */
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
  }, [dispatch]);

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

  // 写作 Agent 投递能力：换项目、换作品、手动刷新时重查（便宜的 GET，不进轮询）
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

  const actions = useMemo(() => {
    const notify = (tone, text) => dispatch({ type: "notice", tone, text });
    return {
      refresh: () => {
        if (!dispatch({ type: "reloadBodies" })) return;
        return refresh({ projects: true });
      },
      dispatch,
      notify,
      /** Adopt a candidate through the same Accept gates as the tool. */
      async accept(cand, opts, target) {
        const s = ref.current;
        if (s.edit?.dirty || s.edit?.saving) throw new Error(diagnosticCopy.finishEditing);
        if (
          !target ||
          target.selection !== s.selection ||
          target.projectId !== s.projectId ||
          target.work !== s.work ||
          target.cand?.id !== cand.id
        )
          throw new Error("当前作品或候选已切换，请重新确认。");
        const chapterMeta = target.meta;
        const isEdit = !!cand.editOf;
        try {
          const data = await fanqie.accept({
            base: s.projectId || undefined,
            work: s.work,
            candidate: cand.id,
            expectedRevision:
              chapterMeta && chapterMeta.id === cand.chapterId ? chapterMeta.revision : undefined,
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
        if (
          !target ||
          target.selection !== s.selection ||
          target.projectId !== s.projectId ||
          target.work !== s.work ||
          target.chapterId !== s.chapterId ||
          meta?.id !== s.chapterId ||
          !meta?.revision ||
          s.chapter.status !== "ready" ||
          s.chapter.truncated ||
          s.chapter.meta?.revision !== meta.revision
        )
          throw new Error("章节或已读版本已变化，请完整加载后重新确认。");
        try {
          await fanqie.chapterAction(kind, {
            base: target.projectId || undefined,
            work: target.work,
            chapter: target.chapterId,
            expectedRevision: meta.revision,
            confirm: true,
            ...(extra || {}),
          });
          if (
            alive.current &&
            ref.current.selection === s.selection &&
            ref.current.chapterId === s.chapterId
          ) {
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
      /** 写作 Agent：把固定指令投递为对话里的一条消息；正文仍由 Agent 在会话里写 */
      async deliver(action, chapterId) {
        const s = ref.current;
        if (!s.work) return false;
        const requestId = newRequestId("wb");
        dispatch({ type: "deliver", value: { busy: action, message: null, error: null } });
        try {
          await fanqie.deliver({
            base: s.projectId || undefined,
            work: s.work,
            chapter: chapterId || undefined,
            action,
            confirm: true,
            requestId,
          });
          if (!alive.current || ref.current.selection !== s.selection) return true;
          dispatch({ type: "deliver", value: { busy: "", message: t("deliverDone") } });
          dispatch({ type: "notice", tone: "success", text: t("deliverDone") });
          return true;
        } catch (err) {
          if (!alive.current || ref.current.selection !== s.selection) return false;
          dispatch({ type: "deliver", value: { busy: "", error: messageOf(err) } });
          dispatch({
            type: "notice",
            tone: "danger",
            text: t("deliverFailed", { reason: messageOf(err) }),
          });
          return false;
        }
      },
      async saveChapter({ body, expectedRevision, candidateId, scope, force }) {
        const s = ref.current;
        if (!s.work || !s.chapterId) throw new Error(t("chapterSaveMissing"));
        if (
          scope &&
          (s.projectId !== scope.base || s.work !== scope.work || s.chapterId !== scope.chapter)
        )
          throw new Error("编辑对象已变化，请先保留当前修改再重新打开章节。");
        const data = await fanqie.saveChapter({
          base: s.projectId || undefined,
          work: s.work,
          chapter: s.chapterId,
          body,
          expectedRevision,
          force: force === true,
          ...(candidateId
            ? { mode: "candidate", editOf: candidateId, draftLabel: "作者修订" }
            : {}),
        });
        await refresh({ soft: false });
        if (candidateId && data.candidateId) {
          dispatch({ type: "selectCandidate", chapterId: s.chapterId, id: data.candidateId });
          dispatch({ type: "readerView", view: "candidate" });
          notify("success", t("candidateSaved"));
        } else {
          dispatch({ type: "readerView", view: "official" });
          notify("success", t("chapterSaved"));
        }
        return data;
      },
      async unifyPrepare() {
        const s = ref.current;
        const ids = viewRef.current.chapterPending.map((c) => c.id);
        if (!s.work || !s.chapterId || ids.length < 2) return;
        dispatch({ type: "unify", value: { busy: true, message: null, error: null } });
        try {
          const data = await fanqie.unifyPrepare({
            base: s.projectId || undefined,
            work: s.work,
            chapter: s.chapterId,
            candidateIds: ids,
          });
          const brief = data.brief || "";
          try {
            if (navigator.clipboard && navigator.clipboard.writeText)
              await navigator.clipboard.writeText(brief);
          // allow-catch: optional clipboard copy; the visible message retains the next-step instructions.
          } catch {
            /* clipboard permission denied */
          }
          if (
            !alive.current ||
            ref.current.selection !== s.selection ||
            ref.current.chapterId !== s.chapterId
          )
            return;
          dispatch({
            type: "unify",
            value: {
              busy: false,
              message: t("unifyDone", { n: (data.candidateIds || ids).length }),
            },
          });
        } catch (err) {
          if (
            !alive.current ||
            ref.current.selection !== s.selection ||
            ref.current.chapterId !== s.chapterId
          )
            return;
          dispatch({ type: "unify", value: { busy: false, error: messageOf(err) } });
        }
      },
    };
  }, [refresh, dispatch]);

  const diagnostics = useDiagnostics({
    state,
    stateRef: ref,
    alive,
    setEdit,
    refresh: actions.refresh,
    notify: actions.notify,
  });
  return {
    state: { ...state, notices },
    view,
    sourceGuard,
    actions: { ...actions, diagnostics, sourceEditState: sourceGuard.report },
  };
}
