import React from "react";
import {
  COPY as viewCopy,
  formatClock,
  formatCount,
  t,
  t as viewText,
} from "../../../../ui/src/copy.js";
import { ActionButton, Button, Icon, Tag } from "../shared/ui.jsx";
import { ActionCard, Section } from "../shared/common.jsx";
import { Dialog, Steps as AuthorSteps } from "../../../../ui/src/primitives.jsx";
import { ARTICLE_STEPS, articleProgress, statusInfo } from "../../../../ui/src/status.js";

const { useState } = React;

const statusLabel = (status) => statusInfo("toutiao", status).label;
const statusTone = (status) => statusInfo("toutiao", status).tone;

/** 稿件署名：编辑、作者各有文案，其余（含旧稿缺字段）都算写作 Agent。 */
export function draftRoleLabel(role) {
  return t("ttRole_" + (role === "editor" || role === "author" ? role : "writer"));
}

function QaText({ qa, rev }) {
  if (!qa) return <span className="wb-muted">{t("ttQaNone")}</span>;
  const text = qa.pass ? t("ttQaPass", { score: qa.score }) : t("ttQaFail", { score: qa.score });
  return (
    <span>
      <Tag tone={qa.pass ? "success" : "danger"}>{text}</Tag>
      {rev !== undefined && qa.rev !== rev ? (
        <span className="wb-muted"> {t("ttQaOld", { rev: qa.rev })}</span>
      ) : null}
    </span>
  );
}

