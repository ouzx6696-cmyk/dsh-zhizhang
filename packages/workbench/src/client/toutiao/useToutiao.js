/**
 * 今日头条模式的数据：文章列表（6 秒轮询，页面不可见时暂停）+ 选中文章详情 + 采用 / 投递动作。
 * 只有切到今日头条模式时才挂载，番茄长篇模式不发这些请求。
 */
import React from "react";
import { toutiaoApi } from "../shared/api.js";
import { PREF, readPref, writePref } from "../shared/prefs.js";
import { t } from "../shared/copy.js";

const { useCallback, useEffect, useRef, useState } = React;
const POLL_MS = 6000;

export function useToutiao() {
  const [list, setList] = useState({ status: "loading", articles: [], roots: [], sessions: {}, deliver: false, deliverReason: "" });
  const [sel, setSel] = useState(() => ({ root: readPref(PREF.ttRoot, ""), id: readPref(PREF.ttArticle, "") }));
  const [detail, setDetail] = useState({ status: "idle", article: null, error: "" });
  const [busy, setBusy] = useState("");
  const [notices, setNotices] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [doneAt, setDoneAt] = useState({});
  const seq = useRef(0);
  const notify = useCallback((tone, text) => {
    seq.current += 1;
    const id = seq.current;
    setNotices((prev) => prev.filter((n) => n.text !== text).concat({ id, tone, text }).slice(-3));
  }, []);
  const dismiss = useCallback((id) => setNotices((prev) => prev.filter((n) => n.id !== id)), []);
  const listCtrl = useRef(null);
  const detailCtrl = useRef(null);

  const loadList = useCallback(async (manual) => {
    if (listCtrl.current) listCtrl.current.abort();
    if (manual === true) setRefreshing(true);
    const ctrl = new AbortController();
    listCtrl.current = ctrl;
    try {
      const data = await toutiaoApi.articles(ctrl.signal);
      setList({ status: "ready", articles: data.articles || [], statuses: data.statuses || [], roots: data.roots || [], sessions: data.sessions || {}, deliver: !!data.deliver, deliverReason: data.deliverReason || "", error: "", at: new Date().toISOString() });
    } catch (err) {
      if (err && err.code === "aborted") return;
      setList((prev) => ({ ...prev, status: prev.articles.length ? "ready" : "error", error: err.message || String(err) }));
      if (manual === true) notify("danger", err.message || String(err));
    } finally {
      if (listCtrl.current === ctrl) setRefreshing(false);
    }
  }, [notify]);

  const loadDetail = useCallback(async (root, id) => {
    if (detailCtrl.current) detailCtrl.current.abort();
    if (!root || !id) { setDetail({ status: "idle", article: null, error: "" }); return; }
    const ctrl = new AbortController();
    detailCtrl.current = ctrl;
    setDetail((prev) => ({ ...prev, status: prev.article && prev.article.id === id ? "ready" : "loading", error: "" }));
    try {
      const data = await toutiaoApi.article(root, id, ctrl.signal);
      setDetail({ status: "ready", article: data.article, error: "" });
    } catch (err) {
      if (err && err.code === "aborted") return;
      setDetail({ status: "error", article: null, error: err.message || String(err) });
    }
  }, []);

  useEffect(() => {
    loadList();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadList();
    }, POLL_MS);
    return () => { clearInterval(timer); if (listCtrl.current) listCtrl.current.abort(); if (detailCtrl.current) detailCtrl.current.abort(); };
  }, [loadList]);

  // 选中的文章：列表刷新时跟着刷新详情（状态、质检可能刚变）
  const selected = list.articles.find((a) => a.root === sel.root && a.id === sel.id);
  const stamp = selected ? selected.updatedAt : "";
  useEffect(() => { if (selected) loadDetail(sel.root, sel.id); }, [sel.root, sel.id, stamp, !!selected, loadDetail]);

  const select = useCallback((root, id) => {
    setSel({ root, id });
    writePref(PREF.ttRoot, root);
    writePref(PREF.ttArticle, id);
  }, []);

  // 投递目标数据目录：选中文章的目录；没选就用最近有会话的目录
  const pickRoot = () => {
    if (selected) return selected.root;
    const withSession = Object.entries(list.sessions).sort((a, b) => String(b[1]).localeCompare(String(a[1])));
    return (withSession[0] && withSession[0][0]) || list.roots[0] || "";
  };

  const deliver = useCallback(async (action, note) => {
    const root = pickRoot();
    if (!root) { notify("danger", t("ttNoSession")); return; }
    setBusy(action);
    try {
      const requestId = "wt-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      const data = await toutiaoApi.deliver({ root, id: action === "new" ? undefined : sel.id, action, note: note || undefined, requestId });
      notify("success", t("ttSent", { text: String(data.text || "").split("\n")[0] }));
      setDoneAt((prev) => ({ ...prev, [action]: Date.now() }));
    } catch (err) {
      notify("danger", t("deliverFailed", { reason: err.message || String(err) }));
    } finally {
      setBusy("");
    }
  }, [sel.id, selected, list.sessions, list.roots, notify]);

  const adopt = useCallback(async () => {
    if (!selected) return;
    setBusy("adopt");
    try {
      await toutiaoApi.adopt(selected.root, selected.id);
      notify("success", t("ttAdopted"));
      setDoneAt((prev) => ({ ...prev, adopt: Date.now() }));
      await loadList();
    } catch (err) {
      notify("danger", err.message || String(err));
    } finally {
      setBusy("");
    }
  }, [selected, loadList, notify]);

  const deliverRoot = pickRoot();
  const deliverOff = !list.deliver ? t("ttDeliverOff", { reason: list.deliverReason || "" }) : !list.sessions[deliverRoot] ? t("ttNoSession") : "";

  return { list, sel, selected, detail, busy, notices, refreshing, doneAt, deliverOff, actions: { select, deliver, adopt, refresh: () => loadList(true), dismiss } };
}
