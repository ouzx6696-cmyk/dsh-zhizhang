/** Title row: work identity, project/work pickers, view switch and refresh. */
import React from "react";
import { formatClock, formatCount, t } from "../shared/copy.js";
import { Button, Icon, SegmentedControl, Spinner, Tag } from "../shared/ui.jsx";
import { clip } from "../shared/common.jsx";

function projectLabel(p) {
  const suffix = p.exists === false ? t("projectUnreachable") : p.error ? t("projectUnreadable") : p.recoveryPending ? t("projectRecovery") : "";
  return (p.name || p.base) + suffix;
}

export function Header({ state, view, actions, modeSwitch }) {
  const { dispatch } = actions;
  const snap = view.snap;
  const totals = (snap && snap.totals) || {};
  const impacts = (snap && snap.revisionImpacts) || [];
  const title = snap ? snap.title || snap.workKey || t("appTitle") : t("appTitle");
  return (
    <header className="wb-header">
      <div className="wb-header-main">
        <div className="wb-heading wb-heading-brand">
          <span className="wb-brand" data-mode="fanqie" aria-hidden="true"><Icon name="book" size={18} /></span>
          <div className="wb-heading-text">
            <h1 className="wb-title">{title}</h1>
            <p className="wb-subtitle">
              {snap ? [snap.genre, snap.workKey].filter(Boolean).join(" · ") : t("appSubtitleNoWork")}
              {state.base ? <span className="wb-subtle-path" title={state.base}>{t("rootLabel", { root: clip(state.base, 42) })}</span> : null}
            </p>
          </div>
        </div>
        <div className="wb-toolbar">
          {modeSwitch}
          {state.projects.length > 1 ? (
            <label className="wb-field">
              <span className="wb-visually-hidden">{t("project")}</span>
              <select
                className="wb-select"
                title={t("project")}
                value={state.projectId}
                onChange={(e) => dispatch({ type: "selectProject", id: e.target.value })}
              >
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id} title={p.base}>
                    {projectLabel(p)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {state.works.length > 0 ? (
            <label className="wb-field">
              <span className="wb-visually-hidden">{t("work")}</span>
              <select className="wb-select" title={t("work")} value={state.work} onChange={(e) => dispatch({ type: "selectWork", work: e.target.value })}>
                {state.works.map((w) => (
                  <option key={w.key} value={w.key}>
                    {(w.title || w.key) + (w.recoveryPending ? t("workRecovery") : "")}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <SegmentedControl
            id="wb-view"
            label={t("viewMode")}
            value={state.view}
            options={[
              { value: "chapters", label: t("viewChapters") },
              { value: "overview", label: t("viewOverview") },
            ]}
            onChange={(v) => dispatch({ type: "view", view: v })}
            className="wb-view-switch"
          />
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={state.polling}
            title={state.polling ? t("autoRefreshOn") : t("autoRefreshOff")}
            aria-label={t("autoRefresh")}
            onClick={() => dispatch({ type: "polling", on: !state.polling })}
            icon={<Icon name={state.polling ? "pause" : "play"} size={14} />}
          />
          <Button variant="outline" size="sm" disabled={state.loading} onClick={actions.refresh} icon={state.loading ? <Spinner /> : <Icon name="refresh" size={14} />}>
            {state.loading ? t("refreshing") : t("refresh")}
          </Button>
        </div>
      </div>
      {snap ? (
        <div className="wb-stats" aria-label={t("chapters")}>
          <Tag tone="neutral">{t("statChapters", { n: formatCount(totals.chapters || 0) })}</Tag>
          <Tag tone="neutral">{t("statWords", { n: formatCount(totals.words || 0) })}</Tag>
          <Tag tone={totals.final ? "success" : "quiet"}>{t("statFinal", { n: totals.final || 0 })}</Tag>
          <Tag tone="quiet">{t("statDrafted", { n: totals.drafted || 0 })}</Tag>
          <Tag tone={view.pending.length ? "warning" : "quiet"}>{t("statPending", { n: view.pending.length })}</Tag>
          {impacts.length ? <Tag tone="danger">{t("statImpacts", { n: impacts.length })}</Tag> : null}
          {state.lastRefresh ? <span className="wb-updated">{t("updatedAt", { time: formatClock(state.lastRefresh) })}</span> : null}
        </div>
      ) : null}
    </header>
  );
}
