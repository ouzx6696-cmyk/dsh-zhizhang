import React, { useEffect, useState } from "react";
import { COPY as copy } from "../../../../../../packages/ui/src/copy.js";
import { Dialog } from "../../../../../../packages/ui/src/primitives";
import { errorText } from "../../../../../../packages/core/src/errors.js";
import type {
  WorkflowRecord,
  WorkflowRequest,
  EngineSettings,
} from "../../../../../../packages/core/src/workflow-config.js";
import { CLASSICS } from "../../../../../../packages/toutiao/src/classics.js";
import type { Target, Focus } from "../../../context";
import { desktop } from "../../state/desktop";
import { PersonalPane } from "./PersonalPane";
import { HistoryPane } from "./HistoryPane";
import { ContinuityPane } from "./ContinuityPane";

const states = {
  running: copy.workflowRunning,
  paused: copy.workflowPaused,
  failed: copy.workflowFailed,
  "awaiting-author": copy.workflowReady,
};
/** True when the delivered work still carries hard issues or unsourced facts for the author. */
function deliveryOpen(record: WorkflowRecord) {
  const output = record.steps.find((step) => step.id === "delivery")?.output;
  return (
    typeof output === "object" &&
    output !== null &&
    "unresolved" in output &&
    output.unresolved === true
  );
}
function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}
function draftOutput(value: unknown): { title: string; body: string } | undefined {
  if (
    value &&
    typeof value === "object" &&
    "title" in value &&
    "body" in value &&
    typeof value.title === "string" &&
    typeof value.body === "string"
  )
    return { title: value.title, body: value.body };
}
function StageReport({ record }: { record: WorkflowRecord }) {
  const [selected, setSelected] = useState("delivery"),
    [left, setLeft] = useState(0),
    [right, setRight] = useState(1);
  const step = record.steps.find((step) => step.id === selected);
  const drafts = record.steps
    .filter((step) => /^draft-\d+$/.test(step.id) && step.status === "complete")
    .map((step) => draftOutput(step.output))
    .filter((value): value is { title: string; body: string } => value !== undefined);
  return (
    <>
      <ol className="wf-stages">
        {record.steps.map((step) => (
          <li key={step.id}>
            <button onClick={() => setSelected(step.id)}>{step.title}</button>
            <span>
              {step.status === "complete"
                ? copy.workflowComplete
                : step.status === "failed"
                  ? copy.workflowFailed
                  : copy.workflowRunning}
            </span>
            <small>
              {(step.durationMs / 1000).toFixed(1)}s · {copy.workflowInput} {step.usage.input} ·{" "}
              {copy.workflowOutput} {step.usage.output} · {copy.workflowCache}{" "}
              {step.usage.cacheRead} · {copy.workflowCost}{" "}
              {step.usage.cost === null ? copy.workflowUnknown : step.usage.cost.toFixed(6)}
            </small>
            {step.model && <small>{step.model}</small>}
            {step.error && <p role="alert">{step.error}</p>}
          </li>
        ))}
      </ol>
      {step && (
        <section>
          <h3>{step.title}</h3>
          <pre className="wf-output">{json(step.output)}</pre>
        </section>
      )}
      {drafts.length > 1 && (
        <section>
          <h3>{copy.workflowCompare}</h3>
          <div className="wf-compare">
            {[left, right].map((choice, column) => (
              <section key={column}>
                <select
                  aria-label={copy.workflowCompare + " " + (column + 1)}
                  value={Math.min(choice, drafts.length - 1)}
                  onChange={(e) =>
                    column === 0
                      ? setLeft(Number(e.target.value))
                      : setRight(Number(e.target.value))
                  }
                >
                  {drafts.map((value, index) => (
                    <option key={index} value={index}>
                      {index + 1} · {value.title}
                    </option>
                  ))}
                </select>
                <pre>{drafts[Math.min(choice, drafts.length - 1)].body}</pre>
              </section>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
export function WorkflowPanel({
  target,
  focus,
  engine,
  onClose,
  onNavigate,
}: {
  target: Target;
  focus: Focus;
  engine: EngineSettings;
  onClose: () => void;
  onNavigate: (target: Target, focus: Focus) => Promise<void>;
}) {
  const [value, setValue] = useState<WorkflowRecord | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("task"),
    [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<WorkflowRequest>({
    kind: target.mode === "toutiao" ? "article" : "chapter",
    chapter: focus.chapter ?? "c001",
    instruction: "",
    grade: engine.grade,
    source: "",
    line: "news",
  });
  const [archived, setArchived] = useState<WorkflowRecord | null>(null);
  const key = JSON.stringify(target);
  useEffect(() => {
    let alive = true;
    desktop
      .workflow(target, "status")
      .then((value) => {
        if (alive) {
          setValue(value);
          if (value) setRequest(value.request);
        }
      })
      .catch((error) => {
        if (alive) setError(errorText(error));
      });
    const off = desktop.subscribe((event) => {
      if (
        event.workflow &&
        event.target?.mode === target.mode &&
        event.target?.root === target.root &&
        event.target?.work === target.work &&
        event.target?.article === target.article
      )
        setValue(event.workflow);
    });
    return () => {
      alive = false;
      off();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const action = async (action: "start" | "resume" | "pause" | "apply") => {
    setError("");
    setBusy(true);
    try {
      setValue(await desktop.workflow(target, action, action === "start" ? request : undefined));
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const running = value?.state === "running";
  return (
    <Dialog title={copy.workflowTitle} className="studio-workflow" onClose={onClose}>
      <header>
        <h2>{copy.workflowTitle}</h2>
        <button onClick={onClose}>{copy.close}</button>
      </header>
      <nav className="wf-tabs">
        <button aria-pressed={tab === "task"} onClick={() => setTab("task")}>
          {copy.workflowTaskTab}
        </button>
        {target.mode === "fanqie" && (
          <button aria-pressed={tab === "state"} onClick={() => setTab("state")}>
            {copy.workflowStateTab}
          </button>
        )}
        <button aria-pressed={tab === "personal"} onClick={() => setTab("personal")}>
          {copy.workflowPersonalTab}
        </button>
      </nav>
      {tab === "task" && (
        <>
          <fieldset disabled={busy || running}>
            <label>
              {copy.workflowKind}
              <select
                value={request.kind}
                onChange={(e) =>
                  setRequest({ ...request, kind: e.target.value as WorkflowRequest["kind"] })
                }
              >
                {target.mode === "fanqie" ? (
                  <>
                    <option value="book">{copy.workflowBook}</option>
                    <option value="chapter">{copy.workflowChapter}</option>
                    <option value="ledger">{copy.workflowLedger}</option>
                  </>
                ) : (
                  <option value="article">{copy.workflowArticle}</option>
                )}
              </select>
            </label>
            {request.kind !== "article" && request.kind !== "book" && (
              <label>
                {copy.workflowChapterId}
                <input
                  value={request.chapter}
                  onChange={(e) => setRequest({ ...request, chapter: e.target.value })}
                />
              </label>
            )}
            <label>
              {copy.workflowInstruction}
              <textarea
                value={request.instruction}
                onChange={(e) => setRequest({ ...request, instruction: e.target.value })}
              />
            </label>
            <label>
              {copy.workflowGrade}
              <select
                value={request.grade}
                onChange={(e) =>
                  setRequest({ ...request, grade: e.target.value as WorkflowRequest["grade"] })
                }
              >
                <option value="economy">{copy.workflowEconomy}</option>
                <option value="standard">{copy.workflowStandard}</option>
                <option value="premium">{copy.workflowPremium}</option>
              </select>
            </label>
            {request.kind === "article" && (
              <>
                <label>
                  {copy.workflowLine}
                  <select
                    value={request.line}
                    onChange={(e) =>
                      setRequest({ ...request, line: e.target.value as WorkflowRequest["line"] })
                    }
                  >
                    <option value="news">{copy.workflowNews}</option>
                    <option value="story">{copy.workflowStory}</option>
                    <option value="micro">{copy.workflowMicro}</option>
                  </select>
                </label>
                {request.line === "story" && (
                  <label>
                    {copy.workflowClassic}
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const classic = CLASSICS.find((value) => value.id === e.target.value);
                        if (classic)
                          setRequest({ ...request, source: classic.source + "\n" + classic.text });
                      }}
                    >
                      <option value="">{copy.workflowClassicNone}</option>
                      {CLASSICS.map((value) => (
                        <option key={value.id} value={value.id}>
                          {value.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  {copy.workflowSource}
                  <textarea
                    value={request.source}
                    onChange={(e) => setRequest({ ...request, source: e.target.value })}
                  />
                </label>
                <p>{copy.workflowSourceNote}</p>
              </>
            )}
            <p>{copy.workflowCostNote}</p>
          </fieldset>
          <div className="wf-actions">
            <button disabled={busy || running} onClick={() => void action("start")}>
              {copy.workflowStart}
            </button>
            <button
              disabled={busy || !value || running || value.state === "awaiting-author"}
              onClick={() => void action("resume")}
            >
              {copy.workflowResume}
            </button>
            <button disabled={!running || busy} onClick={() => void action("pause")}>
              {copy.workflowPause}
            </button>
            <HistoryPane
              target={target}
              updated={value?.updated}
              onError={setError}
              onSelect={setArchived}
            />
            {archived && (
              <section>
                <h3>
                  {archived.created} · {archived.request.instruction}
                </h3>
                <StageReport record={archived} />
              </section>
            )}
            {value?.state === "awaiting-author" &&
              (value.request.kind === "book" || value.request.kind === "article") &&
              !value.steps.some(
                (step) => step.id === "author-application" && step.status === "complete",
              ) && (
                <button disabled={busy} onClick={() => void action("apply")}>
                  {value.request.kind === "book" ? copy.workflowApply : copy.workflowApplyArticle}
                </button>
              )}
          </div>
          {value ? (
            <>
              <p role="status">{states[value.state]}</p>
              {value.error && <p role="alert">{value.error}</p>}
              {deliveryOpen(value) && <p role="alert">{copy.workflowOpenIssues}</p>}
              <StageReport record={value} />
            </>
          ) : (
            <p>{copy.workflowNoTask}</p>
          )}
          {value?.state === "awaiting-author" && value.request.kind === "chapter" && (
            <button
              onClick={() => {
                void onNavigate(target, {
                  chapter: value.request.chapter,
                  source: "candidate",
                  candidate: (() => {
                    const output = value.steps.find((step) => step.id === "delivery")?.output;
                    if (
                      output &&
                      typeof output === "object" &&
                      "candidates" in output &&
                      Array.isArray(output.candidates)
                    ) {
                      const chosen = output.candidates.find((row) => row.selected === true);
                      if (chosen && typeof chosen.id === "string") return chosen.id;
                    }
                    return undefined;
                  })(),
                })
                  .then(onClose)
                  .catch((error) => setError(errorText(error)));
              }}
            >
              {copy.workflowViewCandidate}
            </button>
          )}
        </>
      )}
      {tab === "state" && <ContinuityPane target={target} onError={setError} />}
      {tab === "personal" && <PersonalPane target={target} onError={setError} />}
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
