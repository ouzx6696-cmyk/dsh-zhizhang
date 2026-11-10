import React, { memo, useState } from "react";
import {
  COPY as copy,
  formatCount,
  WORKFLOW_COPY,
} from "../../../../../../packages/ui/src/copy.js";
import { isRecord } from "../../../../../../packages/core/src/parse.js";
import type { WorkflowStep } from "../../../../../../packages/core/src/workflow-config.js";
import "../../../styles/workflow-output.css";

type Data = Record<string, unknown>;

/** 阶段产出来自模型 JSON，记录里是 unknown：展示前逐字段收窄，缺字段就不显示。 */
function text(data: Data, key: string) {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}
function records(data: Data, key: string) {
  const value = data[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
function strings(data: Data, key: string) {
  const value = data[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

const PREVIEW = 240;

function Prose({ value }: { value: string }) {
  const [full, setFull] = useState(false);
  const long = value.length > PREVIEW;
  return (
    <div className="wf-out-prose">
      <p>{full || !long ? value : value.slice(0, PREVIEW) + "…"}</p>
      {long && (
        <button type="button" className="wf-out-more" onClick={() => setFull(!full)}>
          {full ? WORKFLOW_COPY.showLess : WORKFLOW_COPY.showFull} ·{" "}
          {WORKFLOW_COPY.chars(value.length)}
        </button>
      )}
    </div>
  );
}

function Fields({ data, labels }: { data: Data; labels: Record<string, string> }) {
  const rows = Object.entries(labels).flatMap(([key, label]) => {
    const value = data[key];
    return typeof value === "string" || typeof value === "number"
      ? [[key, label, String(value)] as const]
      : [];
  });
  if (!rows.length) return null;
  return (
    <dl className="wf-out-fields">
      {rows.map(([key, label, value]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Bullets({ title, items }: { title?: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="wf-out-list">
      {title && <h5>{title}</h5>}
      <ul>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function DraftView({ data }: { data: Data }) {
  const body = text(data, "body");
  return (
    <>
      {text(data, "title") && <h4 className="wf-out-title">{text(data, "title")}</h4>}
      {body && <Prose value={body} />}
      <Bullets title={WORKFLOW_COPY.resolved} items={strings(data, "resolved")} />
    </>
  );
}

function ReviewView({ data }: { data: Data }) {
  const hard = records(data, "hard");
  return (
    <>
      {hard.length ? (
        <ol className="wf-out-issues">
          {hard.map((issue, index) => (
            <li key={index}>
              <strong>{text(issue, "location")}</strong>
              {text(issue, "quote") && <blockquote>{text(issue, "quote")}</blockquote>}
              <Fields
                data={issue}
                labels={{ impact: WORKFLOW_COPY.issue.impact, fix: WORKFLOW_COPY.issue.fix }}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="wf-out-ok">{WORKFLOW_COPY.noIssues}</p>
      )}
      <Bullets title={WORKFLOW_COPY.suggestions} items={strings(data, "suggestions")} />
    </>
  );
}

function VoteView({ data }: { data: Data }) {
  const winner = text(data, "winner");
  return (
    <div className="wf-out-vote">
      {(winner === "A" || winner === "B" || winner === "tie") && (
        <span className="wf-out-chip" data-tone={winner === "tie" ? "neutral" : "accent"}>
          {WORKFLOW_COPY.winner[winner]}
        </span>
      )}
      {text(data, "reason") && <p>{text(data, "reason")}</p>}
      <Fields
        data={data}
        labels={{ abandonA: WORKFLOW_COPY.abandon.A, abandonB: WORKFLOW_COPY.abandon.B }}
      />
    </div>
  );
}

function SelectionView({ data }: { data: Data }) {
  const winner = data.winner;
  return (
    <>
      {typeof winner === "number" && (
        <span className="wf-out-chip" data-tone="accent">
          {WORKFLOW_COPY.recommended(winner)}
        </span>
      )}
      <ol className="wf-out-duels">
        {records(data, "comparisons").map((row, index) => {
          const { left, right, winner } = row;
          if (typeof left !== "number" || typeof right !== "number") return null;
          return (
            <li key={index}>
              {WORKFLOW_COPY.duel(left, right)} ·{" "}
              {WORKFLOW_COPY.duelWinner(typeof winner === "number" ? winner : null)}
            </li>
          );
        })}
      </ol>
      {text(data, "note") && <p className="wf-out-note">{text(data, "note")}</p>}
    </>
  );
}

function ClaimsView({ data }: { data: Data }) {
  return (
    <ol className="wf-out-claims">
      {records(data, "claims").map((claim, index) => {
        const kind = text(claim, "kind") ?? "";
        return (
          <li key={index} data-kind={kind}>
            <span className="wf-out-chip" data-tone={kind === "unsupported" ? "danger" : "neutral"}>
              {WORKFLOW_COPY.claimKind[kind] ?? kind}
            </span>
            <p>{text(claim, "claim")}</p>
            {text(claim, "quote") && <blockquote>{text(claim, "quote")}</blockquote>}
          </li>
        );
      })}
    </ol>
  );
}

function ScenesView({ data }: { data: Data }) {
  return (
    <ol className="wf-out-cards">
      {records(data, "scenes").map((scene, index) => (
        <li key={index}>
          <Fields data={scene} labels={WORKFLOW_COPY.fields.scene} />
        </li>
      ))}
    </ol>
  );
}

function RollingView({ data }: { data: Data }) {
  return (
    <ol className="wf-out-cards">
      {records(data, "chapters").map((chapter, index) => (
        <li key={index}>
          <h4 className="wf-out-title">
            {text(chapter, "id")} · {text(chapter, "title")}
          </h4>
          {text(chapter, "synopsis") && <p>{text(chapter, "synopsis")}</p>}
        </li>
      ))}
    </ol>
  );
}

function SourcesView({ data }: { data: Data }) {
  const body = text(data, "text");
  return (
    <>
      <Fields data={data} labels={{ attribution: WORKFLOW_COPY.fields.source.attribution }} />
      {body && <Prose value={body} />}
    </>
  );
}

function QaView({ data }: { data: Data }) {
  return (
    <>
      <span className="wf-out-chip" data-tone={data.pass === true ? "success" : "danger"}>
        {data.pass === true ? WORKFLOW_COPY.qa.pass : WORKFLOW_COPY.qa.fail}
        {typeof data.score === "number" && ` · ${WORKFLOW_COPY.qa.score} ${data.score}`}
      </span>
      <Bullets title={WORKFLOW_COPY.qa.gates} items={strings(data, "hard_gates")} />
      <Bullets title={WORKFLOW_COPY.qa.warnings} items={strings(data, "warnings")} />
    </>
  );
}

function ExtractView({ data }: { data: Data }) {
  return (
    <>
      <Fields data={data} labels={WORKFLOW_COPY.fields.extract} />
      {typeof data.emotion === "number" && (
        <span className="wf-out-chip" data-tone="neutral">
          {WORKFLOW_COPY.emotion(data.emotion)}
        </span>
      )}
      <Bullets
        items={records(data, "facts").map((fact) =>
          WORKFLOW_COPY.fact(text(fact, "subject") ?? "", text(fact, "value") ?? ""),
        )}
      />
    </>
  );
}

function AuditView({ data }: { data: Data }) {
  return (
    <>
      {Object.entries(WORKFLOW_COPY.fields.audit).map(([key, label]) => (
        <Bullets key={key} title={label} items={strings(data, key)} />
      ))}
    </>
  );
}

function DeliveryView({ data }: { data: Data }) {
  const candidates = records(data, "candidates");
  return (
    <>
      <span className="wf-out-chip" data-tone={data.unresolved === true ? "warning" : "success"}>
        {data.unresolved === true ? WORKFLOW_COPY.delivery.open : WORKFLOW_COPY.delivery.closed}
      </span>
      {candidates.length > 0 && <p>{WORKFLOW_COPY.candidates(candidates.length)}</p>}
      {text(data, "note") && <p className="wf-out-note">{text(data, "note")}</p>}
    </>
  );
}

function CardView({ data }: { data: Data }) {
  const labels = Object.fromEntries(
    Object.keys(data)
      .filter((key) => typeof data[key] === "string")
      .map((key) => [key, key]),
  );
  return <Fields data={data} labels={labels} />;
}

function TitlesView({ data }: { data: Data }) {
  return <Bullets title={WORKFLOW_COPY.titles} items={strings(data, "titles")} />;
}

/** 按阶段编号识别产出形状；没有登记的阶段只在开发者详情里给出 JSON。 */
const VIEWS: { match: RegExp; View: (props: { data: Data }) => React.ReactNode }[] = [
  { match: /^(draft-\d+|revise-\d+|facts-revise|qa-revise-\d+)$/, View: DraftView },
  { match: /^(review-\d+|final-review)$/, View: ReviewView },
  { match: /^pair-/, View: VoteView },
  { match: /^selection$/, View: SelectionView },
  { match: /^facts(-\d+|-final)?$/, View: ClaimsView },
  {
    match: /^outline$/,
    View: ({ data }) => <Fields data={data} labels={WORKFLOW_COPY.fields.outline} />,
  },
  {
    match: /^blueprint$/,
    View: ({ data }) => <Fields data={data} labels={WORKFLOW_COPY.fields.blueprint} />,
  },
  {
    match: /^foundation$/,
    View: ({ data }) => <Fields data={data} labels={WORKFLOW_COPY.fields.foundation} />,
  },
  { match: /^scenes$/, View: ScenesView },
  { match: /^headlines$/, View: TitlesView },
  { match: /^rolling-outline$/, View: RollingView },
  { match: /^sources$/, View: SourcesView },
  { match: /^qa-\d+$/, View: QaView },
  { match: /^extract$/, View: ExtractView },
  { match: /^long-audit$/, View: AuditView },
  { match: /^(delivery|prepared)$/, View: DeliveryView },
  { match: /^article-card$/, View: CardView },
];

/** JSON 只在展开时序列化：运行中面板每秒重绘，长正文不必反复 stringify。 */
function DevDetails({ step }: { step: WorkflowStep }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="wf-out-dev" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{WORKFLOW_COPY.devDetails}</summary>
      {open && (
        <>
          <p>
            {step.id}
            {step.model && ` · ${step.model}`} · {WORKFLOW_COPY.attempts(step.attempts)}
          </p>
          <p>
            {copy.workflowInput} {formatCount(step.usage.input)} · {copy.workflowCache}{" "}
            {formatCount(step.usage.cacheRead)} · {copy.workflowOutput}{" "}
            {formatCount(step.usage.output)}
          </p>
          {step.output !== null && <pre>{JSON.stringify(step.output, null, 2)}</pre>}
        </>
      )}
    </details>
  );
}

export const StageOutput = memo(function StageOutput({ step }: { step: WorkflowStep }) {
  const view = VIEWS.find((item) => item.match.test(step.id));
  return (
    <div className="wf-out">
      {view && isRecord(step.output) && <view.View data={step.output} />}
      <DevDetails step={step} />
    </div>
  );
});
