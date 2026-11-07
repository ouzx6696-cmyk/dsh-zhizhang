import React, { useEffect, useState } from "react";
import { COPY as copy } from "../../../../../../packages/ui/src/copy.js";
import { errorText } from "../../../../../../packages/core/src/errors.js";
import { desktop } from "../../state/desktop";
import type { Target } from "../../../context";
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
    <section>
      <p>{copy.workflowPersonalNote}</p>
      {!state?.pending.length && <p>{copy.workflowRuleEmpty}</p>}
      {state?.pending.map((rule) => (
        <article className="wf-fact" key={rule.id}>
          <strong>{rule.condition}</strong>
          <p>
            {rule.why} · {rule.count}
          </p>
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
          <button disabled={busy} onClick={() => void decide(rule.id, "accept")}>
            {copy.workflowAccept}
          </button>
          <button disabled={busy} onClick={() => void decide(rule.id, "reject")}>
            {copy.workflowReject}
          </button>
        </article>
      ))}
      <h3>{copy.workflowRuleActive}</h3>
      {state?.rules.map((rule) => (
        <article className="wf-fact" key={rule.id}>
          <strong>{rule.condition}</strong>
          <p>{rule.change}</p>
          <small>{rule.id}</small>
          <p>
            {copy.workflowRuleProgress} {rule.subsequent} · {copy.workflowRuleRecurring}{" "}
            {rule.recurring}
          </p>
          {rule.subsequent >= 10 && <p>{copy.workflowRuleReview}</p>}
        </article>
      ))}
    </section>
  );
}
