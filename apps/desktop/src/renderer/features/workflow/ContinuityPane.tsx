import React, { useEffect, useState } from "react";
import { COPY as copy } from "../../../../../../packages/ui/src/copy.js";
import type { Target } from "../../../context";
import type { ContinuityState } from "../../../workflow/continuity";
import { desktop } from "../../state/desktop";
import { errorText } from "../../../../../../packages/core/src/errors.js";
const KINDS = [
  ["character", copy.workflowCharacters],
  ["object", copy.workflowObjects],
  ["knowledge", copy.workflowKnowledge],
  ["thread", copy.workflowThreads],
  ["timeline", copy.workflowTimeline],
  ["pending", copy.workflowPending],
] as const;
export function ContinuityPane({
  target,
  onError,
}: {
  target: Target;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<ContinuityState | null>(null),
    [kind, setKind] = useState<string>("character"),
    [busy, setBusy] = useState(false);
  const key = JSON.stringify(target);
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
  const points = chapters
    .map((chapter, index) => `${index * 20 + 10},${110 - chapter.emotion * 20}`)
    .join(" ");
  return (
    <section>
      <button disabled={busy} onClick={() => void action("migrate")}>
        {copy.workflowMigrate}
      </button>
      <nav className="wf-tabs">
        {KINDS.map(([id, label]) => (
          <button key={id} aria-pressed={kind === id} onClick={() => setKind(id)}>
            {label}
          </button>
        ))}
      </nav>
      {kind === "pending" ? (
        (state?.pending ?? []).map((fact) => (
          <article key={fact.id} className="wf-fact">
            <strong>{fact.subject}</strong>
            <p>{fact.value}</p>
            <p>{fact.reason}</p>
            <blockquote>{fact.quote}</blockquote>
            <button disabled={busy} onClick={() => void action("accept", fact.id)}>
              {copy.workflowAccept}
            </button>
            <button disabled={busy} onClick={() => void action("reject", fact.id)}>
              {copy.workflowReject}
            </button>
          </article>
        ))
      ) : facts.length ? (
        facts.map((fact) => (
          <article key={fact.kind + fact.subject} className="wf-fact">
            <strong>{fact.subject}</strong>
            <p>{fact.value}</p>
            <small>{fact.chapter}</small>
            <blockquote>{fact.quote}</blockquote>
          </article>
        ))
      ) : (
        <p>{copy.workflowNoFacts}</p>
      )}
      {chapters.length > 0 && (
        <section>
          <h3>{copy.workflowRhythm}</h3>
          <svg
            role="img"
            aria-label={copy.workflowRhythm}
            viewBox={`0 0 ${Math.max(60, chapters.length * 20)} 120`}
          >
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
          <ol>
            {chapters.map((chapter) => (
              <li key={chapter.id}>
                {chapter.id} · {chapter.emotion}/5 · {chapter.hook}
                <p>{chapter.summary}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
