import { errorText } from "../../../../core/src/errors.js";
import { useNotices } from "../../../../ui/src/use-notices.js";
import { COPY as viewCopy } from "../../../../ui/src/copy.js";
import { Manuscript } from "./Manuscript.jsx";
/**
 * 方法方案弹窗：左列方案（默认 / 原版 / 用户方案N），中列方法清单，右列全文。
 * 内置方案只读；用户方案可逐份保存、恢复底稿、新增、改名、删除；新建时可导入 .md 文件或整个文件夹。
 */
import { canLeaveEdit } from "./useSourceGuard.js";
import React from "react";
import { t } from "../../../../ui/src/copy.js";
import { Button, cx, Icon, Tag } from "./ui.jsx";
import { Dialog } from "../../../../ui/src/primitives.jsx";
import { Callout, Notices } from "./common.jsx";
import { NewProfileForm, ProfileMethodEditor, ProfileMethodsColumn } from "./ProfileParts.jsx";

const { useCallback, useEffect, useState } = React;
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
  confirm,
}) {
  const Frame = inline ? InlineProfiles : Dialog;
  const { notices, push, dismiss } = useNotices();
  const [list, setList] = useState({ status: "loading", profiles: [], active: "", pinned: false });
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
        setList({ status: "ready", ...r });
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

  const loadDetail = useCallback(
    async (id) => {
      if (!id) return;
      try {
        setDetail(await api.detail(id));
      } catch (e) {
        push("danger", errorText(e));
      }
    },
    [api, push],
  );
  useEffect(() => {
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

  const openMethod = useCallback(
    async (id) => {
      if (!canLeaveEdit({ dirty, saving: busy === "save" }, window.confirm)) return;
      setBusy("method:" + id);
      try {
        const r = await api.method(sel, id);
        setMethod({ ...r.method, base_text: r.base_text });
        setDraft(r.method.text);
        setShowBase(false);
        setModeView("read");
      } catch (e) {
        push("danger", errorText(e));
      }
      setBusy("");
    },
    [api, sel, dirty, push, busy],
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
  const addMethod = (id) => {
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
    const ask = confirm || ((message) => Promise.resolve(window.confirm(message)));
    if (dirty && !(await ask(t("pfUnsaved")))) return;
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
                  onClick={() => setSel(p.id)}
                >
                  <span className="wb-pf-item-head">
                    <span className="wb-pf-item-name">{p.name}</span>
                    {p.active ? (
                      <Tag tone="success">{p.pinned ? t("pfPinned") : t("pfActive")}</Tag>
                    ) : null}
                  </span>
                  <span className="wb-pf-item-meta">
                    <span>{p.kind === "user" ? t("pfUser") : t("pfBuiltin")}</span>
                    <span>{t("pfMethods", { n: p.methods })}</span>
                    {p.kind === "user" ? (
                      <span>{t("pfOverrides", { n: p.overrides || 0 })}</span>
                    ) : null}
                  </span>
                  {p.note ? <span className="wb-pf-item-note">{p.note}</span> : null}
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
              rows={rows}
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
      <Notices notices={notices} onDismiss={dismiss} />
    </Frame>
  );
}
