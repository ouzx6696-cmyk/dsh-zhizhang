/** 方法方案弹窗中列：方案头部操作（启用、复制、改名、删除）与可筛选的方法清单。 */
import React from "react";
import { Button, cx, Icon, Spinner, Tag } from "./ui.jsx";
import { Callout } from "./common.jsx";
import { t } from "../../../../ui/src/copy.js";

function FromTag({ row }) {
  if (row.added) return <Tag tone="info">{t("pfFromAdded")}</Tag>;
  if (row.overridden) return <Tag tone="success">{t("pfFromUser")}</Tag>;
  return null;
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
              <Button size="sm" variant="primary" type="submit" disabled={busy === "rename"}>
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
                <Button size="sm" variant="danger" disabled={busy === "delete"} onClick={onDelete}>
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
