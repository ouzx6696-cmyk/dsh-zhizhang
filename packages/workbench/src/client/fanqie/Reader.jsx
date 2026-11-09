import {
  COPY as viewCopy,
  formatBytes,
  formatCount,
  t,
  EDITOR_COPY,
} from "../../../../ui/src/copy.js";
/** Centre column: manuscript reader with official, candidate and side-by-side views. */
import React from "react";
import { Manuscript } from "../shared/Manuscript.jsx";
import { EMPTY_ISSUES, editMatches } from "./edit-state.js";
import { FONT_STEPS } from "./state.js";
import { Button, Icon, SegmentedControl, Tag } from "../shared/ui.jsx";
import { Callout, Empty, Skeleton } from "../shared/common.jsx";
import { SourceEditor } from "../shared/SourceEditor.jsx";
import { chapterDraftKey } from "../shared/drafts.js";
import { useReadingPosition } from "../shared/reading-position.js";
import { useReaderFind } from "../shared/useReaderFind.jsx";

function BodyPane({ slot, kind, title, issues = EMPTY_ISSUES, annotationId }) {
  if (slot.status === "loading" || slot.status === "idle") {
    return (
      <div className="wb-pane-loading" role="status">
        <span className="wb-visually-hidden">
          {kind === "candidate" ? t("loadingCandidate") : t("loadingBody")}
        </span>
        <Skeleton lines={8} />
      </div>
    );
  }
  if (slot.status === "error")
    return (
      <Callout tone="danger" role="alert">
        {slot.error}
      </Callout>
    );
  if (!String(slot.body || "").trim()) {
    return kind === "candidate" ? (
      <Empty hint={t("emptyCandidate")} />
    ) : (
      <Empty icon="pen" title={t("emptyBody")} hint={t("emptyBodyHint")} />
    );
  }
  return (
    <>
      {slot.truncated ? (
        <Callout tone="warning">
          {kind === "candidate"
            ? t("candidateTruncated")
            : t("truncated", { size: formatBytes(slot.bodyBytes || 400 * 1024) })}
        </Callout>
      ) : null}
      <Manuscript title={title} text={slot.body} issues={issues} annotationId={annotationId} />
    </>
  );
}

