/** 写作台 · 今日头条模式：左列文章、中间当前稿 / 交稿单、右侧状态、质检、采用与写作 Agent 按钮。 */
import React from "react";
import { formatClock, formatCount, t } from "../shared/copy.js";
import { useToutiao } from "./useToutiao.js";
import { ActionButton, Button, Icon, Modal, SegmentedControl, Spinner, StateDot, Tag, cx } from "../shared/ui.jsx";
import { ActionCard, Callout, Empty, Notices, Section, Skeleton, Steps, WithCode } from "../shared/common.jsx";
import { Manuscript } from "../shared/Manuscript.jsx";

const { useState } = React;

const STATUS_TONE = { 初稿待改: "warning", 待验收: "info", 已验收: "success", 验收退回: "danger", 已交稿: "neutral" };
const STATUS_DOT = { 初稿待改: "warning", 待验收: "warning", 已验收: "done", 验收退回: "error", 已交稿: "done" };
const PIPELINE = ["立项", "成稿", "待验收", "已验收", "已交稿"];

function pipelineAt(a) {
  if (!a.card.present && !a.draft) return { current: 0 };
  if (a.status === "验收退回") return { current: 1, tone: "danger" };
  const at = { 初稿待改: 1, 待验收: 2, 已验收: 3, 已交稿: 4 }[a.status];
  return { current: at === undefined ? 1 : at, tone: a.status === "初稿待改" ? "warning" : undefined };
}

function QaText({ qa, rev }) {
  if (!qa) return <span className="wb-muted">{t("ttQaNone")}</span>;
  const text = qa.pass ? t("ttQaPass", { score: qa.score }) : t("ttQaFail", { score: qa.score });
  return (
    <span>
      <Tag tone={qa.pass ? "success" : "danger"}>{text}</Tag>
      {rev !== undefined && qa.rev !== rev ? <span className="wb-muted"> {t("ttQaOld", { rev: qa.rev })}</span> : null}
    </span>
  );
}

function matches(a, q) {
  if (!q) return true;
  const k = q.toLowerCase();
  return String(a.title).toLowerCase().includes(k) || String(a.id).toLowerCase().includes(k);
}

