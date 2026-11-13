import { COPY as viewCopy, t as viewText } from "@writer/ui/copy";
import React from "react";
import { Stat, Card, Button } from "@writer/ui/primitives";
import { chapterName, formatDateTime } from "@writer/ui/copy";
import { Tag } from "../shared/ui.js";

const FORESHADOW_STATUS_LABEL = {
  planned: viewCopy.foreshadowStatusPlanned,
  written: viewCopy.foreshadowStatusWritten,
  committed: viewCopy.foreshadowStatusCommitted,
  missed: viewCopy.foreshadowStatusMissed,
};

/** 伏笔看板：未兑现线按计划回收章排序；missed 标红，计划章已过的标警。 */
function ForeshadowBoard({ view, chapters }) {
  const lastWritten = Math.max(
    0,
    ...chapters.filter((chapter) => chapter.wordCount > 0).map((chapter) => chapter.position),
  );
  const open = view.lines
    .filter((line) => line.status !== "committed")
    .sort((a, b) => a.plannedPayoff - b.plannedPayoff);
  return (
    <Card title={viewCopy.dashboardText32}>
      {open.length ? (
        open.map((line) => {
          const overdue = line.plannedPayoff < lastWritten;
          return (
            <div key={line.id} className="wb-row">
              <span className="wb-row-title">{line.title}</span>
              <span className="wb-row-meta">
                {viewText("dashboardText39", {
                  value0: line.plannedPlant,
                  value1: line.plannedPayoff,
                })}
              </span>
              <Tag tone={line.status === "missed" ? "danger" : overdue ? "warning" : "neutral"}>
                {FORESHADOW_STATUS_LABEL[line.status]}
                {overdue && line.status !== "missed" ? " · " + viewCopy.dashboardText36 : ""}
              </Tag>
            </div>
          );
        })
      ) : (
        <p className="wb-muted">{viewCopy.dashboardText34}</p>
      )}
      {view.lines.length > open.length ? (
        <p className="wb-muted">
          {viewText("dashboardText35", { value0: view.lines.length - open.length })}
        </p>
      ) : null}
      {view.handoff ? (
        <p className="wb-muted">{viewText("dashboardText38", { value0: view.handoff.summary })}</p>
      ) : null}
    </Card>
  );
}

/** 知情时间线：fact × holder，按 since 章排序。 */
function KnowledgeTimeline({ view }) {
  const rows = view.knowledge
    .flatMap((item) => item.holders.map((holder) => ({ item, holder })))
    .sort((a, b) => a.holder.since - b.holder.since);
  return (
    <Card title={viewCopy.dashboardText33}>
      {rows.map(({ item, holder }) => (
        <div key={item.id + holder.who + holder.since} className="wb-row">
          <span className="wb-row-title">{item.fact}</span>
          <span className="wb-row-meta">
            {holder.who} · {holder.level} · {viewText("dashboardText40", { value0: holder.since })}
          </span>
        </div>
      ))}
    </Card>
  );
}

