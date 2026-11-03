import { COPY as viewCopy, t as viewText } from "../../../../ui/src/copy.js";
/** 写作台 · 今日头条模式：左列文章、中间当前稿 / 交稿单、右侧状态、质检、采用与写作 Agent 按钮。 */
import React from "react";
import { formatClock, formatCount, t } from "../../../../ui/src/copy.js";
import { ActionButton, Button, Icon, SegmentedControl, StateDot, Tag, cx } from "../shared/ui.jsx";
import { Dialog } from "../../../../ui/src/primitives.jsx";
import { ActionCard, Callout, Empty, Section, Skeleton } from "../shared/common.jsx";
import { Manuscript } from "../shared/Manuscript.jsx";
import { SourceEditor } from "../shared/SourceEditor.jsx";
import { ARTICLE_STEPS, articleProgress } from "../../../../ui/src/status.js";
import { Steps as AuthorSteps } from "../../../../ui/src/primitives.jsx";
import { statusInfo } from "../../../../ui/src/status.js";

const { useState } = React;

const statusLabel = (status) => statusInfo("toutiao", status).label;
const statusTone = (status) => statusInfo("toutiao", status).tone;
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

function matches(a, q) {
  if (!q) return true;
  const k = q.toLowerCase();
  return String(a.title).toLowerCase().includes(k) || String(a.id).toLowerCase().includes(k);
}