function ArticleList({ articles, statuses, sel, onSelect }) {
  const [query, setQuery] = useState("");
  const visible = articles.filter((a) => matches(a, query));
  const groups = (statuses.length ? statuses : [...new Set(articles.map((a) => a.status))])
    .map((status) => ({ status, rows: visible.filter((a) => a.status === status) }))
    .filter((g) => g.rows.length);
  return (
    <div className="wb-chapter-nav">
      {articles.length > 6 ? (
        <div className="wb-chapter-tools">
          <label className="wb-search">
            <Icon name="search" size={14} />
            <span className="wb-visually-hidden">{t("ttFilter")}</span>
            <input type="search" value={query} placeholder={t("ttFilterPlaceholder")} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      ) : null}
      {!groups.length ? <Empty hint={t("ttFilterEmpty")} /> : null}
      {groups.map((g) => (
        <section key={g.status} className="wb-tt-group" aria-label={g.status}>
          <h3 className="wb-tt-group-head">
            <StateDot state={STATUS_DOT[g.status] || "idle"} size={8} /> {g.status} <span className="wb-count">{g.rows.length}</span>
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
                    <StateDot state={STATUS_DOT[a.status] || "idle"} size={8} />
                    <span className="wb-chapter-text">
                      <span className="wb-chapter-title" title={a.title}>{a.title}</span>
                      <span className="wb-chapter-meta">
                        {a.genre}
                        {a.rev ? " · " + t("ttRev", { n: a.rev }) : ""}
                      </span>
                    </span>
                    {a.qa ? <span className="wb-flag wb-tt-score" data-pass={a.qa.pass ? "true" : "false"} title={t(a.qa.pass ? "ttQaShortPass" : "ttQaShortFail", { score: a.qa.score })}>{a.qa.score}</span> : <span />}
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

function Body({ detail }) {
  const [view, setView] = useState("draft");
  if (detail.status === "loading") return <div className="wb-pane-loading" role="status"><Skeleton lines={8} /></div>;
  if (detail.status === "error") return <Callout tone="danger" role="alert">{detail.error}</Callout>;
  const a = detail.article;
  if (!a) return <div className="wb-reader-empty"><Empty icon="news" title={t("ttPick")} hint={t("ttPickHint")} /></div>;
  const shown = view === "delivery" && a.delivery ? "delivery" : "draft";
  return (
    <div className="wb-reader">
      <div className="wb-reader-bar">
        <div className="wb-reader-heading">
          <h2 className="wb-reader-title">{a.title}</h2>
          <p className="wb-reader-meta">
            <Tag tone={STATUS_TONE[a.status] || "neutral"}>{a.status}</Tag>
            {a.draft ? <span>{t("ttRev", { n: a.draft.rev })} · {formatCount(a.draft.chars)} 字 · {t("ttRole_" + (a.draft.role === "editor" ? "editor" : a.draft.role === "author" ? "author" : "writer"))}</span> : null}
          </p>
        </div>
        <div className="wb-reader-tools">
          <SegmentedControl
            id="wb-tt-view"
            label={t("ttDetail")}
            value={shown}
            onChange={setView}
            options={[
              { value: "draft", label: t("ttViewDraft") },
              { value: "delivery", label: t("ttViewDelivery"), disabled: !a.delivery, title: a.delivery ? undefined : t("ttNoDelivery") },
            ]}
          />
        </div>
      </div>
      <div className="wb-reader-body wb-enter" key={a.id + ":" + shown + ":" + (a.draft ? a.draft.rev : 0)} tabIndex={0}>
        {shown === "delivery" ? (
          <pre className="wb-prewrap wb-tt-delivery">{a.delivery}</pre>
        ) : a.draft && a.draft.text ? (
          <>
            {a.draft.truncated ? <Callout tone="warning">{t("truncated", { size: "200 KB" })}</Callout> : null}
            <Manuscript text={a.draft.text} annotationId="wb-tt" />
          </>
        ) : (
          <Empty icon="pen" hint={t("ttNoDraft")} />
        )}
      </div>
    </div>
  );
}

export function ToutiaoSide({ tt }) {
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
          <Section title={t("ttFacts")} aside={<Tag tone={STATUS_TONE[a.status] || "neutral"}>{a.status}</Tag>}>
            <Steps steps={PIPELINE} {...pipelineAt(a)} label={t("ttPipeline")} />
            <dl className="wb-facts">
              <div className="wb-fact"><dt>{t("ttLine")}</dt><dd>{a.line} · {a.genre}</dd></div>
              <div className="wb-fact"><dt>{t("ttRounds")}</dt><dd>{t("ttRoundsValue", { n: a.returnRounds, max: a.maxReturnRounds })}</dd></div>
              <div className="wb-fact">
                <dt>{t("ttCard")}</dt>
                <dd>{a.card.present ? a.card.主问题 || "—" : t("ttCardMissing")}</dd>
              </div>
            </dl>
          </Section>
          <Section title={t("ttHeadlines")}>
            <dl className="wb-facts">
              <div className="wb-fact"><dt>{t("ttHeadlineMain")}</dt><dd>{a.headlines.main || "—"}</dd></div>
              {a.headlines.alts && a.headlines.alts.length ? (
                <div className="wb-fact"><dt>{t("ttHeadlineAlts")}</dt><dd>{a.headlines.alts.join("\n")}</dd></div>
              ) : null}
            </dl>
          </Section>
          <Section title={t("ttQa")}>
            <p><QaText qa={a.qa[a.qa.length - 1]} rev={a.rev} /></p>
            {a.qa.length && a.qa[a.qa.length - 1].hardGates.length ? (
              <p className="wb-muted">{t("ttHardGates", { list: a.qa[a.qa.length - 1].hardGates.join("、") })}</p>
            ) : null}
            <p className="wb-muted">{a.qaValid ? t("ttQaValid") : a.qaProblem}</p>
            {a.qa.length > 1 ? (
              <details className="wb-disclosure">
                <summary>{t("ttQaHistory", { n: a.qa.length })}</summary>
                <ol className="wb-plain-list">
                  {a.qa.slice().reverse().map((q, i) => (
                    <li key={i}>{t("ttRev", { n: q.rev }) + " · " + t(q.pass ? "ttQaShortPass" : "ttQaShortFail", { score: q.score }) + (q.hardGates.length ? " · " + t("ttHardGates", { list: q.hardGates.join("、") }) : "")}</li>
                  ))}
                </ol>
              </details>
            ) : null}
          </Section>
          {(a.drafts || []).length > 1 ? (
            <Section title={t("ttDrafts")}>
              <ol className="wb-plain-list">
                {a.drafts.slice().reverse().map((d) => (
                  <li key={d.rev}>{t("ttRev", { n: d.rev }) + " · " + t("ttRole_" + (d.role === "editor" ? "editor" : d.role === "author" ? "author" : "writer")) + " · " + formatCount(d.chars) + " 字" + (d.note ? " · " + d.note : "")}</li>
                ))}
              </ol>
            </Section>
          ) : null}
          <Section title={t("ttStatus")}>
            {a.status === "已交稿" ? (
              <p className="wb-muted">{t("ttDelivered")}</p>
            ) : (
              <>
                <ActionButton
                  variant={a.adoptable ? "primary" : "outline"}
                  size="sm"
                  busy={busy === "adopt"}
                  done={!!doneAt.adopt}
                  disabled={!a.adoptable || !!busy}
                  title={a.adoptable ? undefined : t("ttAdoptHint")}
                  icon={<Icon name="stamp" size={14} />}
                  onClick={() => setConfirming(true)}
                >
                  {t("ttAdopt")}
                </ActionButton>
                {!a.adoptable ? <p className="wb-muted">{t("ttAdoptHint")}</p> : null}
                {confirming ? (
                  <Modal
                    open
                    onClose={() => setConfirming(false)}
                    title={t("ttAdoptTitle")}
                    closeLabel={t("close")}
                    description={t("ttAdoptConfirm", { title: a.title })}
                    footer={
                      <div className="wb-scope">
                        <div className="wb-dialog-actions">
                          <Button variant="ghost" onClick={() => setConfirming(false)}>{t("cancel")}</Button>
                          <Button variant="primary" onClick={() => { setConfirming(false); actions.adopt(); }}>{t("ttAdoptGo")}</Button>
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
                    <li key={i}>{(h.from || "—") + " → " + h.to + " · " + h.by + (h.at ? " · " + formatClock(h.at) : "") + (h.note ? " · " + h.note : "")}</li>
                  ))}
                </ol>
              </details>
            ) : null}
          </Section>
        </>
      ) : null}
      <Section title={t("ttAgent")} className="wb-writer">
        <label className="wb-field wb-tt-note">
          <span className="wb-muted">{t("ttNote")}</span>
          <textarea rows={2} maxLength={300} value={note} placeholder={t("ttNotePlaceholder")} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="wb-action-cards">
          {a && a.status !== "已交稿" ? (
            <>
              <ActionCard icon="sparkles" primary title={t("ttContinue")} hint={t("ttContinueHint")} busy={busy === "continue"} disabled={!!busy || !!off} offReason={off} onClick={() => send("continue")} />
              {a.draft ? <ActionCard icon="eye" title={t("ttReview")} hint={t("ttReviewHint")} busy={busy === "review"} disabled={!!busy || !!off} offReason={off} onClick={() => send("review")} /> : null}
              {a.qa.length && !a.qaValid ? <ActionCard icon="wand" title={t("ttRevise")} hint={t("ttReviseHint")} busy={busy === "revise"} disabled={!!busy || !!off} offReason={off} onClick={() => send("revise")} /> : null}
            </>
          ) : null}
          <ActionCard icon="pen" primary={!a || a.status === "已交稿"} title={t("ttNew")} hint={t("ttNewHint")} busy={busy === "new"} disabled={!!busy || !!off} offReason={off} onClick={() => send("new")} />
        </div>
        {off ? <p className="wb-muted wb-off-reason"><Icon name="info" size={12} /> {off}</p> : null}
      </Section>
    </div>
  );
}

export function ToutiaoApp({ modeSwitch, version }) {
  const tt = useToutiao();
  const { list, sel, actions } = tt;
  let content;
  if (list.status === "loading") {
    content = <div className="wb-boot" role="status"><span className="wb-visually-hidden">{t("ttLoading")}</span><Skeleton lines={5} /></div>;
  } else if (list.status === "error") {
    content = (
      <div className="wb-onboarding">
        <Empty icon="alert" title={t("errorTitle")} hint={t("errorHint")} />
        <Callout tone="danger" role="alert">{list.error}</Callout>
        <Button variant="outline" onClick={actions.refresh} icon={<Icon name="refresh" size={14} />}>{t("retry")}</Button>
      </div>
    );
  } else {
    content = (
      <div className="wb-view-panel"><div className="wb-workbench" data-genre="toutiao">
        <nav className="wb-column wb-column-nav" aria-label={t("ttArticles")}>
          <h2 className="wb-column-head">{t("ttArticles")}</h2>
          <div className="wb-column-body">
            {list.articles.length ? (
              <ArticleList articles={list.articles} statuses={list.statuses || []} sel={sel} onSelect={actions.select} />
            ) : (
              <div className="wb-onboarding wb-onboarding-compact">
                <Empty icon="inbox" title={t("ttEmpty")} />
                <p className="wb-muted"><WithCode text={t("ttEmptyHint")} code="writer_enable mode=toutiao" /></p>
              </div>
            )}
          </div>
        </nav>
        <section className="wb-column wb-column-reader" aria-label={t("ttDetail")}>
          <Body detail={tt.detail} />
        </section>
        <aside className="wb-column wb-column-inspector" aria-label={t("ttSide")}>
          <h2 className="wb-column-head">{t("ttSide")}</h2>
          <div className="wb-column-body"><ToutiaoSide tt={tt} /></div>
        </aside>
      </div></div>
    );
  }
  return (
    <div className="wb-root" data-mode="toutiao">
      <header className="wb-header">
        <div className="wb-header-main">
          <div className="wb-heading wb-heading-brand">
            <span className="wb-brand" data-mode="toutiao" aria-hidden="true"><Icon name="news" size={18} /></span>
            <div className="wb-heading-text">
              <h1 className="wb-title">{t("ttTitle")}</h1>
              <p className="wb-subtitle">{t("ttSubtitle")}</p>
            </div>
          </div>
          <div className="wb-toolbar">
            {modeSwitch}
            <Button variant="outline" size="sm" disabled={tt.refreshing} onClick={actions.refresh} icon={tt.refreshing ? <Spinner /> : <Icon name="refresh" size={14} />}>{tt.refreshing ? t("refreshing") : t("refresh")}</Button>
          </div>
        </div>
        {list.status === "ready" && list.articles.length ? (
          <div className="wb-stats" aria-label={t("ttArticles")}>
            <Tag tone="neutral">{t("ttStatTotal", { n: list.articles.length })}</Tag>
            {(list.statuses || []).map((st) => {
              const n = list.articles.filter((a) => a.status === st).length;
              return n ? <Tag key={st} tone={STATUS_TONE[st] || "quiet"}>{st + " " + n}</Tag> : null;
            })}
            {list.at ? <span className="wb-updated">{t("updatedAt", { time: formatClock(list.at) })}</span> : null}
          </div>
        ) : null}
      </header>
      {content}
      <Notices notices={tt.notices || []} onDismiss={actions.dismiss} />
      <footer className="wb-footer">{t("footer", { version })}</footer>
    </div>
  );
}
