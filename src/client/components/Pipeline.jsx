/** Whole-book overview: product loop, reference library, planning, writing, ledger. */
import React from "react";
import { formatCount, t } from "../copy.js";
import { Button, SegmentedControl, Tag } from "../ui.jsx";
import { Callout, Empty, Foundation, Hints, Section, StatusDot, clip, statusLabel } from "./common.jsx";

function Overview({ snap }) {
  const product = snap.product;
  return (
    <>
      {product ? (
        <Section>
          <p className="zz-lead">{product.loopLine}</p>
          {product.writeLine ? <p className="zz-muted">{t("defaultLoop", { line: product.writeLine })}</p> : null}
          {(product.pillars || []).length ? (
            <ul className="zz-card-grid">
              {product.pillars.map((p) => (
                <li key={p.id} className="zz-card">
                  <span className="zz-card-kicker">{p.loopStage}</span>
                  <span className="zz-card-title">{p.title}</span>
                  <span className="zz-card-text">{clip(p.summary, 110)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}
      <Section title={t("nextSteps")}>
        <Hints hints={snap.nextHints || []} initial={6} />
      </Section>
    </>
  );
}

function Library({ library }) {
  if (!library) return <Empty hint={t("libraryNone")} />;
  if (library.unavailable) return <Callout tone="danger" role="alert">{library.summary || t("libraryUnavailable")}</Callout>;
  return (
    <>
      <div className="zz-stats">
        <Tag tone="neutral">{t("librarySources", { n: library.sourcesCount || 0 })}</Tag>
        <Tag tone="success">{t("libraryAccepted", { n: library.acceptedCount || 0 })}</Tag>
        <Tag tone="quiet">{t("libraryDrafted", { n: library.draftedCount || 0 })}</Tag>
        <Tag tone="info">craft {library.craftCount || 0}</Tag>
        <Tag tone="info">mind {library.mindCount || 0}</Tag>
      </div>
      {library.summary ? <p className="zz-muted">{clip(library.summary, 240)}</p> : null}
      {(library.analyses || []).length ? (
        <Section title={t("libraryProgress")}>
          <ul className="zz-rows">
            {library.analyses.map((a) => (
              <li key={a.sourceId} className="zz-row">
                <span className="zz-row-title">{a.sourceId}</span>
                <span className="zz-row-meta">
                  {[a.stage, a.facts + "/" + a.totalChapters, a.plots ? "plots " + a.plots : "", a.plan ? a.plan.label + " " + a.plan.done + "/" + a.plan.total : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {library.sourceRoot ? (
        <p className="zz-muted">
          {t("librarySourceRoot")} <code className="zz-code">{library.sourceRoot}</code> · {t("libraryPending", { n: library.pendingCount || 0 })}
          {library.pending && library.pending.length ? "（" + library.pending.map((b) => b.name).join("、") + "）" : ""}
        </p>
      ) : null}
      {(library.sources || []).length === 0 ? (
        <Empty hint={t("libraryEmpty")} />
      ) : (
        <ul className="zz-card-grid">
          {library.sources.map((s) => (
            <li key={s.id} className="zz-card">
              <span className="zz-card-title">{s.title || s.id}</span>
              <span className="zz-card-text">{(s.author ? s.author + " · " : "") + s.id}</span>
            </li>
          ))}
        </ul>
      )}
      {library.combo ? (
        <p className="zz-muted">
          {t("libraryCombo")}：
          {library.combo.ok
            ? "mind「" + (library.combo.mindTitle || "—") + "」+ " + ((library.combo.craftTitles || []).join("、") || "—")
            : library.combo.emptyReason || "—"}
        </p>
      ) : null}
    </>
  );
}

function PlanCard({ title, meta, content, truncated }) {
  return (
    <li className="zz-card">
      <span className="zz-card-title">{title}</span>
      {meta ? <span className="zz-card-kicker">{meta}</span> : null}
      <span className="zz-card-text zz-prewrap">{content}</span>
      {truncated ? <span className="zz-muted">{t("planningTruncated")}</span> : null}
    </li>
  );
}

function Inspiration({ insp }) {
  if (!insp) return <Empty hint={t("inspirationNone")} />;
  if (insp.unavailable) return <Callout tone="warning">{insp.summary || t("inspirationUnavailable")}</Callout>;
  const plan = insp.planning;
  const progress = insp.outlineProgress || {};
  const list = (items) => ((items || []).join("、") || t("planningUnset"));
  return (
    <>
      <div className="zz-stats">
        <Tag tone="neutral">{t("inspirationSessions", { n: insp.sessionsCount || 0 })}</Tag>
        <Tag tone={insp.pendingEmits ? "warning" : "quiet"}>{t("inspirationPending", { n: insp.pendingEmits || 0 })}</Tag>
        <Tag tone={insp.appliedToWork ? "success" : "quiet"}>{insp.appliedToWork ? t("inspirationApplied") : t("inspirationNotApplied")}</Tag>
        <Tag tone={insp.foundationFilled ? "success" : "quiet"}>{t("inspirationFields", { n: (insp.foundationFilledFields || []).length })}</Tag>
      </div>
      <p className="zz-muted">
        {t("outlineProgress", {
          situation: progress.withSituation || 0,
          total: progress.total || 0,
          lived: progress.withLived || 0,
          state: progress.withState || 0,
          complete: progress.complete || 0,
        })}
      </p>
      {plan ? (
        <Section title={t("planning")}>
          <ul className="zz-card-stack">
            {plan.book ? <PlanCard title={t("planningBook")} content={plan.book.content} truncated={plan.book.truncated} /> : <li className="zz-muted">{t("planningNoBook")}</li>}
            {(plan.volumes || []).map((v) => (
              <PlanCard key={"v-" + v.id} title={v.title} meta={t("planningChapters", { list: list(v.chapters) })} content={v.content} truncated={v.truncated} />
            ))}
            {(plan.acts || []).map((a) => (
              <PlanCard
                key={"a-" + a.id}
                title={a.title}
                meta={t("planningVolume", { id: a.volumeId || t("planningUnset") }) + " · " + t("planningChapters", { list: list(a.chapters) })}
                content={a.content}
                truncated={a.truncated}
              />
            ))}
          </ul>
          {plan.totalVolumes > (plan.volumes || []).length ? <p className="zz-muted">{t("planningMoreVolumes")}</p> : null}
          {plan.totalActs > (plan.acts || []).length ? <p className="zz-muted">{t("planningMoreActs")}</p> : null}
        </Section>
      ) : null}
      <Section title={t("inspirationSessions", { n: insp.sessionsCount || 0 })}>
        {(insp.sessions || []).length === 0 ? (
          <Empty hint={t("sessionsEmpty")} />
        ) : (
          <ul className="zz-rows">
            {insp.sessions.map((s) => (
              <li key={s.id} className="zz-row">
                <span className="zz-row-title">{clip(s.goal, 60)}</span>
                <span className="zz-row-meta">{[s.id, t("sessionCards", { n: s.cardCount || 0 }), s.forgeAt ? t("sessionForged") : ""].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function Writing({ snap, pending, onAccept, onOpenChapter }) {
  const chapters = snap.chapters || [];
  return (
    <>
      <Section title={t("foundation")}>
        <Foundation foundation={snap.foundation} limit={300} />
      </Section>
      <Section title={t("writingChapters")}>
        {chapters.length === 0 ? (
          <Empty hint={t("chaptersEmpty")} />
        ) : (
          <ul className="zz-rows">
            {chapters.map((c) => (
              <li key={c.id}>
                <button type="button" className="zz-row zz-row-button" onClick={() => onOpenChapter(c.id)}>
                  <StatusDot status={c.status} />
                  <span className="zz-row-title">{c.title || c.id}</span>
                  <span className="zz-row-meta">
                    {statusLabel(c.status)}
                    {c.situationLens ? " · " + clip(c.situationLens, 48) : ""}
                  </span>
                  <span className="zz-row-end">{t("words", { n: formatCount(c.wordCount || 0) })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t("writingPending")}>
        {pending.length === 0 ? (
          <Empty hint={t("writingNoPending")} />
        ) : (
          <ul className="zz-rows">
            {pending.map((c) => (
              <li key={c.id} className="zz-row">
                <span className="zz-row-title">{c.draftLabel ? "「" + c.draftLabel + "」 " + c.id : c.id}</span>
                <span className="zz-row-meta">
                  {"→ " + c.chapterId + " · " + t("words", { n: formatCount(c.wordCount || 0) })}
                  {c.hasLintPass ? " · lint ✓" : ""}
                  {c.editOf ? " · " + t("candidateEdit") : ""}
                  {c.unifyOf && c.unifyOf.length ? " · " + t("unify") : ""}
                </span>
                <Button variant="outline" size="sm" onClick={() => onAccept(c)}>
                  {t("accept")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="zz-muted">{t("writingEditNote")}</p>
      </Section>
    </>
  );
}

function Ledger({ snap }) {
  const review = (snap.ledgerRecent || []).slice(-10).reverse();
  const briefs = (snap.briefCrumbsRecent || []).slice(-10).reverse();
  const payoff = Object.values(snap.lastPayoffByChapter || {});
  return (
    <>
      <Section title={t("ledgerReview")}>
        {review.length === 0 ? (
          <Empty hint={t("ledgerEmpty")} />
        ) : (
          <ul className="zz-rows">
            {review.map((e, i) => (
              <li key={e.id || e.at + i} className="zz-row">
                <span className="zz-row-title">{e.kind + " · " + e.chapterId}</span>
                <span className="zz-row-meta">{clip(e.summary, 90)}</span>
                <span className="zz-row-end">{e.at}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t("ledgerBrief")}>
        {briefs.length === 0 ? (
          <Empty hint={t("ledgerEmpty")} />
        ) : (
          <ul className="zz-rows">
            {briefs.map((e, i) => (
              <li key={(e.chapterId || "") + e.at + i} className="zz-row">
                <span className="zz-row-title">{e.chapterId}</span>
                <span className="zz-row-meta">{(e.assetIds || []).join(", ") || "—"}</span>
                <span className="zz-row-end">{e.at}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <details className="zz-disclosure">
        <summary>{t("ledgerPayoff")}</summary>
        {payoff.length === 0 ? (
          <p className="zz-muted">{t("ledgerPayoffEmpty")}</p>
        ) : (
          <ul className="zz-rows">
            {payoff.map((e) => (
              <li key={e.chapterId} className="zz-row">
                <span className="zz-row-title">{e.chapterId}</span>
                <span className="zz-row-meta">{(e.ok ? "ok" : "warn " + e.warningCount) + " · " + clip(e.summary, 80)}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </>
  );
}

export function Pipeline({ state, view, actions }) {
  const { dispatch } = actions;
  const snap = view.snap;
  const tabs = [
    { value: "overview", label: t("tabOverview") },
    { value: "library", label: t("tabLibrary") },
    { value: "inspiration", label: t("tabInspiration") },
    { value: "writing", label: t("tabWriting") },
    { value: "ledger", label: t("tabLedger") },
  ];
  let body;
  if (state.tab === "library") body = <Library library={snap.library} />;
  else if (state.tab === "inspiration") body = <Inspiration insp={snap.inspiration} />;
  else if (state.tab === "writing")
    body = (
      <Writing
        snap={snap}
        pending={view.pending}
        onAccept={(cand) => dispatch({ type: "openDialog", dialog: { kind: "accept", cand } })}
        onOpenChapter={(id) => {
          dispatch({ type: "selectChapter", id });
          dispatch({ type: "mode", mode: "novel" });
        }}
      />
    );
  else if (state.tab === "ledger") body = <Ledger snap={snap} />;
  else body = <Overview snap={snap} />;
  return (
    <div className="zz-pipeline">
      <SegmentedControl id="zz-tab" label={t("pipelineTabs")} value={state.tab} options={tabs} onChange={(tab) => dispatch({ type: "tab", tab })} className="zz-tabs" />
      <div className="zz-pipeline-body" id={"zz-tab-" + state.tab + "-panel"} role="tabpanel" aria-labelledby={"zz-tab-" + state.tab}>
        {body}
      </div>
    </div>
  );
}