export function ArticleList({ articles, sel, onSelect }) {
  const [query, setQuery] = useState("");
  const visible = articles.filter((a) => matches(a, query));
  const weekOf = (article) => {
    const date = new Date(article.updatedAt || article.createdAt || article.id.slice(0, 10));
    if (Number.isNaN(date.getTime())) return t("olderArticles");
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return (
      [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-") +
      " " +
      t("currentWeek")
    );
  };
  const groups = [...new Set(visible.map(weekOf))]
    .sort((a, b) =>
      a === t("olderArticles") ? 1 : b === t("olderArticles") ? -1 : b.localeCompare(a),
    )
    .map((status) => ({ status, rows: visible.filter((article) => weekOf(article) === status) }));
  return (
    <div className="wb-chapter-nav">
      {articles.length > 6 ? (
        <div className="wb-chapter-tools">
          <label className="wb-search">
            <Icon name="search" size={14} />
            <span className="wb-visually-hidden">{t("ttFilter")}</span>
            <input
              type="search"
              value={query}
              placeholder={t("ttFilterPlaceholder")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      ) : null}
      {!groups.length ? <Empty hint={t("ttFilterEmpty")} /> : null}
      {groups.map((g) => (
        <section key={g.status} className="wb-tt-group" aria-label={g.status}>
          <h3 className="wb-tt-group-head">
            {g.status} <span className="wb-count">{g.rows.length}</span>
          </h3>
          <ul className="wb-chapter-list">
            {g.rows.map((a) => {
              const on = a.root === sel.root && a.id === sel.id;
              return (
                <li key={a.root + "|" + a.id} className="wb-chapter-item">
                  <button
                    type="button"
                    data-wb-row=""
                    className={cx("wb-chapter-row", on && "wb-chapter-row-on")}
                    aria-current={on ? "true" : undefined}
                    onClick={() => onSelect(a.root, a.id)}
                  >
                    <StateDot state={statusInfo("toutiao", a.status).dot} size={8} />
                    <span className="wb-chapter-text">
                      <span className="wb-chapter-title" title={a.title}>
                        {a.title}
                      </span>
                      <span className="wb-chapter-meta">
                        {a.genre}
                        {a.rev ? " · " + t("ttRev", { n: a.rev }) : ""}
                      </span>
                    </span>
                    {a.qa ? (
                      <span
                        className="wb-flag wb-tt-score"
                        data-pass={a.qa.pass ? "true" : "false"}
                        title={t(a.qa.pass ? "ttQaShortPass" : "ttQaShortFail", {
                          score: a.qa.score,
                        })}
                      >
                        {a.qa.score}
                      </span>
                    ) : (
                      <span />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Body({ detail, onSave, readOnly = false, onEditState }) {
  const [view, setView] = useState("draft");
  const [editing, setEditing] = useState(null);
  if (!editing && detail.status === "loading")
    return (
      <div className="wb-pane-loading" role="status">
        <Skeleton lines={8} />
      </div>
    );
  if (!editing && detail.status === "error")
    return (
      <Callout tone="danger" role="alert">
        {detail.error}
      </Callout>
    );
  const a = editing?.article || detail.article;
  if (!a)
    return (
      <div className="wb-reader-empty">
        <Empty icon="news" title={t("ttPick")} hint={t("ttPickHint")} />
      </div>
    );
  const shown = view === "delivery" && a.delivery ? "delivery" : "draft";
  return (
    <div className="wb-reader">
      <div className="wb-reader-bar">
        <div className="wb-reader-heading">
          <h2 className="wb-reader-title">{a.title}</h2>
          <p className="wb-reader-meta">
            <Tag tone={statusTone(a.status)}>{statusLabel(a.status)}</Tag>
            {a.draft ? (
              <span>
                {t("ttRev", { n: a.draft.rev })} · {formatCount(a.draft.chars)}
                {viewCopy.toutiaoAppText1}
                {t(
                  "ttRole_" +
                    (a.draft.role === "editor"
                      ? "editor"
                      : a.draft.role === "author"
                        ? "author"
                        : "writer"),
                )}
              </span>
            ) : null}
          </p>
        </div>
        <div className="wb-reader-tools">
          {!editing ? (
            <SegmentedControl
              id="wb-tt-view"
              label={t("ttDetail")}
              value={shown}
              onChange={setView}
              options={[
                { value: "draft", label: t("ttViewDraft") },
                {
                  value: "delivery",
                  label: t("ttViewDelivery"),
                  disabled: !a.delivery,
                  title: a.delivery ? undefined : t("ttNoDelivery"),
                },
              ]}
            />
          ) : null}
          {!editing &&
          shown === "draft" &&
          a.draft?.text &&
          !a.draft.truncated &&
          onSave &&
          !readOnly ? (
            <Button variant="outline" size="sm" onClick={() => setEditing({ article: a })}>
              {t("editorToggle")}
            </Button>
          ) : null}
        </div>
      </div>
      {a.problem ? (
        <Callout tone="danger" role="alert">
          {a.problem}
        </Callout>
      ) : null}
      <div
        className="wb-reader-body wb-enter"
        key={a.id + ":" + shown + ":" + (a.draft ? a.draft.rev : 0)}
        tabIndex={0}
      >
        {editing && shown === "draft" && a.draft ? (
          <SourceEditor
            initial={a.draft.text}
            title={t("editorTitle")}
            note={t("ttEditorNote")}
            onSave={async (text) => {
              await onSave(text, {
                root: a.root,
                id: a.id,
                expectedRev: a.draft.rev,
                expectedSha256: a.draft.sha256,
              });
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
            onStateChange={onEditState}
          />
        ) : shown === "delivery" ? (
          <pre className="wb-prewrap wb-tt-delivery">{a.delivery}</pre>
        ) : a.draft && a.draft.text ? (
          <>
            {a.draft.truncated ? (
              <Callout tone="warning">{t("truncated", { size: "200 KB" })}</Callout>
            ) : null}
            <Manuscript text={a.draft.text} annotationId="wb-tt" />
          </>
        ) : (
          <Empty icon="pen" hint={t("ttNoDraft")} />
        )}
      </div>
    </div>
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
                        t(
                          "ttRole_" +
                            (d.role === "editor"
                              ? "editor"
                              : d.role === "author"
                                ? "author"
                                : "writer"),
                        ) +
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
                  done={!!doneAt.adopt}
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
