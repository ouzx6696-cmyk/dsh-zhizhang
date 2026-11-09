import { errorText } from "../../../../core/src/errors.js";
import { notify } from "../../../../ui/src/notify";
import { COPY as viewCopy, t } from "../../../../ui/src/copy.js";
import { Manuscript } from "./Manuscript.jsx";
/**
 * 方法方案弹窗：左列方案（默认 / 原版 / 用户方案N），中列方法清单，右列全文。
 * 内置方案只读；用户方案可逐份保存、恢复底稿、新增、改名、删除；新建时可导入 .md 文件或整个文件夹。
 */
import { canLeaveEdit } from "./useSourceGuard.js";
import { confirmAction } from "./confirm.js";
import React from "react";
import { Button, cx, Icon, Tag } from "./ui.jsx";
import { Dialog } from "../../../../ui/src/primitives.jsx";
import { Callout } from "./common.jsx";
import { NewProfileForm } from "./ProfileNewForm.jsx";
import { ProfileMethodsColumn } from "./ProfileMethodsColumn.jsx";
import { ProfileMethodEditor } from "./ProfileMethodEditor.jsx";

const { useCallback, useEffect, useRef, useState } = React;
const MODE_NAME = { fanqie: viewCopy.modeFanqie, toutiao: viewCopy.ttTitle };

function InlineProfiles({ children }) {
  return <section className="wb-pf">{children}</section>;
}

