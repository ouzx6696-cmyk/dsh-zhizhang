import React, { useEffect, useId, useState } from "react";
import { COPY as copy, WORKFLOW_COPY } from "../../../../../../packages/ui/src/copy.js";
import { scopeId, type Target } from "../../../context";
import type { ContinuityState, PendingFact } from "../../../workflow/continuity";
import { desktop } from "../../state/desktop";
import { errorText } from "../../../../../../packages/core/src/errors.js";
import { TabList, tabPanelProps } from "../../../../../../packages/ui/src/tabs";
import "../../../styles/workflow-facts.css";

const KINDS = [
  { id: "character", label: copy.workflowCharacters },
  { id: "object", label: copy.workflowObjects },
  { id: "knowledge", label: copy.workflowKnowledge },
  { id: "thread", label: copy.workflowThreads },
  { id: "timeline", label: copy.workflowTimeline },
  { id: "pending", label: copy.workflowPending },
];

/** 情绪曲线的坐标：每章横向 20，情绪 0–5 映射到纵向 110–10。 */
const STEP = 20;
const point = (index: number, emotion: number) => `${index * STEP + 10},${110 - emotion * 20}`;

function PendingCard({
  fact,
  busy,
  onDecide,
}: {
  fact: PendingFact;
  busy: boolean;
  onDecide: (accept: boolean) => void;
}) {
  return (
    <article className="wf-fact" data-pending="true">
      <header>
        <strong>{fact.subject}</strong>
        <small>{fact.chapter}</small>
      </header>
      <p>{fact.value}</p>
      <p className="wf-hint">{fact.reason}</p>
      <blockquote>{fact.quote}</blockquote>
      <div className="wf-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => onDecide(true)}>
          {copy.workflowAccept}
        </button>
        <button type="button" disabled={busy} onClick={() => onDecide(false)}>
          {copy.workflowReject}
        </button>
      </div>
    </article>
  );
}

function Rhythm({ chapters }: { chapters: ContinuityState["chapters"] }) {
  const heading = useId();
  return (
    <section className="wf-rhythm" aria-labelledby={heading}>
      <h3 id={heading}>{copy.workflowRhythm}</h3>
      <svg
        role="img"
        aria-label={copy.workflowRhythm}
        viewBox={`0 0 ${Math.max(60, chapters.length * STEP)} 120`}
        preserveAspectRatio="none"
      >
        <polyline
          points={chapters.map((chapter, index) => point(index, chapter.emotion)).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <ol>
        {chapters.map((chapter) => (
          <li key={chapter.id}>
            <span className="wf-rhythm-head">
              <strong>{chapter.id}</strong>
              <span>{WORKFLOW_COPY.emotion(chapter.emotion)}</span>
              <span>{chapter.hook}</span>
            </span>
            <p>{chapter.summary}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 连续性看板：已确认事实按类别分标签，待确认冲突由作者逐条裁定。 */
export function ContinuityPane({
  target,
  onError,
}: {
  target: Target;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<ContinuityState | null>(null),
    [kind, setKind] = useState("character"),
    [busy, setBusy] = useState(false);
  const base = useId(),
    key = scopeId(target);
  useEffect(() => {
    let active = true;
    desktop
      .continuity(target)
      .then((value) => {
        if (active) setState(value);
      })
      .catch((error) => {
        if (active) onError(errorText(error));
      });
    return () => {
      active = false;
    };
  }, [key, onError]); // eslint-disable-line react-hooks/exhaustive-deps
  const action = async (operation: "migrate" | "accept" | "reject", id?: string) => {
    setBusy(true);
    try {
      setState(await desktop.continuity(target, operation, id));
    } catch (error) {
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const facts = state?.facts.filter((fact) => fact.kind === kind) ?? [];
  const chapters = state?.chapters.slice(-20) ?? [];
  const items = KINDS.map((item) =>
    item.id === "pending" && state?.pending.length
      ? { ...item, label: `${item.label} ${state.pending.length}` }
      : item,
  );
  return (
    <div className="wf-continuity">
      <div className="wf-actions">
        <button type="button" disabled={busy} onClick={() => void action("migrate")}>
          {copy.workflowMigrate}
        </button>
      </div>
      <TabList
        id={base}
        className="wf-tabs"
        label={copy.workflowStateTab}
        items={items}
        value={kind}
        onChange={setKind}
      />
      <div {...tabPanelProps(base, kind, kind)} tabIndex={0} className="wf-facts">
        {kind === "pending" ? (
          state?.pending.length ? (
            state.pending.map((fact) => (
              <PendingCard
                key={fact.id}
                fact={fact}
                busy={busy}
                onDecide={(accept) => void action(accept ? "accept" : "reject", fact.id)}
              />
            ))
          ) : (
            <p className="wf-hint">{WORKFLOW_COPY.noPending}</p>
          )
        ) : facts.length ? (
          facts.map((fact) => (
            <article key={fact.kind + fact.subject} className="wf-fact">
              <header>
                <strong>{fact.subject}</strong>
                <small>{fact.chapter}</small>
              </header>
              <p>{fact.value}</p>
              <blockquote>{fact.quote}</blockquote>
            </article>
          ))
        ) : (
          <p className="wf-hint">{copy.workflowNoFacts}</p>
        )}
      </div>
      {chapters.length > 0 && <Rhythm chapters={chapters} />}
    </div>
  );
}
