import { request } from '../api.js';
/** Right column: chapter lifecycle, author actions, candidates and context. */
import React from "react";
import { formatCount, t } from "../copy.js";
import { Button, Icon, cx } from "../ui.jsx";
import { Callout, Foundation, Hints, Section, StatusTag } from "./common.jsx";

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
    <ol className="zz-stepper" aria-label={t("lifecycle")}>
      {STAGES.map(([value, key], i) => (
        <li key={value} className="zz-step" data-state={i < at ? "done" : i === at ? "current" : "todo"} aria-current={i === at ? "step" : undefined}>
          <span className="zz-step-mark" aria-hidden="true">
            {i < at ? <Icon name="check" size={10} /> : null}
          </span>
          <span className="zz-step-label">{t(key)}</span>
        </li>
      ))}
    </ol>
  );
}

function Gate({ ok, children }) {
  return (
    <li className="zz-gate" data-state={ok === true ? "ok" : ok === false ? "todo" : "idle"}>
      {children}
    </li>
  );
}

export function Inspector({ state, view, actions }) {
  const { dispatch } = actions;
  const { current, chapterPending, activeCand, impacts, snap } = view;
  if (!current) {
    return (
      <div className="zz-inspector">
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
  const finalizeBlocked = bodyBlocked || (status === "final" ? "" : !reviewPassed ? t("disabledNoReview") : "");
  const open = (kind) => dispatch({ type: "openDialog", dialog: { kind } });
  const multiDraft = !!(snap && snap.multiDraftEnabled);

  return (
    <div className="zz-inspector">
      <Section title="写作 Agent">
        <p>{meta?.writerReview ? `结论：${meta.writerReview.verdict}；${meta.writerReview.fresh ? '当前版本' : '已过期'}；硬伤 ${meta.writerReview.hard_count}` : '尚无编辑回报'}</p>
        {['continue','review',...(meta?.writerReview?.verdict !== '通过' && meta?.writerReview ? ['revise'] : [])].map(action => (
          <Button key={action} size="sm" disabled={!!bodyBlocked} onClick={async () => {
            const label = {continue:'续写下一章',review:'派编辑审读本章',revise:'按回报修改'}[action];
            if (!window.confirm(`向本项目最近使用织章的主会话发送“${label}”？`)) return;
            try { await request('/writer/action', {method:'POST',body:{base:state.base,work:state.work,chapter:current.id,action,confirm:true}}); window.alert('已发送到主会话'); }
            catch(e) { window.alert(e.message); }
          }}>{ {continue:'续写下一章',review:'派编辑审读本章',revise:'按回报修改'}[action] }</Button>
        ))}
      </Section>
      <Section title={t("lifecycle")} aside={<StatusTag status={status} />}>
        <Lifecycle status={status} />
        <p className="zz-muted">
          {!review ? t("reviewNone") : reviewCurrent ? t("reviewCurrent", { result: review.result === "blocked" ? t("reviewBlocked") : t("reviewPass") }) : t("reviewStale")}
        </p>
        {hasImpact ? <Callout tone="warning">{t("impactNotice")}</Callout> : null}
        <div className="zz-action-row">
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

      <Section title={t("candidates")} aside={chapterPending.length ? <span className="zz-count">{chapterPending.length}</span> : null}>
        <ul className="zz-gates">
          <Gate ok={!!current.briefRecent}>{current.briefRecent ? t("gateBriefOk") : t("gateBriefMissing")}</Gate>
          <Gate ok={activeCand ? !!activeCand.hasLintPass : undefined}>
            {activeCand ? (activeCand.hasLintPass ? t("gateLintOk") : t("gateLintPending")) : t("gateNoCandidate")}
          </Gate>
        </ul>
        {chapterPending.length ? (
          <>
            <ul className="zz-candidate-cards">
              {chapterPending.map((pc) => {
                const on = activeCand && activeCand.id === pc.id;
                return (
                  <li key={pc.id}>
                    <button
                      type="button"
                      className={cx("zz-candidate-card", on && "zz-candidate-card-on")}
                      aria-pressed={on ? "true" : "false"}
                      onClick={() => dispatch({ type: "selectCandidate", chapterId: current.id, id: pc.id })}
                    >
                      <span className="zz-candidate-card-title">{pc.draftLabel ? "「" + pc.draftLabel + "」 " + pc.id : pc.id}</span>
                      <span className="zz-candidate-card-meta">
                        {t("words", { n: formatCount(pc.wordCount || 0) })}
                        {pc.hasLintPass ? " · lint ✓" : ""}
                        {pc.lintHitCount ? " · hits " + pc.lintHitCount : ""}
                        {pc.editOf ? " · " + t("candidateEdit") : ""}
                      </span>
                      {pc.note ? <span className="zz-candidate-card-note">{pc.note}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {activeCand ? (
              <Button variant="primary" size="sm" className="zz-block-button" onClick={() => dispatch({ type: "openDialog", dialog: { kind: "accept", cand: activeCand } })}>
                {t("acceptCurrent")}
              </Button>
            ) : null}
            {chapterPending.length >= 2 ? (
              multiDraft ? (
                <div className="zz-action-row">
                  <Button variant="outline" size="sm" disabled={state.unify.busy} onClick={actions.unifyPrepare}>
                    {state.unify.busy ? t("unifyBusy") : t("unify")}
                  </Button>
                  <span className="zz-muted">{t("unifyHint")}</span>
                </div>
              ) : (
                <p className="zz-muted">{t("unifyOff")}</p>
              )
            ) : null}
            {state.unify.message ? <Callout tone="success">{state.unify.message}</Callout> : null}
            {state.unify.error ? <Callout tone="danger" role="alert">{state.unify.error}</Callout> : null}
          </>
        ) : null}
      </Section>

      <details className="zz-disclosure" open={!!(activeCand && activeCand.editOf)}>
        <summary>{activeCand && activeCand.editOf ? t("editTitle") : t("editOptionalTitle")}</summary>
        {activeCand && activeCand.editOf ? (
          <ol className="zz-plain-list">
            <li>{t("editA")}</li>
            <li>{t("editB")}</li>
            <li>{t("editC")}</li>
          </ol>
        ) : (
          <p className="zz-muted">{t("editOptional")}</p>
        )}
      </details>

      <details className="zz-disclosure">
        <summary>{t("foundation")}</summary>
        <Foundation foundation={snap && snap.foundation} limit={200} />
      </details>

      <Section title={t("nextSteps")}>
        <Hints hints={(snap && snap.nextHints) || []} initial={3} />
      </Section>
    </div>
  );
}
