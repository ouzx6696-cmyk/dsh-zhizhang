import React from "react";
import { ShieldAlert } from "lucide-react";
import { DESKTOP_COPY } from "@zhizhang/ui/copy";
import { Button, Empty } from "@zhizhang/ui/primitives";
import type { AuditFinding, Bible, KnowledgeRow } from "@zhizhang/fanqie/bible";
import type { LearningView } from "../../../shared/views";
import { opSummary } from "../workflow/BiblePane";

const C = DESKTOP_COPY;

export function BibleKnowledgeTab({ items }: { items: readonly KnowledgeRow[] }) {
  return (
    <div className="zz-bible-center__body">
      {items.length ? (
        <div className="zz-board__sheet">
          <table className="zz-table">
            <thead>
              <tr>
                <th>{C.bible.kind.entity}</th>
                <th>{C.bible.kind.knowledge}</th>
                <th className="zz-table__num">{C.fanqie.index}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>{row.holder}</td>
                  <td>
                    <strong>{row.level}</strong> · {row.fact}
                  </td>
                  <td className="zz-table__num">{row.since}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={C.bibleCenter.emptyKnowledge} />
      )}
    </div>
  );
}

export function BiblePendingTab({
  pending,
  findings,
  maxChapter,
  readonly,
  busy,
  onRunAudit,
  onAskAssistantAudit,
  onDecide,
}: {
  pending: Bible["pending"];
  findings: readonly AuditFinding[] | null;
  maxChapter: number;
  readonly: boolean;
  busy: string;
  onRunAudit: () => void;
  onAskAssistantAudit: () => void;
  onDecide: (id: string, decision: "accept" | "reject") => void;
}) {
  return (
    <div className="zz-bible-center__body">
      <div className="zz-row">
        <Button
          size="sm"
          data-testid="bible-audit"
          loading={busy === "audit"}
          disabled={maxChapter === 0}
          onClick={onRunAudit}
        >
          <ShieldAlert size={14} aria-hidden="true" />
          {C.bible.audit}
        </Button>
        {findings && findings.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={onAskAssistantAudit}>
            {C.bibleCenter.askAssistantAudit}
          </Button>
        ) : null}
      </div>
      {pending.length ? (
        <ul className="zz-list">
          {pending.map((item) => (
            <li
              key={item.id}
              data-testid="bible-pending"
              data-conflict={Boolean(item.conflictsWith)}
            >
              <span>{opSummary(item.op)}</span>
              {item.evidence ? <q className="zz-muted">{item.evidence.quote}</q> : null}
              <span className="zz-row">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={readonly || busy !== ""}
                  onClick={() => onDecide(item.id, "accept")}
                >
                  {C.bible.accept}
                </Button>
                <Button
                  size="sm"
                  disabled={readonly || busy !== ""}
                  onClick={() => onDecide(item.id, "reject")}
                >
                  {C.bible.reject}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title={C.bible.noPending} />
      )}
      {findings ? (
        findings.length ? (
          <ul className="zz-list" data-testid="bible-findings">
            {findings.map((f) => (
              <li key={f.kind + f.refId} data-severity={f.severity}>
                <strong>{f.title}</strong>
                <span className="zz-muted">{f.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="zz-muted" data-testid="bible-findings">
            {C.bible.clean}
          </p>
        )
      ) : null}
    </div>
  );
}

export function BibleLearningTab({ learning }: { learning: LearningView | null }) {
  return (
    <div className="zz-bible-center__body">
      {learning && (learning.rules.length || learning.patterns.length) ? (
        <>
          <h3>{C.bibleCenter.learningRulesTitle}</h3>
          {learning.rules.length ? (
            <ul className="zz-list">
              {learning.rules.map((r) => (
                <li key={r.id}>
                  <strong>{r.condition}</strong>
                  <span>{r.change}</span>
                  <span className="zz-muted">{r.why}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <h3>{C.bibleCenter.learningPatternsTitle}</h3>
          <ul className="zz-list">
            {learning.patterns.map((p) => (
              <li key={p.signature}>
                <strong>{p.condition}</strong>
                <span>{p.change}</span>
                <span className="zz-muted zz-tabular">
                  {C.bibleCenter.learningCount(p.count)} ·{" "}
                  {p.promoted ? C.bibleCenter.learningPromoted : C.bibleCenter.learningObserving}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Empty title={C.bibleCenter.emptyLearning} />
      )}
    </div>
  );
}
