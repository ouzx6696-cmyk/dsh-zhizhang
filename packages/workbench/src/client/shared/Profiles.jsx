/**
 * 方法方案：页头按钮 + 弹窗。左列方案（默认 / 原版 / 用户方案N），中列方法清单，右列全文。
 * 内置方案只读；用户方案可逐份保存、恢复底稿、新增、改名、删除；新建时可导入 .md 文件或整个文件夹。
 */
import React from "react";
import { ApiError, profilesApi } from "./api.js";
import { t } from "./copy.js";
import { Button, cx, Icon, PanelModal, Spinner, Tag } from "./ui.jsx";
import { Callout, Notices } from "./common.jsx";

const { useCallback, useEffect, useMemo, useRef, useState } = React;
const MODE_NAME = { fanqie: "番茄长篇", toutiao: "今日头条" };
const errText = (e) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));
const countChars = (s) => (s || "").replace(/\s/g, "").length;

function useNotices() {
  const [notices, setNotices] = useState([]);
  const seq = useRef(0);
  const push = useCallback((tone, text) => {
    seq.current += 1;
    const id = "pf" + seq.current;
    setNotices((prev) => prev.concat({ id, tone, text }).slice(-3));
  }, []);
  const dismiss = useCallback((id) => setNotices((prev) => prev.filter((n) => n.id !== id)), []);
  return { notices, push, dismiss };
}

/** 页头按钮：显示当前方案名，点开弹窗 */
export function ProfilesButton({ mode }) {
  const api = useMemo(() => profilesApi(mode), [mode]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(null);
  const refreshActive = useCallback(() => {
    api.list().then((r) => setActive(r.profiles.find((p) => p.active) || null)).catch(() => setActive(null));
  }, [api]);
  useEffect(refreshActive, [refreshActive]);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="wb-profile-button"
        title={active ? t("pfButtonHint", { name: active.name }) : t("pfButton")}
        onClick={() => setOpen(true)}
        icon={<Icon name="layers" size={14} />}
      >
        <span className="wb-profile-button-label">{t("pfButton")}</span>
        {active ? <span className="wb-profile-button-name">{active.name}</span> : null}
      </Button>
      {open ? <ProfilesDialog mode={mode} api={api} onChanged={refreshActive} onClose={() => { setOpen(false); refreshActive(); }} /> : null}
    </>
  );
}

function FromTag({ row }) {
  if (row.added) return <Tag tone="info">{t("pfFromAdded")}</Tag>;
  if (row.overridden) return <Tag tone="success">{t("pfFromUser")}</Tag>;
  return null;
}

function NewProfileForm({ profiles, base, onCancel, onCreate, busy }) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState(base || "default");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState([]);
  const pick = async (list) => {
    const md = Array.from(list || []).filter((f) => /\.md$/i.test(f.name)).slice(0, 300);
    const read = await Promise.all(md.map(async (f) => {
      const rel = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
      const parts = rel.split("/");
      const id = (f.webkitRelativePath ? parts.slice(1).join("/") : rel).replace(/\.md$/i, "");
      return { id, text: await f.text() };
    }));
    setFiles(read.filter((f) => f.id && f.text.trim()));
  };
  return (
    <form
      className="wb-pf-new"
      onSubmit={(e) => { e.preventDefault(); onCreate({ name: name.trim() || undefined, base: from, note: note.trim() || undefined, files }); }}
    >
      <h3 className="wb-pf-subhead">{t("pfNewTitle")}</h3>
      <label className="wb-form-row">
        <span className="wb-form-label">{t("pfNewName")}</span>
        <input className="wb-input" value={name} maxLength={24} placeholder={t("pfNewNameHint")} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="wb-form-row">
        <span className="wb-form-label">{t("pfNewBase")}</span>
        <select className="wb-select" value={from} onChange={(e) => setFrom(e.target.value)}>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="wb-form-row">
        <span className="wb-form-label">{t("pfNewNote")}</span>
        <input className="wb-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="wb-form-row">
        <span className="wb-form-label">{t("pfNewFiles")}</span>
        <span className="wb-input-row">
          <label className="wb-file-button">
            <Icon name="upload" size={14} />{t("pfNewPick")}
            <input type="file" accept=".md,text/markdown" multiple onChange={(e) => pick(e.target.files)} />
          </label>
          <label className="wb-file-button">
            <Icon name="upload" size={14} />{t("pfNewFolder")}
            <input type="file" multiple webkitdirectory="" directory="" onChange={(e) => pick(e.target.files)} />
          </label>
          {files.length ? <span className="wb-muted">{t("pfNewPicked", { n: files.length })}</span> : null}
        </span>
        <span className="wb-form-hint">{t("pfNewFilesHint")}</span>
      </div>
      <div className="wb-pf-actions">
        <Button variant="ghost" size="sm" onClick={onCancel}>{t("cancel")}</Button>
        <Button variant="primary" size="sm" type="submit" disabled={busy} icon={busy ? <Spinner /> : <Icon name="plus" size={14} />}>{t("pfCreate")}</Button>
      </div>
    </form>
  );
}

