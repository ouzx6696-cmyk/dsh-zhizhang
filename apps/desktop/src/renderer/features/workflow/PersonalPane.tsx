import React, { useEffect, useState } from "react";
import { COPY as copy } from "../../../../../../packages/ui/src/copy.js";
import { errorText } from "../../../../../../packages/core/src/errors.js";
import { desktop } from "../../state/desktop";
import type { Target } from "../../../context";
import "../../../styles/workflow-facts.css";
export function PersonalPane({
  target,
  onError,
}: {
  target: Target;
  onError: (text: string) => void;
}) {
  const [state, setState] = useState<Awaited<ReturnType<typeof desktop.learning>> | null>(null),
    [edits, setEdits] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    desktop
      .learning(target)
      .then((value) => {
        if (alive) setState(value);
      })
      .catch((error) => {
        if (alive) onError(errorText(error));
      });
    return () => {
      alive = false;
    };
  }, [target, onError]);
  const decide = async (id: string, action: "accept" | "reject") => {
    setBusy(true);
    try {
      setState(await desktop.learning(target, action, id, edits[id]));
    } catch (error) {
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wf-personal">
      <p className="wf-hint">{copy.workflowPersonalNote}</p>
      {!state?.pending.length && <p className="wf-hint">{copy.workflowRuleEmpty}</p>}
      {state?.pending.map((rule) => (
        <article className="wf-fact" data-pending="true" key={rule.id}>
          <header>
            <strong>{rule.condition}</strong>
            <small>{rule.count}</small>
          </header>
          <p>{rule.why}</p>
          <blockquote>
            {rule.example.before} → {rule.example.after}
          </blockquote>
          <label>
            {copy.workflowRuleEdit}
            <textarea
              value={edits[rule.id] ?? rule.change}
              onChange={(e) => setEdits({ ...edits, [rule.id]: e.target.value })}
            />
          </label>
          <div className="wf-actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void decide(rule.id, "accept")}
            >
              {copy.workflowAccept}
            </button>
            <button type="button" disabled={busy} onClick={() => void decide(rule.id, "reject")}>
              {copy.workflowReject}
            </button>
          </div>
        </article>
      ))}
      <h3>{copy.workflowRuleActive}</h3>
      {state?.rules.map((rule) => (
        <article className="wf-fact" key={rule.id}>
          <header>
            <strong>{rule.condition}</strong>
            <small>{rule.id}</small>
          </header>
          <p>{rule.change}</p>
          <p className="wf-hint">
            {copy.workflowRuleProgress} {rule.subsequent} · {copy.workflowRuleRecurring}{" "}
            {rule.recurring}
          </p>
          {rule.subsequent >= 10 && <p className="wf-notice-raw">{copy.workflowRuleReview}</p>}
        </article>
      ))}
    </div>
  );
}
