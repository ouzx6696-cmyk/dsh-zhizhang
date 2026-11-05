import React from "react";
import { Button, cx, Icon, Spinner, Tag } from "./ui.jsx";
import { Callout } from "./common.jsx";
import { COPY as viewCopy, t } from "../../../../ui/src/copy.js";

const { useState } = React;

const countChars = (s) => (s || "").replace(/\s/g, "").length;

function FromTag({ row }) {
  if (row.added) return <Tag tone="info">{t("pfFromAdded")}</Tag>;
  if (row.overridden) return <Tag tone="success">{t("pfFromUser")}</Tag>;
  return null;
}


export function NewProfileForm({ profiles, base, onCancel, onCreate, busy }) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState(base || "default");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState([]);
  const pick = async (list) => {
    const md = Array.from(list || [])
      .filter((f) => /\.md$/i.test(f.name))
      .slice(0, 300);
    const read = await Promise.all(
      md.map(async (f) => {
        const rel = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
        const parts = rel.split("/");
        const id = (f.webkitRelativePath ? parts.slice(1).join("/") : rel).replace(/\.md$/i, "");
        return { id, text: await f.text() };
      }),
    );
    setFiles(read.filter((f) => f.id && f.text.trim()));
  };
  return (
    <form
      className="wb-pf-new"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({
          name: name.trim() || undefined,
          base: from,
          note: note.trim() || undefined,
          files,
        });
      }}
    >
      <h3 className="wb-pf-subhead">{t("pfNewTitle")}</h3>
      <label className="wb-form-row">
        <span className="wb-form-label">{t("pfNewName")}</span>
        <input
          className="wb-input"
          value={name}
          maxLength={24}
          placeholder={t("pfNewNameHint")}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="wb-form-row">
        <span className="wb-form-label">{t("pfNewBase")}</span>
        <select className="wb-select" value={from} onChange={(e) => setFrom(e.target.value)}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="wb-form-row">
        <span className="wb-form-label">{t("pfNewNote")}</span>
        <input
          className="wb-input"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="wb-form-row">
        <span className="wb-form-label">{t("pfNewFiles")}</span>
        <span className="wb-input-row">
          <label className="wb-file-button">
            <Icon name="upload" size={14} />
            {t("pfNewPick")}
            <input
              type="file"
              accept=".md,text/markdown"
              multiple
              onChange={(e) => pick(e.target.files)}
            />
          </label>
          <label className="wb-file-button">
            <Icon name="upload" size={14} />
            {t("pfNewFolder")}
            <input
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              onChange={(e) => pick(e.target.files)}
            />
          </label>
          {files.length ? (
            <span className="wb-muted">{t("pfNewPicked", { n: files.length })}</span>
          ) : null}
        </span>
        <span className="wb-form-hint">{t("pfNewFilesHint")}</span>
      </div>
      <div className="wb-pf-actions">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          type="submit"
          disabled={busy}
          icon={busy ? <Spinner /> : <Icon name="plus" size={14} />}
        >
          {t("pfCreate")}
        </Button>
      </div>
    </form>
  );
}


export function ProfileMethodsColumn({
  profile,
  pinned,
  editable,
  busy,
  renaming,
  setRenaming,
  onRename,
  onUse,
  onCopy,
  confirmDelete,
  setConfirmDelete,
  onDelete,
  filter,
  setFilter,
  rows,
  detailLoaded,
  methodId,
  onOpenMethod,
  adding,
  setAdding,
  onAddMethod,
}) {
  return (
    <section className="wb-pf-col wb-pf-methods" aria-label={profile ? profile.name : ""}>
  {profile ? (
    <div className="wb-pf-head">
      {renaming !== null ? (
        <form
          className="wb-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            onRename(renaming);
          }}
        >
          <input
            className="wb-input"
            autoFocus
            value={renaming}
            maxLength={24}
            onChange={(e) => setRenaming(e.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            type="submit"
            disabled={busy === "rename"}
          >
            {t("pfRename")}
          </Button>
        </form>
      ) : (
        <h3 className="wb-pf-subhead">{profile.name}</h3>
      )}
      <div className="wb-pf-actions">
        <Button
          size="sm"
          variant={profile.active ? "ghost" : "primary"}
          disabled={profile.active || pinned || busy === "use"}
          onClick={onUse}
          icon={busy === "use" ? <Spinner /> : <Icon name="check" size={14} />}
        >
          {profile.active ? t("pfActive") : t("pfUse")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCopy}
          title={t("pfCopy")}
          icon={<Icon name="plus" size={14} />}
        >
          {t("pfCopy")}
        </Button>
        {editable ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRenaming(profile.name)}
              icon={<Icon name="pen" size={14} />}
              aria-label={t("pfRename")}
              title={t("pfRename")}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              icon={<Icon name="trash" size={14} />}
              aria-label={t("pfDelete")}
              title={t("pfDelete")}
            />
          </>
        ) : null}
      </div>
      {confirmDelete ? (
        <Callout tone="danger">
          {t("pfDeleteConfirm", { name: profile.name })}
          <span className="wb-pf-actions">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy === "delete"}
              onClick={onDelete}
            >
              {t("pfDelete")}
            </Button>
          </span>
        </Callout>
      ) : null}
    </div>
  ) : null}
  <label className="wb-pf-search">
    <Icon name="search" size={14} />
    <input
      className="wb-input"
      placeholder={t("pfSearch")}
      value={filter}
      onChange={(e) => setFilter(e.target.value)}
    />
  </label>
  <ul className="wb-pf-methods-list">
    {rows.length ? (
      rows.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            className={cx("wb-pf-method", methodId === m.id && "wb-pf-method-on")}
            onClick={() => onOpenMethod(m.id)}
          >
            <span className="wb-pf-method-text">
              <span className="wb-pf-method-title">{m.title || m.id}</span>
              {m.title ? <span className="wb-pf-method-id">{m.id}</span> : null}
            </span>
            {busy === "method:" + m.id ? <Spinner /> : <FromTag row={m} />}
          </button>
        </li>
      ))
    ) : (
      <li className="wb-muted wb-pf-empty">{detailLoaded ? t("pfEmpty") : <Spinner />}</li>
    )}
  </ul>
  {editable ? (
    adding !== null ? (
      <form
        className="wb-input-row wb-pf-add"
        onSubmit={(e) => {
          e.preventDefault();
          onAddMethod(adding);
        }}
      >
        <input
          className="wb-input"
          autoFocus
          placeholder={t("pfAddMethodId")}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
        />
        <Button size="sm" variant="outline" type="submit">
          {t("pfAddMethod")}
        </Button>
      </form>
    ) : (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setAdding("")}
        icon={<Icon name="plus" size={14} />}
      >
        {t("pfAddMethod")}
      </Button>
    )
  ) : null}
    </section>
  );
}