export function Reader({
  state,
  view,
  actions,
  annotationId: providedAnnotationId,
  readOnly = false,
}) {
  const generatedAnnotationId = React.useId();
  const annotationId = providedAnnotationId || generatedAnnotationId;
  const { dispatch } = actions;
  const { current: selectedChapter, activeCand, chapterPending } = view;
  const meta = state.chapter.meta;
  const [editing, setEditing] = React.useState(null);
  const shown = state.readerView === "candidate" ? state.candidate : state.chapter;
  const reading = useReadingPosition(!editing && shown.status === "ready" ? shown.body : null);
  const finder = useReaderFind(reading.body, !editing);
  const current =
    selectedChapter || (editing ? { id: editing.scope.chapter, title: editing.title } : null);
  if (!state.chapterId || !current) {
    return (
      <div className="wb-reader-empty">
        <Empty icon="book" title={t("pickChapter")} hint={t("pickChapterHint")} />
      </div>
    );
  }
  const readerView = !activeCand && state.readerView !== "official" ? "official" : state.readerView;
  const issues = (kind) => (editMatches(state, kind) ? state.edit.report.issues : EMPTY_ISSUES);
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
  // Saving over a final draft demotes it, so the author confirms that before the save goes out.
  const forceSave = !!editing && !editing.candidateId && editing.status === "final";
  const options = [
    { value: "official", label: t("readerOfficial") },
    {
      value: "candidate",
      label: t("readerCandidate"),
      disabled: !activeCand,
      title: activeCand ? undefined : t("noCandidate"),
    },
    {
      value: "split",
      label: t("readerSplit"),
      disabled: !activeCand,
      title: activeCand ? undefined : t("noCandidate"),
    },
  ];
  return (
    <div
      className="wb-reader"
      data-view={readerView}
      style={
        /** @type {import("react").CSSProperties} */ ({ "--wb-font-step": String(state.fontStep) })
      }
    >
      <div className="wb-reader-bar">
        <div className="wb-reader-heading">
          <h2 className="wb-reader-title">
            {(meta && meta.title) || current.title || viewCopy.chapterListText1}
          </h2>
          <span className="wb-reader-meta">
            <span>
              {t("words", { n: formatCount((meta && meta.wordCount) || current.wordCount || 0) })}
            </span>
            {readerView !== "official" && activeCand ? (
              <Tag tone="warning">
                {(activeCand.draftLabel
                  ? "「" + activeCand.draftLabel + "」"
                  : viewCopy.readerText1) +
                  " · " +
                  t("words", { n: formatCount(activeCand.wordCount || 0) })}
              </Tag>
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
                  onClick={() => {
                    reading.enter();
                    setEditing({
                      initial: editorSlot.body,
                      title: current.title,
                      expectedRevision: revision,
                      scope: { base: state.projectId, work: state.work, chapter: current.id },
                      candidateId: readerView === "candidate" ? activeCand?.id : undefined,
                      status: meta?.status,
                    });
                  }}
                >
                  {t("editorToggle")}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                aria-label={EDITOR_COPY.find}
                title={EDITOR_COPY.find + " (Ctrl+F)"}
                aria-keyshortcuts="Control+F"
                onClick={() => finder.openFind("find")}
                icon={<Icon name="search" size={14} />}
              />
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
      {finder.bar}
      <div
        ref={reading.body}
        className="wb-reader-body wb-enter"
        key={
          editing
            ? editing.scope.chapter + ":" + (editing.candidateId || "official")
            : current.id + ":" + readerView
        }
        id={"wb-reader-" + readerView + "-panel"}
        role="tabpanel"
        aria-labelledby={"wb-reader-" + readerView}
        tabIndex={0}
      >
        {editing ? (
          <SourceEditor
            key={
              editing
                ? editing.scope.chapter + ":" + (editing.candidateId || "official")
                : current.id + ":" + readerView
            }
            initial={editing.initial}
            title={t("editorTitle")}
            note={editorNote}
            draftKey={chapterDraftKey({
              base: editing.scope.base,
              work: editing.scope.work,
              chapter: editing.scope.chapter,
              slot: editing.candidateId || "official",
            })}
            baseRevision={editing.expectedRevision}
            saveConfirm={forceSave ? viewCopy.readerText2 : undefined}
            position={reading.position}
            onSave={async (text, baseRevision) => {
              await actions.saveChapter({
                body: text,
                expectedRevision: baseRevision,
                candidateId: editing.candidateId,
                scope: editing.scope,
                force: forceSave,
              });
              reading.leave();
              setEditing(null);
            }}
            onCancel={() => {
              reading.leave();
              setEditing(null);
            }}
            onStateChange={actions.sourceEditState}
          />
        ) : readerView === "split" ? (
          <div className="wb-split">
            <section className="wb-split-col" aria-label={t("officialColumn")}>
              <h3 className="wb-split-head">{t("officialColumn")}</h3>
              <BodyPane
                title={current.title}
                slot={state.chapter}
                kind="official"
                issues={issues("chapter")}
                annotationId={annotationId}
              />
            </section>
            <section
              className="wb-split-col"
              aria-label={t("candidateColumn", { id: activeCand.draftLabel || viewCopy.pfActive })}
            >
              <h3 className="wb-split-head">
                {t("candidateColumn", { id: activeCand.draftLabel || viewCopy.pfActive })}
              </h3>
              <BodyPane
                title={current.title}
                slot={state.candidate}
                kind="candidate"
                issues={issues("candidate")}
                annotationId={annotationId}
              />
            </section>
          </div>
        ) : readerView === "candidate" ? (
          <BodyPane
            title={current.title}
            slot={state.candidate}
            kind="candidate"
            issues={issues("candidate")}
            annotationId={annotationId}
          />
        ) : (
          <BodyPane
            title={current.title}
            slot={state.chapter}
            kind="official"
            issues={issues("chapter")}
            annotationId={annotationId}
          />
        )}
      </div>
    </div>
  );
}
