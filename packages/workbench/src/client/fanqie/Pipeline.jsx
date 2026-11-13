import { COPY as viewCopy, chapterName, formatCount, t } from "@writer/ui/copy";
import { statusLabel as canonicalStatusLabel } from "@writer/ui/status";
const statusLabel = (status) => canonicalStatusLabel("fanqie", status);
import { Dashboard } from "./Dashboard.jsx";
/** Whole-book overview: product loop, reference library, planning, writing, ledger. */
import React from "react";
import { Button, SegmentedControl, Tag } from "../shared/ui.js";
import { Callout, Empty, Foundation, Section, StatusDot, clip } from "../shared/common.jsx";

function Library({ library }) {
  if (!library) return <Empty hint={t("libraryNone")} />;
  if (library.unavailable)
    return (
      <Callout tone="danger" role="alert">
        {library.summary || t("libraryUnavailable")}
      </Callout>
    );
  return (
    <>
      <div className="wb-stats">
        <Tag tone="neutral">{t("librarySources", { n: library.sourcesCount || 0 })}</Tag>
        <Tag tone="success">{t("libraryAccepted", { n: library.acceptedCount || 0 })}</Tag>
        <Tag tone="quiet">{t("libraryDrafted", { n: library.draftedCount || 0 })}</Tag>
        <Tag tone="info">
          {viewCopy.pipelineText1}
          {library.craftCount || 0}
        </Tag>
        <Tag tone="info">
          {viewCopy.pipelineText2}
          {library.mindCount || 0}
        </Tag>
      </div>
      {library.summary ? <p className="wb-muted">{clip(library.summary, 240)}</p> : null}
      {(library.analyses || []).length ? (
        <Section title={t("libraryProgress")}>
          <ul className="wb-rows">
            {library.analyses.map((a) => (
              <li key={a.sourceId} className="wb-row">
                <span className="wb-row-title">
                  {library.sources?.find((source) => source.id === a.sourceId)?.title ||
                    viewCopy.pipelineText3}
                </span>
                <span className="wb-row-meta">
                  {[
                    a.stage,
                    a.facts + "/" + a.totalChapters,
                    a.plots ? viewCopy.pipelineText4 + a.plots : "",
                    a.plan ? a.plan.label + " " + a.plan.done + "/" + a.plan.total : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {library.sourceRoot ? (
        <p className="wb-muted">
          {t("librarySourceRoot")} <code className="wb-code">{library.sourceRoot}</code> ·{" "}
          {t("libraryPending", { n: library.pendingCount || 0 })}
          {library.pending && library.pending.length
            ? "（" + library.pending.map((b) => b.name).join("、") + "）"
            : ""}
        </p>
      ) : null}
      {(library.sources || []).length === 0 ? (
        <Empty hint={t("libraryEmpty")} />
      ) : (
        <ul className="wb-card-grid">
          {library.sources.map((s) => (
            <li key={s.id} className="wb-card">
              <span className="wb-card-title">{s.title || viewCopy.pipelineText5}</span>
              <span className="wb-card-text">{s.author || viewCopy.pipelineText6}</span>
            </li>
          ))}
        </ul>
      )}
      {library.combo ? (
        <p className="wb-muted">
          {t("libraryCombo")}：
          {library.combo.ok
            ? viewCopy.pipelineText7 +
              (library.combo.mindTitle || "—") +
              "」+ " +
              ((library.combo.craftTitles || []).join("、") || "—")
            : library.combo.emptyReason || "—"}
        </p>
      ) : null}
    </>
  );
}

function PlanCard({ title, meta = null, content, truncated }) {
  return (
    <li className="wb-card">
      <span className="wb-card-title">{title}</span>
      {meta ? <span className="wb-card-kicker">{meta}</span> : null}
      <span className="wb-card-text wb-prewrap">{content}</span>
      {truncated ? <span className="wb-muted">{t("planningTruncated")}</span> : null}
    </li>
  );
}

function Inspiration({ insp }) {
  if (!insp) return <Empty hint={t("inspirationNone")} />;
  if (insp.unavailable)
    return <Callout tone="warning">{insp.summary || t("inspirationUnavailable")}</Callout>;
  const plan = insp.planning;
  const progress = insp.outlineProgress || {};
  const list = (items) => (items || []).join("、") || t("planningUnset");
  return (
    <>
      <div className="wb-stats">
        <Tag tone="neutral">{t("inspirationSessions", { n: insp.sessionsCount || 0 })}</Tag>
        <Tag tone={insp.pendingEmits ? "warning" : "quiet"}>
          {t("inspirationPending", { n: insp.pendingEmits || 0 })}
        </Tag>
        <Tag tone={insp.appliedToWork ? "success" : "quiet"}>
          {insp.appliedToWork ? t("inspirationApplied") : t("inspirationNotApplied")}
        </Tag>
        <Tag tone={insp.foundationFilled ? "success" : "quiet"}>
          {t("inspirationFields", { n: (insp.foundationFilledFields || []).length })}
        </Tag>
      </div>
      <p className="wb-muted">
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
          <ul className="wb-card-stack">
            {plan.book ? (
              <PlanCard
                title={t("planningBook")}
                content={plan.book.content}
                truncated={plan.book.truncated}
              />
            ) : (
              <li className="wb-muted">{t("planningNoBook")}</li>
            )}
            {(plan.volumes || []).map((v) => (
              <PlanCard
                key={"v-" + v.id}
                title={v.title}
                meta={t("planningChapters", { list: list(v.chapters) })}
                content={v.content}
                truncated={v.truncated}
              />
            ))}
            {(plan.acts || []).map((a) => (
              <PlanCard
                key={"a-" + a.id}
                title={a.title}
                meta={
                  t("planningVolume", { id: a.volumeId || t("planningUnset") }) +
                  " · " +
                  t("planningChapters", { list: list(a.chapters) })
                }
                content={a.content}
                truncated={a.truncated}
              />
            ))}
          </ul>
          {plan.totalVolumes > (plan.volumes || []).length ? (
            <p className="wb-muted">{t("planningMoreVolumes")}</p>
          ) : null}
          {plan.totalActs > (plan.acts || []).length ? (
            <p className="wb-muted">{t("planningMoreActs")}</p>
          ) : null}
        </Section>
      ) : null}
      <Section title={t("inspirationSessions", { n: insp.sessionsCount || 0 })}>
        {(insp.sessions || []).length === 0 ? (
          <Empty hint={t("sessionsEmpty")} />
        ) : (
          <ul className="wb-rows">
            {insp.sessions.map((s) => (
              <li key={s.id} className="wb-row">
                <span className="wb-row-title">{clip(s.goal, 60)}</span>
                <span className="wb-row-meta">
                  {[
                    s.id,
                    t("sessionCards", { n: s.cardCount || 0 }),
                    s.forgeAt ? t("sessionForged") : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
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
          <ul className="wb-rows">
            {chapters.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="wb-row wb-row-button"
                  onClick={() => onOpenChapter(c.id)}
                >
                  <StatusDot status={c.status} />
                  <span className="wb-row-title">{c.title || viewCopy.chapterListText1}</span>
                  <span className="wb-row-meta">
                    {statusLabel(c.status)}
                    {c.situationLens ? " · " + clip(c.situationLens, 48) : ""}
                  </span>
                  <span className="wb-row-end">
                    {t("words", { n: formatCount(c.wordCount || 0) })}
                  </span>
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
          <ul className="wb-rows">
            {pending.map((c, index) => (
              <li key={c.id} className="wb-row">
                <span className="wb-row-title">
                  {c.draftLabel
                    ? "「" + c.draftLabel + "」"
                    : viewCopy.inspectorText1 + (index + 1)}
                </span>
                <span className="wb-row-meta">
                  {viewCopy.pipelineText8 + t("words", { n: formatCount(c.wordCount || 0) })}
                  {c.hasLintPass ? viewCopy.inspectorText2 : ""}
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
        <p className="wb-muted">{t("writingEditNote")}</p>
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
          <ul className="wb-rows">
            {review.map((e, i) => (
              <li key={e.id || e.at + i} className="wb-row">
                <span className="wb-row-title">
                  {chapterName(snap.chapters || [], e.chapterId)}
                </span>
                <span className="wb-row-meta">{clip(e.summary, 90)}</span>
                <span className="wb-row-end">{e.at}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t("ledgerBrief")}>
        {briefs.length === 0 ? (
          <Empty hint={t("ledgerEmpty")} />
        ) : (
          <ul className="wb-rows">
            {briefs.map((e, i) => (
              <li key={(e.chapterId || "") + e.at + i} className="wb-row">
                <span className="wb-row-title">
                  {chapterName(snap.chapters || [], e.chapterId)}
                </span>
                <span className="wb-row-meta">{viewCopy.pipelineText9}</span>
                <span className="wb-row-end">{e.at}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <details className="wb-disclosure">
        <summary>{t("ledgerPayoff")}</summary>
        {payoff.length === 0 ? (
          <p className="wb-muted">{t("ledgerPayoffEmpty")}</p>
        ) : (
          <ul className="wb-rows">
            {payoff.map((e) => (
              <li key={e.chapterId} className="wb-row">
                <span className="wb-row-title">
                  {chapterName(snap.chapters || [], e.chapterId)}
                </span>
                <span className="wb-row-meta">
                  {(e.ok ? viewCopy.reviewPass : viewCopy.pipelineText10 + e.warningCount) +
                    " · " +
                    clip(e.summary, 80)}
                </span>
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
  if (!snap) return <Empty hint={state.error || viewCopy.pipelineText11} />;
  const tabs = [
    { value: "overview", label: t("tabOverview") },
    { value: "library", label: t("tabLibrary") },
    { value: "inspiration", label: t("tabInspiration") },
    { value: "writing", label: t("tabWriting") },
    { value: "ledger", label: t("tabLedger") },
  ];
  // 作者在“放弃未保存修改？”里选了取消时，选章被拒，也不能再切到章节视图。
  const openChapter = async (id) => {
    if (await dispatch({ type: "selectChapter", id }))
      void dispatch({ type: "view", view: "chapters" });
  };
  let body;
  if (state.tab === "library") body = <Library library={snap.library} />;
  else if (state.tab === "inspiration") body = <Inspiration insp={snap.inspiration} />;
  else if (state.tab === "writing")
    body = (
      <Writing
        snap={snap}
        pending={view.pending}
        onAccept={(cand) => dispatch({ type: "openDialog", dialog: { kind: "accept", cand } })}
        onOpenChapter={openChapter}
      />
    );
  else if (state.tab === "ledger") body = <Ledger snap={snap} />;
  else body = <Dashboard snap={{ ...snap, totals: snap.totals || {} }} onOpen={openChapter} />;
  return (
    <div className="wb-pipeline">
      <SegmentedControl
        id="wb-tab"
        label={t("pipelineTabs")}
        value={state.tab}
        options={tabs}
        onChange={(tab) => dispatch({ type: "tab", tab })}
        className="wb-tabs"
      />
      <div
        className="wb-pipeline-body"
        id={"wb-tab-" + state.tab + "-panel"}
        role="tabpanel"
        aria-labelledby={"wb-tab-" + state.tab}
      >
        {body}
      </div>
    </div>
  );
}
