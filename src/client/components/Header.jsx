/** Title row: work identity, project/work pickers, view switch and refresh. */
import React from "react";
import { formatClock, formatCount, t } from "../copy.js";
import { Button, Icon, SegmentedControl, Tag } from "../ui.jsx";
import { clip } from "./common.jsx";

function projectLabel(p) {
  const suffix = p.exists === false ? t("projectUnreachable") : p.error ? t("projectUnreadable") : p.recoveryPending ? t("projectRecovery") : "";
  return (p.name || p.base) + suffix;
}

export function Header({ state, view, actions }) {
  const { dispatch } = actions;
  const snap = view.snap;
  const totals = (snap && snap.totals) || {};
  const impacts = (snap && snap.revisionImpacts) || [];
  const title = snap ? snap.title || snap.workKey || t("appTitle") : t("appTitle");
  return (
    <header className="zz-header">
      <div className="zz-header-main">
        <div className="zz-heading">
          <h1 className="zz-title">{title}</h1>
          <p className="zz-subtitle">
            {snap ? [snap.genre, snap.workKey].filter(Boolean).join(" · ") : t("appSubtitleNoWork")}
            {state.base ? <span className="zz-subtle-path" title={state.base}>{t("rootLabel", { root: clip(state.base, 42) })}</span> : null}
          </p>
        </div>
        <div className="zz-toolbar">
          {state.projects.length > 1 ? (
            <label className="zz-field">
              <span className="zz-visually-hidden">{t("project")}</span>
              <select
                className="zz-select"
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
            <label className="zz-field">
              <span className="zz-visually-hidden">{t("work")}</span>
              <select className="zz-select" title={t("work")} value={state.work} onChange={(e) => dispatch({ type: "selectWork", work: e.target.value })}>
                {state.works.map((w) => (
                  <option key={w.key} value={w.key}>
                    {(w.title || w.key) + (w.recoveryPending ? t("workRecovery") : "")}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <SegmentedControl
            id="zz-mode"
            label={t("viewMode")}
            value={state.mode}
            options={[
              { value: "novel", label: t("modeNovel") },
              { value: "pipeline", label: t("modePipeline") },
            ]}
            onChange={(mode) => dispatch({ type: "mode", mode })}
            className="zz-mode-switch"
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
          <Button variant="outline" size="sm" disabled={state.loading} onClick={actions.refresh} icon={<Icon name="refresh" size={14} />}>
            {state.loading ? t("refreshing") : t("refresh")}
          </Button>
        </div>
      </div>
      {snap ? (
        <div className="zz-stats" aria-label={t("chapters")}>
          <Tag tone="neutral">{t("statChapters", { n: formatCount(totals.chapters || 0) })}</Tag>
          <Tag tone="neutral">{t("statWords", { n: formatCount(totals.words || 0) })}</Tag>
          <Tag tone={totals.final ? "success" : "quiet"}>{t("statFinal", { n: totals.final || 0 })}</Tag>
          <Tag tone="quiet">{t("statDrafted", { n: totals.drafted || 0 })}</Tag>
          <Tag tone={view.pending.length ? "warning" : "quiet"}>{t("statPending", { n: view.pending.length })}</Tag>
          {impacts.length ? <Tag tone="danger">{t("statImpacts", { n: impacts.length })}</Tag> : null}
          {state.lastRefresh ? <span className="zz-updated">{t("updatedAt", { time: formatClock(state.lastRefresh) })}</span> : null}
        </div>
      ) : null}
    </header>
  );
}