export function ProfilesDialog({
  renderContent = (text) => <Manuscript text={text} />,
  mode,
  api,
  onClose,
  onChanged,
  inline = false,
  onEditState,
}) {
  const Frame = inline ? InlineProfiles : Dialog;
  const push = useCallback((tone, text) => void notify({ tone, text }), []);
  const [list, setList] = useState({
    status: "loading",
    profiles: [],
    active: "",
    pinned: false,
    error: "",
  });
  const [sel, setSel] = useState("");
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState("");
  const [method, setMethod] = useState(null);
  const [draft, setDraft] = useState("");
  const [modeView, setModeView] = useState("read");
  const [showBase, setShowBase] = useState(false);
  const [busy, setBusy] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [adding, setAdding] = useState(null);

  const loadList = useCallback(
    async (keep) => {
      try {
        const r = await api.list();
        setList({ status: "ready", error: "", ...r });
        setSel((cur) =>
          keep && r.profiles.some((p) => p.id === keep)
            ? keep
            : cur && r.profiles.some((p) => p.id === cur)
              ? cur
              : r.active,
        );
      } catch (e) {
        setList((l) => ({ ...l, status: "error", error: errorText(e) }));
      }
    },
    [api],
  );
  useEffect(() => {
    loadList();
  }, [loadList]);

  // 只有最后一次发出的请求可以落地：快速切换方案或方法时，较早的回执晚到也不得覆盖当前内容。
  const detailRequest = useRef(0);
  const methodRequest = useRef(0);
  const loadDetail = useCallback(
    async (id) => {
      if (!id) return;
      const request = ++detailRequest.current;
      try {
        const next = await api.detail(id);
        if (request === detailRequest.current) setDetail(next);
      } catch (e) {
        if (request === detailRequest.current) push("danger", errorText(e));
      }
    },
    [api, push],
  );
  useEffect(() => {
    methodRequest.current += 1;
    setBusy((current) => (current.startsWith("method:") ? "" : current));
    setDetail(null);
    setMethod(null);
    setDraft("");
    setConfirmDelete(false);
    setRenaming(null);
    setAdding(null);
    loadDetail(sel);
  }, [sel, loadDetail]);

  const profile = list.profiles.find((p) => p.id === sel);
  const editable = profile && profile.kind === "user";
  const dirty = method && editable && draft !== method.text;
  useEffect(() => {
    onEditState?.({ dirty: !!dirty, saving: busy === "save" });
  }, [dirty, busy, onEditState]);
  useEffect(() => () => onEditState?.({ dirty: false, saving: false }), [onEditState]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);

  // Resolves false when the author keeps the method draft that is being edited.
  const leaveMethod = useCallback(
    async () => canLeaveEdit({ dirty, saving: busy === "save" }, confirmAction),
    [dirty, busy],
  );

  const openMethod = useCallback(
    async (id) => {
      if (!(await leaveMethod())) return;
      const request = ++methodRequest.current;
      setBusy("method:" + id);
      try {
        const r = await api.method(sel, id);
        if (request !== methodRequest.current) return;
        setMethod({ ...r.method, base_text: r.base_text });
        setDraft(r.method.text);
        setShowBase(false);
        setModeView("read");
      } catch (e) {
        if (request === methodRequest.current) push("danger", errorText(e));
      } finally {
        if (request === methodRequest.current) setBusy("");
      }
    },
    [api, sel, leaveMethod, push],
  );

  const run = async (key, fn, ok) => {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) push("success", ok(r));
      return r;
    } catch (e) {
      push("danger", errorText(e));
      return undefined;
    } finally {
      setBusy("");
    }
  };

  const use = () =>
    run(
      "use",
      () => api.use(sel),
      () => t("pfUsed", { name: profile.name }),
    ).then((r) => {
      if (r) {
        loadList(sel);
        onChanged && onChanged();
      }
    });
  const save = () =>
    run(
      "save",
      () => api.save(sel, method.id, draft),
      (r) => t("pfSaved", { id: r.id }),
    ).then(async (r) => {
      if (!r) return;
      await Promise.all([loadDetail(sel), loadList(sel)]);
      setMethod((m) => ({ ...m, text: draft, from: "user" }));
    });
  const reset = () =>
    run(
      "reset",
      () => api.reset(sel, method.id),
      (r) => t("pfResetDone", { id: r.id }),
    )
      .then(async (r) => {
        if (!r) return;
        await Promise.all([loadDetail(sel), loadList(sel)]);
        const still = (await api.detail(sel)).methods.some((m) => m.id === method.id);
        if (still) openMethod(method.id);
        else {
          setMethod(null);
          setDraft("");
        }
      })
      .catch((error) => push("danger", errorText(error)));
  const create = (payload) =>
    run(
      "create",
      () => api.create(payload),
      (r) => t("pfCreated", { name: r.profile.name }),
    ).then(async (r) => {
      if (!r) return;
      setCreating(false);
      await loadList(r.profile.id);
      setSel(r.profile.id);
    });
  const remove = () =>
    run(
      "delete",
      () => api.remove(sel),
      () => t("pfDeleted", { name: profile.name }),
    ).then(async (r) => {
      if (!r) return;
      setConfirmDelete(false);
      onChanged && onChanged();
      await loadList("default");
      setSel("default");
    });
  const rename = (name) =>
    run(
      "rename",
      () => api.rename(sel, name),
      () => t("pfRenamed"),
    ).then((r) => {
      if (r) {
        setRenaming(null);
        loadList(sel);
      }
    });
  const addMethod = async (id) => {
    if (!(await leaveMethod())) return;
    const clean = id.trim();
    if (!clean) return;
    setAdding(null);
    setMethod({ id: clean, text: "", from: "user", added: true });
    setModeView("edit");
    setDraft("# " + clean + "\n\n");
  };

  const rows = (detail?.methods || []).filter(
    (m) => !filter || m.id.includes(filter) || (m.title || "").includes(filter),
  );
  const close = async () => {
    if (dirty && !(await confirmAction(t("pfUnsaved")))) return;
    onClose();
  };

  return (
    <Frame
      open
      title={t("pfTitle", { mode: MODE_NAME[mode] || mode })}
      closeLabel={t("close")}
      onClose={close}
      className="wb-modal-wide wb-pf"
      description={t("pfLead")}
    >
      {list.status === "error" ? <Callout tone="danger">{list.error}</Callout> : null}
      {list.pinned ? <Callout tone="info">{t("pfPinnedHint")}</Callout> : null}
      <div className="wb-pf-grid">
        <nav className="wb-pf-col wb-pf-profiles" aria-label={t("pfList")}>
          <ul className="wb-pf-list">
            {list.profiles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={cx("wb-pf-item", p.id === sel && "wb-pf-item-on")}
                  aria-current={p.id === sel || undefined}
                  disabled={!!p.broken}
                  onClick={async () => {
                    if (p.id === sel || !(await leaveMethod())) return;
                    setSel(p.id);
                  }}
                >
                  <span className="wb-pf-item-head">
                    <span className="wb-pf-item-name">{p.name}</span>
                    {p.active ? (
                      <Tag tone="success">{p.pinned ? t("pfPinned") : t("pfActive")}</Tag>
                    ) : null}
                    {p.broken ? <Tag tone="danger">{t("pfBroken")}</Tag> : null}
                    {p.nameConflict ? <Tag tone="warning">{t("pfNameConflict")}</Tag> : null}
                  </span>
                  <span className="wb-pf-item-meta">
                    <span>{p.kind === "user" ? t("pfUser") : t("pfBuiltin")}</span>
                    <span>{t("pfMethods", { n: p.methods })}</span>
                    {p.kind === "user" ? (
                      <span>{t("pfOverrides", { n: p.overrides || 0 })}</span>
                    ) : null}
                  </span>
                  {p.broken || p.note ? (
                    <span className="wb-pf-item-note">{p.broken || p.note}</span>
                  ) : null}
                  {p.nameConflict ? (
                    <span className="wb-pf-item-note">{t("pfNameConflictHint")}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            className="wb-pf-new-button"
            onClick={() => setCreating(true)}
            icon={<Icon name="plus" size={14} />}
          >
            {t("pfNew")}
          </Button>
        </nav>

        {creating ? (
          <section className="wb-pf-col wb-pf-span">
            <NewProfileForm
              profiles={list.profiles}
              base={sel}
              busy={busy === "create"}
              onCancel={() => setCreating(false)}
              onCreate={create}
            />
          </section>
        ) : (
          <>
            <ProfileMethodsColumn
              profile={profile}
              pinned={list.pinned}
              editable={editable}
              busy={busy}
              renaming={renaming}
              setRenaming={setRenaming}
              onRename={rename}
              onUse={use}
              onCopy={() => setCreating(true)}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
              onDelete={remove}
              filter={filter}
              setFilter={setFilter}
              rows={rows}
              detailLoaded={!!detail}
              methodId={method?.id}
              onOpenMethod={openMethod}
              adding={adding}
              setAdding={setAdding}
              onAddMethod={addMethod}
            />

            <ProfileMethodEditor
              method={method}
              title={method ? detail?.methods.find((m) => m.id === method.id)?.title : undefined}
              draft={draft}
              setDraft={setDraft}
              dirty={dirty}
              editable={editable}
              modeView={modeView}
              setModeView={setModeView}
              showBase={showBase}
              setShowBase={setShowBase}
              busy={busy}
              onReset={reset}
              onSave={save}
              renderContent={renderContent}
            />
          </>
        )}
      </div>
    </Frame>
  );
}