export function ProfilesDialog({ mode, api, onClose, onChanged }) {
  const { notices, push, dismiss } = useNotices();
  const [list, setList] = useState({ status: "loading", profiles: [], active: "", pinned: false });
  const [sel, setSel] = useState("");
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState("");
  const [method, setMethod] = useState(null); // { id, text, base_text, from }
  const [draft, setDraft] = useState("");
  const [showBase, setShowBase] = useState(false);
  const [busy, setBusy] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [adding, setAdding] = useState(null);

  const loadList = useCallback(async (keep) => {
    try {
      const r = await api.list();
      setList({ status: "ready", ...r });
      setSel((cur) => (keep && r.profiles.some((p) => p.id === keep) ? keep : cur && r.profiles.some((p) => p.id === cur) ? cur : r.active));
    } catch (e) {
      setList((l) => ({ ...l, status: "error", error: errText(e) }));
    }
  }, [api]);
  useEffect(() => { loadList(); }, [loadList]);

  const loadDetail = useCallback(async (id) => {
    if (!id) return;
    try { setDetail(await api.detail(id)); } catch (e) { push("danger", errText(e)); }
  }, [api, push]);
  useEffect(() => { setMethod(null); setDraft(""); setConfirmDelete(false); setRenaming(null); setAdding(null); loadDetail(sel); }, [sel, loadDetail]);

  const profile = list.profiles.find((p) => p.id === sel);
  const editable = profile && profile.kind === "user";
  const dirty = method && editable && draft !== method.text;

  const openMethod = useCallback(async (id) => {
    if (dirty && !window.confirm(t("pfUnsaved"))) return;
    setBusy("method:" + id);
    try {
      const r = await api.method(sel, id);
      setMethod({ ...r.method, base_text: r.base_text });
      setDraft(r.method.text);
      setShowBase(false);
    } catch (e) { push("danger", errText(e)); }
    setBusy("");
  }, [api, sel, dirty, push]);

  const run = async (key, fn, ok) => {
    setBusy(key);
    try { const r = await fn(); if (ok) push("success", ok(r)); return r; } catch (e) { push("danger", errText(e)); return undefined; } finally { setBusy(""); }
  };

  const use = () => run("use", () => api.use(sel), () => t("pfUsed", { name: profile.name })).then((r) => { if (r) { loadList(sel); onChanged && onChanged(); } });
  const save = () => run("save", () => api.save(sel, method.id, draft), (r) => t("pfSaved", { id: r.id })).then(async (r) => {
    if (!r) return;
    await Promise.all([loadDetail(sel), loadList(sel)]);
    setMethod((m) => ({ ...m, text: draft, from: "user" }));
  });
  const reset = () => run("reset", () => api.reset(sel, method.id), (r) => t("pfResetDone", { id: r.id })).then(async (r) => {
    if (!r) return;
    await Promise.all([loadDetail(sel), loadList(sel)]);
    const still = (await api.detail(sel).catch(() => null))?.methods.some((m) => m.id === method.id);
    if (still) openMethod(method.id); else { setMethod(null); setDraft(""); }
  });
  const create = (payload) => run("create", () => api.create(payload), (r) => t("pfCreated", { name: r.profile.name })).then(async (r) => {
    if (!r) return;
    setCreating(false);
    await loadList(r.profile.id);
    setSel(r.profile.id);
  });
  const remove = () => run("delete", () => api.remove(sel), () => t("pfDeleted", { name: profile.name })).then(async (r) => {
    if (!r) return;
    setConfirmDelete(false);
    onChanged && onChanged();
    await loadList("default");
    setSel("default");
  });
  const rename = (name) => run("rename", () => api.rename(sel, name), () => t("pfRenamed")).then((r) => { if (r) { setRenaming(null); loadList(sel); } });
  const addMethod = (id) => {
    const clean = id.trim();
    if (!clean) return;
    setAdding(null);
    setMethod({ id: clean, text: "", from: "user", added: true });
    setDraft("# " + clean + "\n\n");
  };

  const rows = (detail?.methods || []).filter((m) => !filter || m.id.includes(filter) || (m.title || "").includes(filter));
  const close = () => { if (dirty && !window.confirm(t("pfUnsaved"))) return; onClose(); };

  return (
    <PanelModal open title={t("pfTitle", { mode: MODE_NAME[mode] || mode })} closeLabel={t("close")} onClose={close} className="wb-modal-wide wb-pf" description={t("pfLead")}>
      {list.status === "error" ? <Callout tone="danger">{list.error}</Callout> : null}
      {list.pinned ? <Callout tone="info">{t("pfPinnedHint")}</Callout> : null}
      <div className="wb-pf-grid">
        <nav className="wb-pf-col wb-pf-profiles" aria-label={t("pfList")}>
          <ul className="wb-pf-list">
            {list.profiles.map((p) => (
              <li key={p.id}>
                <button type="button" className={cx("wb-pf-item", p.id === sel && "wb-pf-item-on")} aria-current={p.id === sel || undefined} onClick={() => setSel(p.id)}>
                  <span className="wb-pf-item-head">
                    <span className="wb-pf-item-name">{p.name}</span>
                    {p.active ? <Tag tone="success">{p.pinned ? t("pfPinned") : t("pfActive")}</Tag> : null}
                  </span>
                  <span className="wb-pf-item-meta">
                    <span>{p.kind === "user" ? t("pfUser") : t("pfBuiltin")}</span>
                    <span>{t("pfMethods", { n: p.methods })}</span>
                    {p.kind === "user" ? <span>{t("pfOverrides", { n: p.overrides || 0 })}</span> : null}
                  </span>
                  {p.note ? <span className="wb-pf-item-note">{p.note}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" className="wb-pf-new-button" onClick={() => setCreating(true)} icon={<Icon name="plus" size={14} />}>{t("pfNew")}</Button>
        </nav>

        {creating ? (
          <section className="wb-pf-col wb-pf-span">
            <NewProfileForm profiles={list.profiles} base={sel} busy={busy === "create"} onCancel={() => setCreating(false)} onCreate={create} />
          </section>
        ) : (
          <>
            <section className="wb-pf-col wb-pf-methods" aria-label={profile ? profile.name : ""}>
              {profile ? (
                <div className="wb-pf-head">
                  {renaming !== null ? (
                    <form className="wb-input-row" onSubmit={(e) => { e.preventDefault(); rename(renaming); }}>
                      <input className="wb-input" autoFocus value={renaming} maxLength={24} onChange={(e) => setRenaming(e.target.value)} />
                      <Button size="sm" variant="primary" type="submit" disabled={busy === "rename"}>{t("pfRename")}</Button>
                    </form>
                  ) : (
                    <h3 className="wb-pf-subhead">{profile.name}</h3>
                  )}
                  <div className="wb-pf-actions">
                    <Button size="sm" variant={profile.active ? "ghost" : "primary"} disabled={profile.active || list.pinned || busy === "use"} onClick={use} icon={busy === "use" ? <Spinner /> : <Icon name="check" size={14} />}>
                      {profile.active ? t("pfActive") : t("pfUse")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCreating(true)} title={t("pfCopy")} icon={<Icon name="plus" size={14} />}>{t("pfCopy")}</Button>
                    {editable ? (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setRenaming(profile.name)} icon={<Icon name="pen" size={14} />} aria-label={t("pfRename")} title={t("pfRename")} />
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} icon={<Icon name="trash" size={14} />} aria-label={t("pfDelete")} title={t("pfDelete")} />
                      </>
                    ) : null}
                  </div>
                  {confirmDelete ? (
                    <Callout tone="danger">
                      {t("pfDeleteConfirm", { name: profile.name })}
                      <span className="wb-pf-actions">
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>{t("cancel")}</Button>
                        <Button size="sm" variant="danger" disabled={busy === "delete"} onClick={remove}>{t("pfDelete")}</Button>
                      </span>
                    </Callout>
                  ) : null}
                </div>
              ) : null}
              <label className="wb-pf-search">
                <Icon name="search" size={14} />
                <input className="wb-input" placeholder={t("pfSearch")} value={filter} onChange={(e) => setFilter(e.target.value)} />
              </label>
              <ul className="wb-pf-methods-list">
                {rows.length ? rows.map((m) => (
                  <li key={m.id}>
                    <button type="button" className={cx("wb-pf-method", method?.id === m.id && "wb-pf-method-on")} onClick={() => openMethod(m.id)}>
                      <span className="wb-pf-method-text">
                        <span className="wb-pf-method-title">{m.title || m.id}</span>
                        {m.title ? <span className="wb-pf-method-id">{m.id}</span> : null}
                      </span>
                      {busy === "method:" + m.id ? <Spinner /> : <FromTag row={m} />}
                    </button>
                  </li>
                )) : <li className="wb-muted wb-pf-empty">{detail ? t("pfEmpty") : <Spinner />}</li>}
              </ul>
              {editable ? (
                adding !== null ? (
                  <form className="wb-input-row wb-pf-add" onSubmit={(e) => { e.preventDefault(); addMethod(adding); }}>
                    <input className="wb-input" autoFocus placeholder={t("pfAddMethodId")} value={adding} onChange={(e) => setAdding(e.target.value)} />
                    <Button size="sm" variant="outline" type="submit">{t("pfAddMethod")}</Button>
                  </form>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setAdding("")} icon={<Icon name="plus" size={14} />}>{t("pfAddMethod")}</Button>
                )
              ) : null}
            </section>

            <section className="wb-pf-col wb-pf-editor">
              {method ? (
                <>
                  <div className="wb-pf-editor-head">
                    <span className="wb-pf-editor-id">{method.id}</span>
                    <span className="wb-muted">{t("pfBytes", { n: countChars(draft) })}</span>
                    {dirty ? <Tag tone="warning">{t("pfUnsaved")}</Tag> : null}
                  </div>
                  {!editable ? <Callout tone="info">{t("pfReadonly")}</Callout> : null}
                  <textarea
                    className="wb-pf-textarea"
                    value={draft}
                    readOnly={!editable}
                    spellCheck={false}
                    aria-label={method.id}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  {showBase && method.base_text ? <pre className="wb-pf-base" aria-label={t("pfShowBase")}>{method.base_text}</pre> : null}
                  {editable ? (
                    <div className="wb-pf-actions">
                      {method.base_text ? (
                        <Button size="sm" variant="ghost" onClick={() => setShowBase((v) => !v)} icon={<Icon name="eye" size={14} />}>{showBase ? t("pfHideBase") : t("pfShowBase")}</Button>
                      ) : null}
                      {method.from === "user" && !method.added ? (
                        <Button size="sm" variant="ghost" disabled={busy === "reset"} onClick={reset} icon={<Icon name="undo" size={14} />}>{t("pfReset")}</Button>
                      ) : null}
                      <Button size="sm" variant="primary" disabled={!dirty || busy === "save" || !draft.trim()} onClick={save} icon={busy === "save" ? <Spinner /> : <Icon name="check" size={14} />}>{t("pfSave")}</Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="wb-empty wb-pf-placeholder"><Icon name="book" size={20} /><p className="wb-muted">{t("pfPickMethod")}</p></div>
              )}
            </section>
          </>
        )}
      </div>
      <Notices notices={notices} onDismiss={dismiss} />
    </PanelModal>
  );
}
