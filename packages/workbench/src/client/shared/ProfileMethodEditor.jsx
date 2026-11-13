/** 方法方案弹窗右列：单份方法的阅读、编辑、与底稿对照，以及保存和恢复。 */
import React from "react";
import { Button, Icon, Spinner, Tag } from "./ui.js";
import { Callout } from "./common.jsx";
import { COPY as viewCopy, t } from "@writer/ui/copy";

const countChars = (s) => (s || "").replace(/\s/g, "").length;

export function ProfileMethodEditor({
  method,
  title,
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
            <span className="wb-pf-editor-id">{title || viewCopy.profilesText1}</span>
            <span className="wb-muted">{t("pfBytes", { n: countChars(draft) })}</span>
            {dirty ? <Tag tone="warning">{t("pfUnsaved")}</Tag> : null}
          </div>
          {!editable ? <Callout tone="info">{t("pfReadonly")}</Callout> : null}
          <div className="ui-tabs" role="group" aria-label={viewCopy.profilesText2}>
            <button
              type="button"
              aria-pressed={modeView === "read"}
              onClick={() => setModeView("read")}
            >
              {viewCopy.profilesText3}
            </button>
            {editable && (
              <button
                type="button"
                aria-pressed={modeView === "edit"}
                onClick={() => setModeView("edit")}
              >
                {viewCopy.profilesText4}
              </button>
            )}
            {method.base_text && (
              <button
                type="button"
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
