import React, { useCallback, useEffect, useState } from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, Empty, Notice, Skeleton } from "@zhizhang/ui/primitives";
import type { AuditFinding, Bible, BibleOp } from "@zhizhang/fanqie/bible";
import { desktop } from "../../state/desktop";
import { useDesktop } from "../../state/store";
import { errorText, notifyError } from "../../format";

/** 待确认条目的一行摘要（圣经是连续性的唯一真源，取代 1.x 的连续性面板）。 */
export function opSummary(op: BibleOp): string {
  switch (op.type) {
    case "entity.upsert":
      return `${C.bible.kind.entity} · ${op.entity.name}`;
    case "state.add":
      return `${C.bible.kind.state} · ${op.entry.entity} ${op.entry.field}：${op.entry.value}`;
    case "thread.upsert":
      return `${C.bible.kind.thread} · ${op.thread.title}`;
    case "knowledge.set":
      return `${C.bible.kind.knowledge} · ${op.row.holder}（${op.row.level}）${op.row.fact}`;
    case "chapter.record":
      return `${C.bible.kind.chapter} · ${op.record.summary}`;
    default: {
      const never: never = op;
      return never;
    }
  }
}

export function BiblePane({ work, chapters }: { work: string; chapters: number }) {
  const revision = useDesktop((s) => s.revisions.bible);
  const readonly = useDesktop((s) => Boolean(s.workspace?.readonly));
  const [bible, setBible] = useState<Bible | null>(null);
  const [error, setError] = useState("");
  const [findings, setFindings] = useState<AuditFinding[] | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setBible(await desktop.workbench("fanqie.bible.get", { work }));
      setError("");
    } catch (err) {
      setError(errorText(err));
    }
  }, [work]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const decide = async (id: string, decision: "accept" | "reject") => {
    setBusy(id);
    try {
      await desktop.workbench("fanqie.bible.decide", { work, id, decision });
      await load();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  const audit = async () => {
    setBusy("audit");
    try {
      const result = await desktop.workbench("fanqie.bible.audit", { work, upTo: Math.max(1, chapters) });
      setFindings(result.findings);
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  if (error) return <Notice tone="bad" message={error} />;
  if (!bible) return <Skeleton lines={4} />;
  const openThreads = bible.threads.filter((t) => t.status === "open").length;
  return (
    <section className="zz-bible" data-testid="bible-pane" aria-label={C.bible.title}>
      <h3>{C.bible.title}</h3>
      <p className="zz-muted">{C.bible.stats(bible.entities.length, openThreads, bible.knowledge.length)}</p>
      <h4>{C.bible.pending(bible.pending.length)}</h4>
      {bible.pending.length ? (
        <ul className="zz-list">
          {bible.pending.map((item) => (
            <li key={item.id} data-testid="bible-pending" data-conflict={Boolean(item.conflictsWith)}>
              <span>{opSummary(item.op)}</span>
              {item.evidence ? <q className="zz-muted">{item.evidence.quote}</q> : null}
              <span className="zz-row">
                <Button size="sm" variant="primary" disabled={readonly || busy !== ""} data-testid="bible-accept" onClick={() => void decide(item.id, "accept")}>
                  {C.bible.accept}
                </Button>
                <Button size="sm" disabled={readonly || busy !== ""} data-testid="bible-reject" onClick={() => void decide(item.id, "reject")}>
                  {C.bible.reject}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title={C.bible.noPending} />
      )}
      <Button size="sm" data-testid="bible-audit" loading={busy === "audit"} disabled={chapters === 0} onClick={() => void audit()}>
        {C.bible.audit}
      </Button>
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
          <p className="zz-muted" data-testid="bible-findings">{C.bible.clean}</p>
        )
      ) : null}
    </section>
  );
}
