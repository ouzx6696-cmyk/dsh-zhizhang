/** Centre column: manuscript reader with official, candidate and side-by-side views. */
import React from "react";
import { formatBytes, formatCount, t } from "../shared/copy.js";
import { Manuscript } from "../shared/Manuscript.jsx";
import { EMPTY_ISSUES, editMatches } from "./edit-state.js";
import { FONT_STEPS } from "./state.js";
import { Button, Icon, SegmentedControl, Tag } from "../shared/ui.jsx";
import { Callout, Empty, Skeleton } from "../shared/common.jsx";
import { SourceEditor } from "../shared/SourceEditor.jsx";



function BodyPane({ slot, kind, issues = EMPTY_ISSUES, annotationId }) {
  if (slot.status === "loading" || slot.status === "idle") {
    return (
      <div className="wb-pane-loading" role="status">
        <span className="wb-visually-hidden">{kind === "candidate" ? t("loadingCandidate") : t("loadingBody")}</span>
        <Skeleton lines={8} />
      </div>
    );
  }
  if (slot.status === "error") return <Callout tone="danger" role="alert">{slot.error}</Callout>;
  if (!String(slot.body || "").trim()) {
    return kind === "candidate" ? <Empty hint={t("emptyCandidate")} /> : <Empty icon="pen" title={t("emptyBody")} hint={t("emptyBodyHint")} />;
  }
  return (
    <>
      {slot.truncated ? (
        <Callout tone="warning">{kind === "candidate" ? t("candidateTruncated") : t("truncated", { size: formatBytes(slot.bodyBytes || 400 * 1024) })}</Callout>
      ) : null}
      <Manuscript text={slot.body} issues={issues} annotationId={annotationId} />
    </>
  );
}

export function Reader({ state, view, actions, annotationId: providedAnnotationId, readOnly = false }) {
  const generatedAnnotationId = React.useId();
  const annotationId = providedAnnotationId || generatedAnnotationId;
  const { dispatch } = actions;
  const { current, activeCand, chapterPending } = view;
  const meta = state.chapter.meta;
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => setEditing(false), [current?.id, activeCand?.id]);
  if (!state.chapterId || !current) {
    return (
      <div className="wb-reader-empty">
        <Empty icon="book" title={t("pickChapter")} hint={t("pickChapterHint")} />
      </div>
    );
  }
  const readerView = !activeCand && state.readerView !== "official" ? "official" : state.readerView;
  const issues = kind => editMatches(state, kind) ? state.edit.report.issues : EMPTY_ISSUES;
  const stepIndex = FONT_STEPS.indexOf(state.fontStep);
  const editorSlot = readerView === "candidate" ? state.candidate : state.chapter;
  const revision = meta?.revision ?? current.revision ?? current.readVersion;
  const editable =
    !readOnly &&
    readerView !== "split" &&
    typeof revision === "string" &&
    !!revision &&
    !editorSlot.truncated &&
    !!String(editorSlot.body || "").trim();
  const editorNote =
    readerView === "candidate"
      ? t("editorCandidateNote")
      : meta?.status === "final"
        ? t("editorFinalNote")
        : meta?.status === "reviewed"
          ? t("editorReviewNote")
          : undefined;
  const options = [
    { value: "official", label: t("readerOfficial") },
    { value: "candidate", label: t("readerCandidate"), disabled: !activeCand, title: activeCand ? undefined : t("noCandidate") },
    { value: "split", label: t("readerSplit"), disabled: !activeCand, title: activeCand ? undefined : t("noCandidate") },
  ];
  return (
    <div className="wb-reader" data-view={readerView} style={{ "--wb-font-step": String(state.fontStep) }}>
      <div className="wb-reader-bar">
        <div className="wb-reader-heading">
          <h2 className="wb-reader-title">{(meta && meta.title) || current.title || "未命名章节"}</h2>
          <span className="wb-reader-meta">
            <span>{t("words", { n: formatCount((meta && meta.wordCount) || current.wordCount || 0) })}</span>
            {readerView !== "official" && activeCand ? (
              <Tag tone="warning">{(activeCand.draftLabel ? "「" + activeCand.draftLabel + "」" : "候选稿") + " · " + t("words", { n: formatCount(activeCand.wordCount || 0) })}</Tag>
            ) : null}
          </span>
        </div>
        <div className="wb-reader-tools">
          {!editing ? (
          <>
          {readerView !== "official" && chapterPending.length > 1 ? (
            <select
              className="wb-select wb-candidate-select"
              aria-label={t("candidatePicker")}
              value={activeCand?.id || ""}
              onChange={(event) =>
                dispatch({
                  type: "selectCandidate",
                  chapterId: current.id,
                  id: event.target.value,
                })
              }
            >
              {chapterPending.map((cand, index) => (
                <option key={cand.id} value={cand.id}>
                  {(cand.draftLabel || t("candidateOption", { n: index + 1 })) +
                    " · " +
                    t("words", { n: formatCount(cand.wordCount || 0) })}
                </option>
              ))}
            </select>
          ) : null}
          {!editing ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!editable}
              title={!editable ? t("editorUnavailable") : undefined}
              onClick={() => setEditing(true)}
            >
              {t("editorToggle")}
            </Button>
          ) : null}
          <SegmentedControl
            id="wb-reader"
            label={t("readerViews")}
            value={readerView}
            options={options}
            onChange={(next) => dispatch({ type: "readerView", view: next })}
          />
          <span className="wb-font-tools">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("fontSmaller")}
              title={t("fontSmaller")}
              disabled={stepIndex <= 0}
              onClick={() => dispatch({ type: "fontStep", step: FONT_STEPS[stepIndex - 1] })}
              icon={<Icon name="minus" size={14} />}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("fontLarger")}
              title={t("fontLarger")}
              disabled={stepIndex >= FONT_STEPS.length - 1}
              onClick={() => dispatch({ type: "fontStep", step: FONT_STEPS[stepIndex + 1] })}
              icon={<Icon name="plus" size={14} />}
            />
          </span>
          </>
          ) : null}
        </div>
      </div>
      <div className="wb-reader-body wb-enter" key={current.id + ":" + readerView} id={"wb-reader-" + readerView + "-panel"} role="tabpanel" aria-labelledby={"wb-reader-" + readerView} tabIndex={0}>
        {editing ? (
          <SourceEditor
            key={current.id + ":" + readerView}
            initial={editorSlot.body}
            title={t("editorTitle")}
            note={editorNote}
            onSave={async (text) => {
              await actions.saveChapter({
                body: text,
                expectedRevision: revision,
                candidateId: readerView === "candidate" ? activeCand?.id : undefined,
              });
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : readerView === "split" ? (
          <div className="wb-split">
            <section className="wb-split-col" aria-label={t("officialColumn")}>
              <h3 className="wb-split-head">{t("officialColumn")}</h3>
              <BodyPane slot={state.chapter} kind="official" issues={issues("chapter")} annotationId={annotationId} />
            </section>
            <section className="wb-split-col" aria-label={t("candidateColumn", { id: activeCand.id })}>
              <h3 className="wb-split-head">{t("candidateColumn", { id: activeCand.draftLabel || activeCand.id })}</h3>
              <BodyPane slot={state.candidate} kind="candidate" issues={issues("candidate")} annotationId={annotationId} />
            </section>
          </div>
        ) : readerView === "candidate" ? (
          <BodyPane slot={state.candidate} kind="candidate" issues={issues("candidate")} annotationId={annotationId} />
        ) : (
          <BodyPane slot={state.chapter} kind="official" issues={issues("chapter")} annotationId={annotationId} />
        )}
      </div>
    </div>
  );
}