export function ProfileMethodEditor({
  method,
  rows,
  draft,
  setDraft,
  dirty,
  editable,
  modeView,
  setModeView,
  showBase,
  setShowBase,
  busy,
  onReset,
  onSave,
  renderContent,
}) {
  return (
    <section className="wb-pf-col wb-pf-editor">
  {method ? (
    <>
      <div className="wb-pf-editor-head">
        <span className="wb-pf-editor-id">
          {rows.find((row) => row.id === method.id)?.title || viewCopy.profilesText1}
        </span>
        <span className="wb-muted">{t("pfBytes", { n: countChars(draft) })}</span>
        {dirty ? <Tag tone="warning">{t("pfUnsaved")}</Tag> : null}
      </div>
      {!editable ? <Callout tone="info">{t("pfReadonly")}</Callout> : null}
      <div className="ui-tabs" role="group" aria-label={viewCopy.profilesText2}>
        <button aria-pressed={modeView === "read"} onClick={() => setModeView("read")}>
          {viewCopy.profilesText3}
        </button>
        {editable && (
          <button
            aria-pressed={modeView === "edit"}
            onClick={() => setModeView("edit")}
          >
            {viewCopy.profilesText4}
          </button>
        )}
        {method.base_text && (
          <button
            aria-pressed={modeView === "compare"}
            onClick={() => setModeView("compare")}
          >
            {viewCopy.profilesText5}
          </button>
        )}
      </div>
      {modeView === "edit" ? (
        <textarea
          className="wb-pf-textarea"
          value={draft}
          readOnly={!editable}
          spellCheck={false}
          aria-label={method.id}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : modeView === "compare" ? (
        <div className="wb-pf-compare">
          <div className="wb-pf-reading">
            <h3>{viewCopy.profilesText6}</h3>
            {renderContent(method.base_text || "")}
          </div>
          <div className="wb-pf-reading">
            <h3>{viewCopy.profilesText7}</h3>
            {renderContent(draft)}
          </div>
        </div>
      ) : (
        <div className="wb-pf-reading">{renderContent(draft)}</div>
      )}
      {showBase && method.base_text ? (
        <pre className="wb-pf-base" aria-label={t("pfShowBase")}>
          {method.base_text}
        </pre>
      ) : null}
      {editable ? (
        <div className="wb-pf-actions">
          {method.base_text ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowBase((v) => !v)}
              icon={<Icon name="eye" size={14} />}
            >
              {showBase ? t("pfHideBase") : t("pfShowBase")}
            </Button>
          ) : null}
          {method.from === "user" && !method.added ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy === "reset"}
              onClick={onReset}
              icon={<Icon name="undo" size={14} />}
            >
              {t("pfReset")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty || busy === "save" || !draft.trim()}
            onClick={onSave}
            icon={busy === "save" ? <Spinner /> : <Icon name="check" size={14} />}
          >
            {t("pfSave")}
          </Button>
        </div>
      ) : null}
    </>
  ) : (
    <div className="wb-empty wb-pf-placeholder">
      <Icon name="book" size={20} />
      <p className="wb-muted">{t("pfPickMethod")}</p>
    </div>
  )}
    </section>
  );
}
