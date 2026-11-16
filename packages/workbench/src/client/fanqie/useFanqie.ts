import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { fanqie } from "../shared/api.js";
import { PREF, writePref } from "../shared/prefs.js";
import { bodyKey, derive, initialState, reducer } from "./state.js";

export function useFanqie(workPath?: string) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const activeWork = workPath ?? state.work;

  useEffect(() => {
    if (workPath && workPath !== state.work) {
      dispatch({ type: "selectWork", work: workPath });
    }
  }, [workPath, state.work]);

  useEffect(() => {
    writePref(PREF.work, state.work);
    writePref(PREF.chapter, state.chapterId);
    writePref(PREF.candidate, state.candidateId);
    writePref(PREF.view, state.view);
    writePref(PREF.tab, state.tab);
    writePref(PREF.readerView, state.readerView);
    writePref(PREF.fontStep, String(state.fontStep));
  }, [
    state.work,
    state.chapterId,
    state.candidateId,
    state.view,
    state.tab,
    state.readerView,
    state.fontStep,
  ]);

  const refresh = useCallback(async () => {
    const current = stateRef.current;
    const work = workPath ?? current.work;
    if (!work) return;
    const selection = current.selection;
    dispatch({ type: "loading" });
    try {
      const delta = await fanqie.snapshot({
        work,
        since: current.rowSnapshot.revision || undefined,
      });
      dispatch({ type: "snapshot", selection, delta, work });
    } catch (error) {
      dispatch({
        type: "snapshotError",
        selection,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [workPath]);

  useEffect(() => {
    void refresh();
  }, [refresh, activeWork]);

  const chapterBodyKey = bodyKey(state);
  useEffect(() => {
    if (!chapterBodyKey || !activeWork || !state.chapterId) return undefined;
    const controller = new AbortController();
    dispatch({
      type: "body",
      value: { key: chapterBodyKey, status: "loading", error: null },
    });
    fanqie
      .chapter({ work: activeWork, chapter: state.chapterId }, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        dispatch({
          type: "body",
          value: {
            key: chapterBodyKey,
            status: "ready",
            body: res.body,
            title: res.title,
            revision: res.revision,
            chapterStatus: res.status,
            error: null,
          },
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({
          type: "body",
          value: {
            key: chapterBodyKey,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });
    return () => controller.abort();
  }, [chapterBodyKey, activeWork, state.chapterId]);

  const saveChapter = useCallback(
    async (body: string, base: string, title?: string) => {
      const current = stateRef.current;
      const work = workPath ?? current.work;
      if (!work || !current.chapterId) return;
      dispatch({ type: "busy", action: "save" });
      try {
        await fanqie.saveChapter({
          work,
          chapter: current.chapterId,
          base,
          body,
          ...(title ? { title } : {}),
        });
        dispatch({ type: "edit", value: false });
        dispatch({ type: "reloadBodies" });
        await refresh();
      } finally {
        dispatch({ type: "busy", action: "" });
      }
    },
    [workPath, refresh],
  );

  const finalizeChapter = useCallback(
    async (chapterId: string) => {
      const work = workPath ?? stateRef.current.work;
      if (!work) return;
      dispatch({ type: "busy", action: "finalize" });
      try {
        await fanqie.finalizeChapter({ work, chapter: chapterId });
        dispatch({ type: "closeDialog" });
        await refresh();
      } finally {
        dispatch({ type: "busy", action: "" });
      }
    },
    [workPath, refresh],
  );

  const acceptCandidate = useCallback(
    async (chapterId: string, candidateId: string, base: string) => {
      const work = workPath ?? stateRef.current.work;
      if (!work) return;
      dispatch({ type: "busy", action: "accept" });
      try {
        await fanqie.acceptCandidate({ work, chapter: chapterId, candidateId, base });
        dispatch({ type: "closeDialog" });
        dispatch({ type: "reloadBodies" });
        await refresh();
      } finally {
        dispatch({ type: "busy", action: "" });
      }
    },
    [workPath, refresh],
  );

  const view = useMemo(() => derive(state), [state]);

  return {
    state,
    view,
    dispatch,
    refresh,
    saveChapter,
    finalizeChapter,
    acceptCandidate,
  };
}
