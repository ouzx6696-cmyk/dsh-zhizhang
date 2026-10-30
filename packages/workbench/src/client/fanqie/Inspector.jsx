/** Right column: chapter lifecycle, author actions, candidates and context. */
import React from "react";
import { formatCount, t } from "../shared/copy.js";
import { Button, Icon, Tag, cx } from "../shared/ui.jsx";
import { ActionCard, Callout, Foundation, Hints, Section, StatusTag } from "../shared/common.jsx";

const STAGES = [
  ["planned", "stagePlanned"],
  ["drafted", "stageDrafted"],
  ["reviewed", "stageReviewed"],
  ["final", "stageFinal"],
];

function stageIndex(status) {
  const at = STAGES.findIndex(([value]) => value === (status === "draft" ? "drafted" : status));
  return at < 0 ? 1 : at;
}

function Lifecycle({ status }) {
  const at = stageIndex(status);
  return (
    <ol className="wb-stepper" aria-label={t("lifecycle")}>
      {STAGES.map(([value, key], i) => (
        <li key={value} className="wb-step" data-state={i < at ? "done" : i === at ? "current" : "todo"} aria-current={i === at ? "step" : undefined}>
          <span className="wb-step-mark" aria-hidden="true">
            {i < at ? <Icon name="check" size={10} /> : null}
          </span>
          <span className="wb-step-label">{t(key)}</span>
        </li>
      ))}
    </ol>
  );
}

function Gate({ ok, children }) {
  return (
    <li className="wb-gate" data-state={ok === true ? "ok" : ok === false ? "todo" : "idle"}>
      {children}
    </li>
  );
}

const VERDICT_TONE = { 通过: "success", 未通过: "warning", 结构性冲突: "danger" };

/** 写作 Agent：编辑审读回报 + 投递到对话 */
export function WriterAgent({ state, actions, chapterId, writer, bodyReady }) {
  const deliver = state.deliver || {};
  const caps = deliver.caps;
  const off = !caps ? t("disabledLoading") : !caps.deliver ? t("deliverOff", { reason: caps.reason || "" }) : "";
  const busy = !!deliver.busy;
  const review = writer && writer.editorReview;
  const send = (action, id) => actions.deliver(action, id);
  return (
    <Section title={t("writerTitle")} className="wb-writer">
      {chapterId ? (
        <>
          <p className="wb-muted">
            <strong>{t("editorReview")}：</strong>
            {!bodyReady ? t("disabledLoading") : !review ? t("editorNone") : null}
          </p>
          {bodyReady && review ? (
            <div className="wb-writer-review">
              <Tag tone={review.stale ? "quiet" : VERDICT_TONE[review.verdict] || "neutral"}>{review.verdict}</Tag>
              {review.stale ? <span className="wb-muted"> {t("editorStale")}</span> : null}
              <p className="wb-muted">
                {t("editorHard", { n: review.hardIssues || 0 })} · {t("editorLevels", { n: review.levels || 0 })}
                {review.at ? " · " + String(review.at).slice(0, 16).replace("T", " ") : ""}
              </p>
              {review.summary ? <p className="wb-writer-summary">{review.summary}</p> : null}
            </div>
          ) : null}
          {writer && writer.requireEditorPass ? <p className="wb-muted">{t("editorRequired")}</p> : null}
        </>
      ) : null}
      <div className="wb-action-cards">
        <ActionCard icon="pen" primary title={t("deliverContinue")} hint={t("deliverContinueHint")} busy={deliver.busy === "continue"} disabled={busy || !!off} offReason={off} onClick={() => send("continue")} />
        {chapterId ? (
          <ActionCard icon="eye" title={t("deliverReview")} hint={t("deliverReviewHint")} busy={deliver.busy === "review"} disabled={busy || !!off} offReason={off} onClick={() => send("review", chapterId)} />
        ) : null}
        {chapterId && review && !review.stale && review.verdict !== "通过" ? (
          <ActionCard icon="wand" title={t("deliverRevise")} hint={t("deliverReviseHint")} busy={deliver.busy === "revise"} disabled={busy || !!off} offReason={off} onClick={() => send("revise", chapterId)} />
        ) : null}
      </div>
      {off && caps ? <p className="wb-muted wb-off-reason"><Icon name="info" size={12} /> {off}</p> : null}
    </Section>
  );
}