export function ToutiaoSide({ tt, hideAgent = false }) {
  const { detail, busy, deliverOff, actions } = tt;
  const doneAt = tt.doneAt || {};
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const a = detail.article;
  const send = (action) => actions.deliver(action, note);
  const off = deliverOff;
  return (
    <div className="wb-inspector">
      {a ? (
        <>
          <Section
            title={t("ttFacts")}
            aside={<Tag tone={statusTone(a.status)}>{statusLabel(a.status)}</Tag>}
          >
            <AuthorSteps
              steps={ARTICLE_STEPS}
              current={articleProgress(a)}
              label={t("ttPipeline")}
            />
            {a.qa?.length ? (
              <div className="lamp-qa-score">
                {a.qa[a.qa.length - 1].score}
                <small>{viewCopy.toutiaoAppText2}</small>
              </div>
            ) : null}
            <dl className="wb-facts">
              <div className="wb-fact">
                <dt>{t("ttLine")}</dt>
                <dd>
                  {a.line} · {a.genre}
                </dd>
              </div>
              <div className="wb-fact">
                <dt>{t("ttRounds")}</dt>
                <dd>{t("ttRoundsValue", { n: a.returnRounds, max: a.maxReturnRounds })}</dd>
              </div>
              <div className="wb-fact">
                <dt>{t("ttCard")}</dt>
                <dd>{a.card.present ? a.card.主问题 || "—" : t("ttCardMissing")}</dd>
              </div>
            </dl>
          </Section>
          <Section title={t("ttHeadlines")}>
            <dl className="wb-facts">
              <div className="wb-fact">
                <dt>{t("ttHeadlineMain")}</dt>
                <dd>{a.headlines.main || "—"}</dd>
              </div>
              {a.headlines.alts && a.headlines.alts.length ? (
                <div className="wb-fact">
                  <dt>{t("ttHeadlineAlts")}</dt>
                  <dd>{a.headlines.alts.join("\n")}</dd>
                </div>
              ) : null}
            </dl>
          </Section>
          <Section title={t("ttQa")}>
            <p>
              <QaText qa={a.qa[a.qa.length - 1]} rev={a.rev} />
            </p>
            {a.qa.length && a.qa[a.qa.length - 1].hardGates.length ? (
              <p className="wb-muted">
                {t("ttHardGates", { list: a.qa[a.qa.length - 1].hardGates.join("、") })}
              </p>
            ) : null}
            <p className="wb-muted">{a.qaValid ? t("ttQaValid") : a.qaProblem}</p>
            {a.qa.length > 1 ? (
              <details className="wb-disclosure">
                <summary>{t("ttQaHistory", { n: a.qa.length })}</summary>
                <ol className="wb-plain-list">
                  {a.qa
                    .slice()
                    .reverse()
                    .map((q, i) => (
                      <li key={i}>
                        {t("ttRev", { n: q.rev }) +
                          " · " +
                          t(q.pass ? "ttQaShortPass" : "ttQaShortFail", { score: q.score }) +
                          (q.hardGates.length
                            ? " · " + t("ttHardGates", { list: q.hardGates.join("、") })
                            : "")}
                      </li>
                    ))}
                </ol>
              </details>
            ) : null}
          </Section>
          {(a.drafts || []).length > 1 ? (
            <Section title={t("ttDrafts")}>
              <ol className="wb-plain-list">
                {a.drafts
                  .slice()
                  .reverse()
                  .map((d) => (
                    <li key={d.rev}>
                      {t("ttRev", { n: d.rev }) +
                        " · " +
                        draftRoleLabel(d.role) +
                        " · " +
                        formatCount(d.chars) +
                        viewCopy.toutiaoAppText3 +
                        (d.note ? " · " + d.note : "")}
                    </li>
                  ))}
              </ol>
            </Section>
          ) : null}
          <Section title={t("ttStatus")}>
            {a.status === viewCopy.toutiaoAppText4 ? (
              <p className="wb-muted">{t("ttDelivered")}</p>
            ) : (
              <>
                <ActionButton
                  variant={a.adoptable ? "primary" : "outline"}
                  size="sm"
                  busy={busy === "adopt"}
                  done={doneAt.adopt}
                  disabled={!a.adoptable || !tt.adoptReady || !!busy}
                  title={a.adoptable ? undefined : t("ttAdoptHint")}
                  icon={<Icon name="stamp" size={14} />}
                  onClick={() => setConfirming(a)}
                >
                  {t("ttAdopt")}
                </ActionButton>
                {!a.adoptable ? <p className="wb-muted">{t("ttAdoptHint")}</p> : null}
                {confirming ? (
                  <Dialog
                    open
                    onClose={() => setConfirming(false)}
                    title={t("ttAdoptTitle")}
                    closeLabel={t("close")}
                    description={t("ttAdoptConfirm", {
                      title: viewText("toutiaoAppText5", {
                        value0: confirming.title,
                        value1: confirming.rev,
                      }),
                    })}
                    footer={
                      <div className="wb-scope">
                        <div className="wb-dialog-actions">
                          <Button variant="ghost" onClick={() => setConfirming(false)}>
                            {t("cancel")}
                          </Button>
                          <Button
                            variant="primary"
                            onClick={() => {
                              setConfirming(false);
                              actions.adopt(confirming);
                            }}
                          >
                            {t("ttAdoptGo")}
                          </Button>
                        </div>
                      </div>
                    }
                  />
                ) : null}
              </>
            )}
            {a.history.length ? (
              <details className="wb-disclosure">
                <summary>{t("ttHistory")}</summary>
                <ol className="wb-plain-list">
                  {a.history.map((h, i) => (
                    <li key={i}>
                      {(h.from || "—") +
                        " → " +
                        h.to +
                        " · " +
                        h.by +
                        (h.at ? " · " + formatClock(h.at) : "") +
                        (h.note ? " · " + h.note : "")}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </Section>
        </>
      ) : null}
      {!hideAgent && (
        <Section title={t("ttAgent")} className="wb-writer">
          <label className="wb-field wb-tt-note">
            <span className="wb-muted">{t("ttNote")}</span>
            <textarea
              rows={2}
              maxLength={300}
              value={note}
              placeholder={t("ttNotePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="wb-action-cards">
            {a && a.status !== viewCopy.toutiaoAppText4 ? (
              <>
                <ActionCard
                  icon="sparkles"
                  primary
                  title={t("ttContinue")}
                  hint={t("ttContinueHint")}
                  busy={busy === "continue"}
                  disabled={!!busy || !!off}
                  offReason={off}
                  onClick={() => send("continue")}
                />
                {a.draft ? (
                  <ActionCard
                    icon="eye"
                    title={t("ttReview")}
                    hint={t("ttReviewHint")}
                    busy={busy === "review"}
                    disabled={!!busy || !!off}
                    offReason={off}
                    onClick={() => send("review")}
                  />
                ) : null}
                {a.qa.length && !a.qaValid ? (
                  <ActionCard
                    icon="wand"
                    title={t("ttRevise")}
                    hint={t("ttReviseHint")}
                    busy={busy === "revise"}
                    disabled={!!busy || !!off}
                    offReason={off}
                    onClick={() => send("revise")}
                  />
                ) : null}
              </>
            ) : null}
            <ActionCard
              icon="pen"
              primary={!a || a.status === viewCopy.toutiaoAppText4}
              title={t("ttNew")}
              hint={t("ttNewHint")}
              busy={busy === "new"}
              disabled={!!busy || !!off}
              offReason={off}
              onClick={() => send("new")}
            />
          </div>
          {off ? (
            <p className="wb-muted wb-off-reason">
              <Icon name="info" size={12} /> {off}
            </p>
          ) : null}
        </Section>
      )}
    </div>
  );
}
