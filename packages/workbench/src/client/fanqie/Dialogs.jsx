/**
 * Confirmation dialogs. Every write the panel can make (accept, review,
 * finalize, acknowledge) goes through one of these with an explicit checkbox
 * or button; nothing is written on a single click.
 */
import React from "react";
import { formatCount, t } from "../shared/copy.js";
import { Button, Checkbox, Modal, SegmentedControl } from "../shared/ui.jsx";
import { Callout } from "../shared/common.jsx";

const { useState } = React;

function errorText(err) {
  if (!err) return "";
  return (err.code ? "[" + err.code + "] " : "") + (err.message || String(err));
}

function AcceptDialog({ cand, onAccept, onClose }) {
  const [confirmed, setConfirmed] = useState(false);
  const [force, setForce] = useState(false);
  const [skipBrief, setSkipBrief] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isEdit = !!cand.editOf;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAccept(cand, { force, skipBrief });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal
      open
      onClose={close}
      title={t("acceptTitle")}
      closeLabel={t("close")}
      description={t("acceptSummary", { id: cand.draftLabel ? "「" + cand.draftLabel + "」" + cand.id : cand.id, chapter: cand.chapterId, words: formatCount(cand.wordCount || 0) })}
      footer={
        <div className="wb-scope">
          <div className="wb-dialog-actions">
          <Button variant="ghost" onClick={close} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!confirmed || busy}>
            {busy ? t("acceptBusy") : t("acceptSubmit")}
          </Button>
          </div>
        </div>
      }
    >
      <div className="wb-scope">
      <div className="wb-dialog-body">
        {isEdit ? <Callout tone="info">{t("acceptEditNote")}</Callout> : null}
        {!cand.hasLintPass ? <Callout tone="warning">{t("acceptNoLint")}</Callout> : null}
        <Checkbox checked={confirmed} disabled={busy} onChange={setConfirmed} label={isEdit ? t("acceptConfirmEdit") : t("acceptConfirm")} />
        <Checkbox checked={force} disabled={busy} onChange={setForce} label={t("acceptForce")} />
        <Checkbox checked={skipBrief} disabled={busy} onChange={setSkipBrief} label={t("acceptSkipBrief")} />
        <p className="wb-muted">{t("acceptFooter")}</p>
        {error ? (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        ) : null}
      </div>
      </div>
    </Modal>
  );
}

const ACTION_COPY = {
  review: { title: "reviewTitle", body: "reviewBody", submit: "reviewSubmit" },
  finalize: { title: "finalizeTitle", body: "finalizeBody", submit: "finalizeSubmit" },
  acknowledge: { title: "acknowledgeTitle", body: "acknowledgeBody", submit: "acknowledgeSubmit" },
};

function ChapterActionDialog({ kind, chapter, meta, onSubmit, onClose }) {
  const copy = ACTION_COPY[kind];
  const [result, setResult] = useState("pass");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const label = (meta && meta.title) || (chapter && (chapter.title || chapter.id)) || "";
  const revision = meta && meta.revision ? String(meta.revision).slice(0, 12) : "—";
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(kind, kind === "review" ? { result, ...(summary.trim() ? { summary: summary.trim() } : {}) } : undefined);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal
      open
      onClose={close}
      title={t(copy.title)}
      closeLabel={t("close")}
      description={t(copy.body, { chapter: label, revision })}
      footer={
        <div className="wb-scope">
          <div className="wb-dialog-actions">
          <Button variant="ghost" onClick={close} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? t("actionBusy") : t(copy.submit)}
          </Button>
          </div>
        </div>
      }
    >
      <div className="wb-scope">
      <div className="wb-dialog-body">
        {kind === "review" ? (
          <>
            <div className="wb-form-row">
              <span className="wb-form-label" id="wb-review-result-label">
                {t("reviewResultLabel")}
              </span>
              <SegmentedControl
                id="wb-review-result"
                label={t("reviewResultLabel")}
                value={result}
                disabled={busy}
                onChange={setResult}
                options={[
                  { value: "pass", label: t("reviewPass") },
                  { value: "blocked", label: t("reviewBlocked") },
                ]}
              />
            </div>
            <label className="wb-form-row">
              <span className="wb-form-label">{t("reviewSummaryLabel")}</span>
              <textarea
                className="wb-textarea"
                rows={3}
                value={summary}
                disabled={busy}
                placeholder={t("reviewSummaryPlaceholder")}
                onChange={(e) => setSummary(e.target.value)}
              />
            </label>
          </>
        ) : null}
        {error ? (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        ) : null}
      </div>
      </div>
    </Modal>
  );
}

export function Dialogs({ state, view, actions }) {
  const dialog = state.dialog;
  if (!dialog) return null;
  const close = () => actions.dispatch({ type: "closeDialog" });
  if (dialog.kind === "accept") return <AcceptDialog cand={dialog.cand} onAccept={(cand, opts) => actions.accept(cand, opts, dialog)} onClose={close} />;
  return <ChapterActionDialog kind={dialog.kind} chapter={dialog.chapter} meta={dialog.meta} onSubmit={(kind, extra) => actions.chapterAction(kind, extra, dialog)} onClose={close} />;
}
