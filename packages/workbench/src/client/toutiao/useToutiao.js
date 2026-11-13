import { notify as pushNotice } from "@writer/ui/notify";
import { newRequestId } from "@writer/ui/request";
import { useSourceGuard } from "../shared/useSourceGuard.js";
/**
 * 今日头条模式的数据：文章列表（挂载时加载，之后按需刷新）+ 选中文章详情 + 采用 / 投递动作。
 * 只有切到今日头条模式时才挂载，番茄长篇模式不发这些请求。
 */
import React from "react";
import { toutiao } from "../shared/api.js";
import { PREF, readPref, writePref } from "../shared/prefs.js";
import { t } from "@writer/ui/copy";

const { useCallback, useEffect, useRef, useState } = React;

export function useToutiao({ onTarget, onSourceEditState } = {}) {
  const sourceGuard = useSourceGuard(onSourceEditState);
  const canLeaveSource = sourceGuard.canLeave;
  const targetSink = useRef(onTarget);
  targetSink.current = onTarget;
  const [list, setList] = useState({
    status: "loading",
    articles: [],
    roots: [],
    statuses: [],
    currentRoot: "",
    error: "",
    at: "",
    deliver: false,
    deliverReason: "",
  });
  const [sel, setSel] = useState(() => ({
    root: readPref(PREF.ttRoot, ""),
    id: readPref(PREF.ttArticle, ""),
  }));
  const [detail, setDetail] = useState({ status: "idle", article: null, error: "" });
  const [busy, setBusy] = useState("");
  const notify = useCallback((tone, text) => void pushNotice({ tone, text }), []);
  const [refreshing, setRefreshing] = useState(false);
  const [doneAt, setDoneAt] = useState({});
  const listCtrl = useRef(null);
  const detailCtrl = useRef(null);

  const loadList = useCallback(
    async (manual) => {
      if (listCtrl.current) listCtrl.current.abort();
      if (manual === true) setRefreshing(true);
      const ctrl = new AbortController();
      listCtrl.current = ctrl;
      try {
        const data = await toutiao.articles(ctrl.signal);
        setList({
          status: "ready",
          articles: data.articles || [],
          statuses: data.statuses || [],
          roots: data.roots || [],
          currentRoot: data.currentRoot,
          deliver: !!data.deliver,
          deliverReason: data.deliverReason || "",
          error: (data.issues || [])
            .map((issue) => `${issue.id || issue.root}：${issue.error}`)
            .join("；"),
          at: new Date().toISOString(),
        });
      } catch (err) {
        if (err && err.code === "aborted") return;
        setList((prev) => ({
          ...prev,
          status: prev.articles.length ? "ready" : "error",
          error: err.message || String(err),
        }));
        if (manual === true) notify("danger", err.message || String(err));
      } finally {
        if (listCtrl.current === ctrl) setRefreshing(false);
      }
    },
    [notify],
  );

  const loadDetail = useCallback(async (root, id) => {
    if (detailCtrl.current) detailCtrl.current.abort();
    if (!root || !id) {
      setDetail({ status: "idle", article: null, error: "" });
      return;
    }
    const ctrl = new AbortController();
    detailCtrl.current = ctrl;
    setDetail((prev) => ({ ...prev, status: "loading", error: "" }));
    try {
      const data = await toutiao.article(root, id, ctrl.signal);
      setDetail({ status: "ready", article: data.article, error: "" });
    } catch (err) {
      if (err && err.code === "aborted") return;
      setDetail({ status: "error", article: null, error: err.message || String(err) });
    }
  }, []);

  const refresh = useCallback(() => loadList(true), [loadList]);
  useEffect(() => {
    loadList();
    return () => {
      listCtrl.current?.abort();
      detailCtrl.current?.abort();
    };
  }, [loadList]);

  // 选中的文章：列表刷新时跟着刷新详情（状态、质检可能刚变）
  const selected = list.articles.find((a) => a.root === sel.root && a.id === sel.id);
  useEffect(() => {
    const root = selected?.root || list.currentRoot;
    if (root)
      targetSink.current?.({
        mode: "toutiao",
        root,
        focus: selected
          ? {
              article: selected.id,
              title: selected.title,
              source: "article",
              dirty: sourceGuard.dirty,
              revision:
                detail.status === "ready" && detail.article?.id === selected.id
                  ? detail.article.rev
                  : undefined,
            }
          : {},
      });
  }, [
    selected,
    detail.article?.id,
    detail.status,
    detail.article?.rev,
    list.currentRoot,
    sourceGuard.dirty,
  ]);
  useEffect(() => {
    if (selected) loadDetail(sel.root, sel.id);
  }, [sel.root, sel.id, selected, loadDetail]);

  const select = useCallback(
    async (root, id) => {
      if (!(await canLeaveSource())) return false;
      setSel({ root, id });
      writePref(PREF.ttRoot, root);
      writePref(PREF.ttArticle, id);
      return true;
    },
    [canLeaveSource],
  );

  // 投递目标数据目录：选中文章的目录；没选就用最近有会话的目录
  const root = selected?.root || list.currentRoot || "";

  const saveDraft = useCallback(
    async (text, basis) => {
      const root = selected?.root || list.currentRoot;
      if (!root || !sel.id) throw new Error(t("ttNoArticle"));
      if (!basis || basis.root !== root || basis.id !== sel.id)
        throw new Error("编辑对象已变化，请先保留当前修改。");
      const data = await toutiao.saveDraft({ ...basis, text });
      notify("success", t("ttDraftSaved", { rev: data.rev }));
      if (data.warning) notify("warning", data.warning);
      await loadList();
      await loadDetail(root, sel.id);
      return data;
    },
    [selected, sel.id, list.currentRoot, loadList, loadDetail, notify],
  );

  const deliver = useCallback(
    async (action, note) => {
      if (!root) {
        notify("danger", t("ttNoSession"));
        return false;
      }
      setBusy(action);
      try {
        const requestId = newRequestId("wt");
        const data = await toutiao.deliver({
          root,
          id: action === "new" ? undefined : sel.id,
          action,
          note: note || undefined,
          requestId,
        });
        notify("success", t("ttSent", { text: String(data.text || "").split("\n")[0] }));
        setDoneAt((prev) => ({ ...prev, [action]: Date.now() }));
        return true;
      } catch (err) {
        notify("danger", t("deliverFailed", { reason: err.message || String(err) }));
        return false;
      } finally {
        setBusy("");
      }
    },
    [sel.id, root, notify],
  );

  const adoptReady =
    detail.status === "ready" &&
    detail.article?.root === selected?.root &&
    detail.article?.id === selected?.id &&
    !!detail.article?.draft?.sha256;
  const adopt = useCallback(
    async (article) => {
      if (!adoptReady || article?.root !== selected.root || article?.id !== selected.id) return;
      setBusy("adopt");
      try {
        await toutiao.adopt(article);
        notify("success", t("ttAdopted"));
        setDoneAt((prev) => ({ ...prev, adopt: Date.now() }));
        await loadList();
      } catch (err) {
        notify("danger", err.message || String(err));
      } finally {
        setBusy("");
      }
    },
    [selected, adoptReady, loadList, notify],
  );

  const deliverRoot = root;
  const deliverOff = !list.deliver
    ? t("ttDeliverOff", { reason: list.deliverReason || "" })
    : !deliverRoot
      ? t("ttNoSession")
      : "";

  return {
    sourceGuard,
    list,
    sel,
    selected,
    detail,
    adoptReady,
    busy,
    refreshing,
    doneAt,
    deliverOff,
    actions: { select, deliver, adopt, saveDraft, refresh },
  };
}
