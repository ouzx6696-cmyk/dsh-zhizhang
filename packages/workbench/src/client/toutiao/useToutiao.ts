import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { toutiao } from "../shared/api.js";
import { PREF, writePref } from "../shared/prefs.js";
import { deriveToutiao, initialToutiaoState, toutiaoReducer } from "./state.js";

export function useToutiao(rootPath?: string) {
  const [state, dispatch] = useReducer(toutiaoReducer, undefined, initialToutiaoState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const activeRoot = rootPath ?? state.root;

  useEffect(() => {
    if (rootPath && rootPath !== state.root) {
      dispatch({ type: "root", root: rootPath });
    }
  }, [rootPath, state.root]);

  useEffect(() => {
    writePref(PREF.ttRoot, state.root);
    writePref(PREF.ttArticle, state.selectedId);
  }, [state.root, state.selectedId]);

  const refresh = useCallback(async () => {
    const root = rootPath ?? stateRef.current.root;
    if (!root) return;
    dispatch({ type: "loading" });
    try {
      const res = await toutiao.articles({ root });
      dispatch({
        type: "articles",
        delta: {
          revision: String(Date.now()),
          full: true,
          rows: res.rows,
        },
      });
    } catch (error) {
      dispatch({
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [rootPath]);

  useEffect(() => {
    void refresh();
  }, [refresh, activeRoot]);

  const createArticle = useCallback(
    async (genre: string, driver: string) => {
      const root = rootPath ?? stateRef.current.root;
      if (!root) return null;
      dispatch({ type: "busy", action: "create" });
      try {
        const res = await toutiao.createArticle({ root, genre, driver });
        await refresh();
        return res;
      } finally {
        dispatch({ type: "busy", action: "" });
      }
    },
    [rootPath, refresh],
  );

  const transitionArticle = useCallback(
    async (articleDir: string, to: string) => {
      dispatch({ type: "busy", action: "transition" });
      try {
        const res = await toutiao.transitionArticle({ articleDir, to });
        await refresh();
        return res;
      } finally {
        dispatch({ type: "busy", action: "" });
      }
    },
    [refresh],
  );

  const deliverArticle = useCallback(
    async (articleDir: string, title: string, body: string) => {
      dispatch({ type: "busy", action: "deliver" });
      try {
        const res = await toutiao.deliverArticle({ articleDir, title, body });
        dispatch({ type: "delivered", deliveryPath: res.deliveryPath });
        await refresh();
        return res;
      } finally {
        dispatch({ type: "busy", action: "" });
      }
    },
    [refresh],
  );

  const view = useMemo(() => deriveToutiao(state), [state]);

  return {
    state,
    ...view,
    dispatch,
    refresh,
    createArticle,
    transitionArticle,
    deliverArticle,
  };
}
