/** Centre column: manuscript reader with official, candidate and side-by-side views. */
import React from "react";
import { formatBytes, formatCount, t } from "../copy.js";
import { Manuscript } from "./Manuscript.jsx";
import { Diagnostics } from "./Diagnostics.jsx";
import { EMPTY_ISSUES, editMatches } from "../edit-state.js";
import { FONT_STEPS } from "../state.js";
import { Button, Icon, SegmentedControl, Tag } from "../ui.jsx";
import { Callout, Empty, Skeleton, StatusTag } from "./common.jsx";



function BodyPane({ slot, kind, issues = EMPTY_ISSUES, annotationId }) {
  if (slot.status === "loading" || slot.status === "idle") {
    return (
      <div className="zz-pane-loading" role="status">
        <span className="zz-visually-hidden">{kind === "candidate" ? t("loadingCandidate") : t("loadingBody")}</span>
        <Skeleton lines={8} />
      </div>
    );
  }
  if (slot.status === "error") return <Callout tone="danger" role="alert">{slot.error}</Callout>;
  if (!String(slot.body || "").trim()) {
    return kind === "candidate" ? <Empty hint={t("emptyCandidate")} /> : <Empty title={t("emptyBody")} hint={t("emptyBodyHint")} />;
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

export function Reader({ state, view, actions }) {
  const annotationId = React.useId();
  const { dispatch } = actions;
  const { current, activeCand } = view;
  const meta = state.chapter.meta;
  if (!state.chapterId || !current) {
    return (
      <div className="zz-reader-empty">
        <Empty title={t("pickChapter")} hint={t("pickChapterHint")} />
      </div>
    );
  }
  const readerView = !activeCand && state.readerView !== "official" ? "official" : state.readerView;
  const issues = kind => editMatches(state, kind) ? state.edit.report.issues : EMPTY_ISSUES;
  const stepIndex = FONT_STEPS.indexOf(state.fontStep);
  const options = [
    { value: "official", label: t("readerOfficial") },
    { value: "candidate", label: t("readerCandidate"), disabled: !activeCand, title: activeCand ? undefined : t("noCandidate") },
    { value: "split", label: t("readerSplit"), disabled: !activeCand, title: activeCand ? undefined : t("noCandidate") },
  ];
  return (
    <div className="zz-reader" data-view={readerView} style={{ "--zz-font-step": String(state.fontStep) }}>
      <div className="zz-reader-bar">
        <div className="zz-reader-heading">
          <h2 className="zz-reader-title">{(meta && meta.title) || current.title || current.id}</h2>
          <span className="zz-reader-meta">
            <StatusTag status={(meta && meta.status) || current.status} />
            <span>{t("words", { n: formatCount((meta && meta.wordCount) || current.wordCount || 0) })}</span>
            {readerView !== "official" && activeCand ? (
              <Tag tone="warning">{(activeCand.draftLabel ? "「" + activeCand.draftLabel + "」" : activeCand.id) + " · " + t("words", { n: formatCount(activeCand.wordCount || 0) })}</Tag>
            ) : null}
          </span>
        </div>
        <div className="zz-reader-tools">
          <SegmentedControl
            id="zz-reader"
            label={t("readerViews")}
            value={readerView}
            options={options}
            onChange={(next) => dispatch({ type: "readerView", view: next })}
          />
          <span className="zz-font-tools">
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
        </div>
      </div>
      <Diagnostics state={state} view={view} actions={actions} annotationId={annotationId} />
      <div className="zz-reader-body" id={"zz-reader-" + readerView + "-panel"} role="tabpanel" aria-labelledby={"zz-reader-" + readerView} tabIndex={0}>
        {readerView === "split" ? (
          <div className="zz-split">
            <section className="zz-split-col" aria-label={t("officialColumn")}>
              <h3 className="zz-split-head">{t("officialColumn")}</h3>
              <BodyPane slot={state.chapter} kind="official" issues={issues("chapter")} annotationId={annotationId} />
            </section>
            <section className="zz-split-col" aria-label={t("candidateColumn", { id: activeCand.id })}>
              <h3 className="zz-split-head">{t("candidateColumn", { id: activeCand.draftLabel || activeCand.id })}</h3>
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