export function Dashboard({ snap, onOpen }) {
  const chapters = snap.chapters || [],
    totals = snap.totals;
  const activity = snap.activity,
    days = activity?.days || [];
  const events = [...(snap.ledgerRecent || [])].reverse().slice(0, 5);
  const continuity = snap.continuityView;
  return (
    <div className="wb-dashboard">
      <header>
        <p className="wb-muted">{viewCopy.dashboardText5}</p>
        <h1>{snap.title}</h1>
      </header>
      <div className="wb-dashboard-stats">
        <Card>
          <Stat
            label={viewCopy.dashboardText6}
            value={(totals.words || 0).toLocaleString()}
            detail={
              days.length
                ? viewText("dashboardText7", {
                    value0: days.reduce((sum, day) => sum + day.words, 0).toLocaleString(),
                  })
                : undefined
            }
          />
        </Card>
        <Card>
          <Stat
            label={viewCopy.lifecycle}
            value={totals.chapters || 0}
            detail={viewText("dashboardText8", {
              value0: totals.drafted || 0,
              value1: totals.planned || 0,
            })}
          />
        </Card>
        <Card>
          <Stat
            label={viewCopy.dashboardText9}
            value={totals.final || 0}
            detail={viewCopy.dashboardText10}
          />
        </Card>
        <Card>
          <Stat
            label={viewCopy.dashboardText11}
            value={(snap.candidates || []).filter((c) => c.pending).length}
            detail={viewCopy.dashboardText12}
          />
        </Card>
      </div>
      <div className="wb-dashboard-grid">
        <WeeklyBars activity={activity} />
        <NextSteps
          chapters={chapters}
          revisions={snap.revisionImpacts || []}
          candidates={snap.candidates || []}
          totals={totals}
          onOpen={onOpen}
        />
      </div>
      {continuity && continuity.lines.length ? (
        <ForeshadowBoard view={continuity} chapters={chapters} />
      ) : null}
      {continuity && continuity.knowledge.length ? <KnowledgeTimeline view={continuity} /> : null}
      {snap.foundation?.threads && (
        <Card title={viewCopy.dashboardText26}>
          <p className="wb-prewrap">{snap.foundation.threads}</p>
        </Card>
      )}
      <Card title={viewCopy.dashboardText27}>
        {events.length ? (
          events.map((event, i) => (
            <p key={i}>
              {chapterName(chapters, event.chapterId)} ·{" "}
              {event.kind === "chapter_save_direct"
                ? viewCopy.dashboardText28
                : event.kind?.includes("review")
                  ? viewCopy.dashboardText29
                  : viewCopy.dashboardText30}
              <small> · {formatDateTime(event.at)}</small>
            </p>
          ))
        ) : (
          <p className="wb-muted">{viewCopy.dashboardText31}</p>
        )}
      </Card>
    </div>
  );
}

function WeeklyBars({ activity }) {
  const days = activity?.days || [];
  const maximum = Math.max(1, ...days.map((day) => day.words));
  return (
    <Card title={viewCopy.dashboardText13}>
      {activity?.unavailable ? (
        <p role="alert">{viewCopy.dashboardText14}</p>
      ) : (
        <>
          <div className="wb-dashboard-bars" aria-label={viewCopy.dashboardText15}>
            {days.map((day) => (
              <div
                key={day.date}
                className="wb-dashboard-bar"
                title={viewText("dashboardText16", { value0: day.date, value1: day.words })}
              >
                <small>{day.words || ""}</small>
                <i style={{ height: `${Math.max(1, (day.words / maximum) * 100)}%` }} />
                <small>{day.date.slice(5)}</small>
              </div>
            ))}
          </div>
          <p className="wb-muted">{activity?.basis || viewCopy.dashboardText17}</p>
        </>
      )}
    </Card>
  );
}
function NextSteps({ chapters, revisions, candidates, totals, onOpen }) {
  const next = [];
  if (revisions.length)
    next.push({ chapter: revisions[0].chapterId, text: viewCopy.dashboardText1 });
  const pending = candidates.find((candidate) => candidate.pending);
  if (pending) next.push({ chapter: pending.chapterId, text: viewCopy.dashboardText2 });
  const current = chapters.find((chapter) => chapter.status !== "final");
  if (current)
    next.push({
      chapter: current.id,
      text: current.wordCount ? viewCopy.dashboardText3 : viewCopy.dashboardText4,
    });
  return (
    <Card title={viewCopy.dashboardText18}>
      <div className="wb-dashboard-next">
        {next.slice(0, 3).map((item, i) => (
          <div key={i}>
            <span>
              {chapterName(chapters, item.chapter)}
              <br />
              <small>{item.text}</small>
            </span>
            <Button onClick={() => onOpen(item.chapter)}>{viewCopy.dashboardText19}</Button>
          </div>
        ))}
        {!next.length && <p>{viewCopy.dashboardText20}</p>}
      </div>
      <div className="wb-dashboard-progress" aria-label={viewCopy.dashboardText21}>
        <span
          style={{ width: `${totals.chapters ? (totals.final / totals.chapters) * 100 : 0}%` }}
        />
        <span
          style={{ width: `${totals.chapters ? (totals.drafted / totals.chapters) * 100 : 0}%` }}
        />
      </div>
      <small>
        {viewCopy.dashboardText22}
        {totals.final || 0}
        {viewCopy.dashboardText23}
        {totals.drafted || 0}
        {viewCopy.dashboardText24}
        {totals.planned || 0}
        {viewCopy.dashboardText25}
      </small>
    </Card>
  );
}