export function Inspector({ state, view, actions }) {
  const { dispatch } = actions;
  const { current, chapterPending, activeCand, impacts, snap } = view;
  if (!current) {
    return (
      <div className="wb-inspector">
        {state.work ? <WriterAgent state={state} actions={actions} chapterId="" writer={null} bodyReady={false} /> : null}
        <Section title={t("nextSteps")}>
          <Hints hints={(snap && snap.nextHints) || []} />
        </Section>
      </div>
    );
  }
  const body = state.chapter;
  const meta = body.meta;
  const status = (meta && meta.status) || current.status;
  const review = meta && meta.review;
  const reviewCurrent = !!(review && meta && review.revision === meta.revision);
  const reviewPassed = reviewCurrent && review.result === "pass";
  const hasImpact = impacts.has(current.id);
  const bodyBlocked = body.status !== "ready" ? t("disabledLoading") : body.truncated ? t("disabledTruncated") : "";
  const writer = body.status === "ready" ? body.writer : null;
  const finalizeBlocked = bodyBlocked || (status === "final" ? "" : !reviewPassed ? t("disabledNoReview") : writer && writer.finalizeBlocked ? writer.finalizeBlocked : "");
  const open = (kind) => dispatch({ type: "openDialog", dialog: { kind } });
  const multiDraft = !!(snap && snap.multiDraftEnabled);

  return (
    <div className="wb-inspector">
      <Section title={t("lifecycle")} aside={<StatusTag status={status} />}>
        <Lifecycle status={status} />
        <p className="wb-muted">
          {!review ? t("reviewNone") : reviewCurrent ? t("reviewCurrent", { result: review.result === "blocked" ? t("reviewBlocked") : t("reviewPass") }) : t("reviewStale")}
        </p>
        {hasImpact ? <Callout tone="warning">{t("impactNotice")}</Callout> : null}
        <div className="wb-action-row">
          <Button variant="outline" size="sm" disabled={!!bodyBlocked} title={bodyBlocked || undefined} onClick={() => open("review")}>
            {t("actionReview")}
          </Button>
          <Button
            variant={reviewPassed && status !== "final" ? "primary" : "outline"}
            size="sm"
            disabled={!!finalizeBlocked || status === "final"}
            title={finalizeBlocked || undefined}
            onClick={() => open("finalize")}
          >
            {t("actionFinalize")}
          </Button>
          {hasImpact ? (
            <Button variant="outline" size="sm" disabled={!!bodyBlocked} title={bodyBlocked || undefined} onClick={() => open("acknowledge")}>
              {t("actionAcknowledge")}
            </Button>
          ) : null}
        </div>
      </Section>

      <WriterAgent state={state} actions={actions} chapterId={current.id} writer={writer} bodyReady={body.status === "ready"} />

      <Section title={t("candidates")} aside={chapterPending.length ? <span className="wb-count">{chapterPending.length}</span> : null}>
        <ul className="wb-gates">
          <Gate ok={!!current.briefRecent}>{current.briefRecent ? t("gateBriefOk") : t("gateBriefMissing")}</Gate>
          <Gate ok={activeCand ? !!activeCand.hasLintPass : undefined}>
            {activeCand ? (activeCand.hasLintPass ? t("gateLintOk") : t("gateLintPending")) : t("gateNoCandidate")}
          </Gate>
        </ul>
        {chapterPending.length ? (
          <>
            <ul className="wb-candidate-cards">
              {chapterPending.map((pc) => {
                const on = activeCand && activeCand.id === pc.id;
                return (
                  <li key={pc.id}>
                    <button
                      type="button"
                      className={cx("wb-candidate-card", on && "wb-candidate-card-on")}
                      aria-pressed={on ? "true" : "false"}
                      onClick={() => dispatch({ type: "selectCandidate", chapterId: current.id, id: pc.id })}
                    >
                      <span className="wb-candidate-card-title">{pc.draftLabel ? "「" + pc.draftLabel + "」 " + pc.id : pc.id}</span>
                      <span className="wb-candidate-card-meta">
                        {t("words", { n: formatCount(pc.wordCount || 0) })}
                        {pc.hasLintPass ? " · lint ✓" : ""}
                        {pc.lintHitCount ? " · hits " + pc.lintHitCount : ""}
                        {pc.editOf ? " · " + t("candidateEdit") : ""}
                      </span>
                      {pc.note ? <span className="wb-candidate-card-note">{pc.note}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {activeCand ? (
              <Button variant="primary" size="sm" className="wb-block-button" onClick={() => dispatch({ type: "openDialog", dialog: { kind: "accept", cand: activeCand } })}>
                {t("acceptCurrent")}
              </Button>
            ) : null}
            {chapterPending.length >= 2 ? (
              multiDraft ? (
                <div className="wb-action-row">
                  <Button variant="outline" size="sm" disabled={state.unify.busy} onClick={actions.unifyPrepare}>
                    {state.unify.busy ? t("unifyBusy") : t("unify")}
                  </Button>
                  <span className="wb-muted">{t("unifyHint")}</span>
                </div>
              ) : (
                <p className="wb-muted">{t("unifyOff")}</p>
              )
            ) : null}
            {state.unify.message ? <Callout tone="success">{state.unify.message}</Callout> : null}
            {state.unify.error ? <Callout tone="danger" role="alert">{state.unify.error}</Callout> : null}
          </>
        ) : null}
      </Section>

      <details className="wb-disclosure" open={!!(activeCand && activeCand.editOf)}>
        <summary>{activeCand && activeCand.editOf ? t("editTitle") : t("editOptionalTitle")}</summary>
        {activeCand && activeCand.editOf ? (
          <ol className="wb-plain-list">
            <li>{t("editA")}</li>
            <li>{t("editB")}</li>
            <li>{t("editC")}</li>
          </ol>
        ) : (
          <p className="wb-muted">{t("editOptional")}</p>
        )}
      </details>

      <details className="wb-disclosure">
        <summary>{t("foundation")}</summary>
        <Foundation foundation={snap && snap.foundation} limit={200} />
      </details>

      <Section title={t("nextSteps")}>
        <Hints hints={(snap && snap.nextHints) || []} initial={3} />
      </Section>
    </div>
  );
}
