import React, { useCallback, useEffect, useState } from "react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, Empty, Notice, Skeleton } from "@zhizhang/ui/primitives";
import type { AnyOp, AuditFinding, BibleSnapshot, PendingItem } from "@zhizhang/fanqie/bible";
import { desktop } from "../../state/desktop";
import { desktopStore, useDesktop } from "../../state/store";
import { errorText, notifyError } from "../../format";

/** 待确认条目的一行摘要（设定集是连续性的唯一真源，取代 1.x 的连续性面板）。 */
export function opSummary(op: AnyOp): string {
  switch (op.type) {
    case "entity.upsert":
      return `${C.bible.kind.entity} · ${op.entity.name}`;
    case "state.add":
      return `${C.bible.kind.state} · ${op.entry.entity} ${op.entry.field}：${op.entry.value}`;
    case "thread.upsert":
      return `${C.bible.kind.thread} · ${op.thread.title}`;
    case "knowledge.set":
      return `${C.bible.kind.knowledge} · ${op.row.holder}（${op.row.level}）${op.row.fact}`;
    case "ledger.write":
      return `${C.bible.kind.chapter} · ${op.entry.summary}`;
    default:
      return op.type;
  }
}

interface PendingRow {
  batch: string;
  item: PendingItem;
}

export function BiblePane({ work, chapters }: { work: string; chapters: number }) {
  const revision = useDesktop((s) => s.revisions.bible);
  const pendingRevision = useDesktop((s) => s.revisions.pending);
  const readonly = useDesktop((s) => Boolean(s.workspace?.readonly));
  const [bible, setBible] = useState<BibleSnapshot | null>(null);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [error, setError] = useState("");
  const [findings, setFindings] = useState<AuditFinding[] | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const snapshot = await desktop.workbench("fanqie.bible.get", { work });
      const { batches } = await desktop.workbench("fanqie.pending.list", {
        work,
        status: "open",
      });
      const pages = await Promise.all(
        batches.map((batch) =>
          desktop.workbench("fanqie.pending.get", {
            work,
            batch: batch.id,
            filter: { decision: "undecided" },
            page: { offset: 0, limit: 100 },
          }),
        ),
      );
      setBible(snapshot);
      setPending(
        batches.flatMap((batch, index) =>
          pages[index].items.map((item) => ({ batch: batch.id, item })),
        ),
      );
      setError("");
    } catch (err) {
      setError(errorText(err));
    }
  }, [work]);

  useEffect(() => {
    void load();
  }, [load, revision, pendingRevision]);

  const decide = async (row: PendingRow, decision: "accept" | "reject") => {
    setBusy(row.item.id);
    try {
      await desktop.workbench("fanqie.pending.decide", {
        work,
        batch: row.batch,
        decisions: [{ id: row.item.id, decision }],
      });
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
      const result = await desktop.workbench("fanqie.bible.audit", {
        work,
        upTo: Math.max(1, chapters),
      });
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
      <p className="zz-muted">
        {C.bible.stats(bible.entities.length, openThreads, bible.knowledge.length)}
      </p>
      <h4>{C.bible.pending(pending.length)}</h4>
      <Button onClick={() => desktopStore.set({ view: "plan", planTab: "pending" })}>
        {COPY["plan.review.title"]}
      </Button>
      {pending.length ? (
        <ul className="zz-list">
          {pending.map((row) => (
            <li
              key={row.item.id}
              data-testid="bible-pending"
              data-conflict={row.item.change === "conflict"}
            >
              <span>{opSummary(row.item.op)}</span>
              {row.item.evidence ? <q className="zz-muted">{row.item.evidence.quote}</q> : null}
              <span className="zz-row">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={readonly || busy !== ""}
                  data-testid="bible-accept"
                  onClick={() => void decide(row, "accept")}
                >
                  {C.bible.accept}
                </Button>
                <Button
                  size="sm"
                  disabled={readonly || busy !== ""}
                  data-testid="bible-reject"
                  onClick={() => void decide(row, "reject")}
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
      <Button
        size="sm"
        data-testid="bible-audit"
        loading={busy === "audit"}
        disabled={chapters === 0}
        onClick={() => void audit()}
      >
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
          <p className="zz-muted" data-testid="bible-findings">
            {C.bible.clean}
          </p>
        )
      ) : null}
    </section>
  );
}
