import React, { useEffect, useState } from "react";
import { AppError } from "@zhizhang/core/errors";
import { RemapPreviewSchema, type RemapPreview } from "@zhizhang/fanqie/contracts";
import { SourcePanel } from "./SourcePanel";
import { Button, Dialog } from "@zhizhang/ui/primitives";
import type { PendingItem } from "@zhizhang/fanqie/bible";
import { desktop } from "../../../state/desktop";
import { desktopStore, useDesktop } from "../../../state/store";
import { P, ResourceState, TextField, usePlanResource } from "../shared";
import { titleOf, editedOp, fieldTitle } from "./operations";
import { ResolveChoice } from "./ResolveChoice";
import { DivergenceChoice } from "./DivergenceChoice";
import { PendingFilters } from "./PendingFilters";
import { PendingBatchSelect } from "./PendingBatchSelect";
export function PendingPage({ work, readonly }: { work: string; readonly: boolean }) {
  const focused = useDesktop((state) => state.planFocus);
  const [batch, setBatch] = useState(focused ?? ""),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState(""),
    [change, setChange] = useState<PendingItem["change"] | undefined>(),
    [decision, setDecision] = useState<PendingItem["decision"] | undefined>(),
    [read, setRead] = useState(new Set<string>()),
    [edit, setEdit] = useState<string | null>(null),
    [effective, setEffective] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [showSource, setShowSource] = useState(true);
  const [remap, setRemap] = useState<RemapPreview | null>(null);
  const batches = usePlanResource(() => desktop.workbench("fanqie.pending.list", { work }), work);
  const data = usePlanResource(
    async () =>
      batch
        ? desktop.workbench("fanqie.pending.get", {
            work,
            batch,
            filter: { change, decision },
            page: { offset: page * 50, limit: 50 },
          })
        : null,
    work,
    false,
    `${batch}:${page}:${change}:${decision}`,
  );
  const item = data.value?.items.find((item) => item.id === selected) ?? data.value?.items[0];
  const source = usePlanResource(
    async () =>
      item?.src?.[0]
        ? desktop.workbench("fanqie.import.source", {
            work,
            batch: item.src[0].batch,
            section: item.src[0].section,
            around: item.src[0].quote,
          })
        : null,
    work,
    false,
    item?.id ?? "",
  );
  const currentBatch = batches.value?.batches.find((row) => row.id === batch);
  const canAccept = (row: PendingItem) =>
    row.change !== "diverge" && (row.change !== "conflict" || read.has(row.id));
  const decide = async (value: "accept" | "reject" | "edit", group = false) => {
    if (!item || item.committed || busy || readonly) return;
    const targets = group
      ? (data.value?.items.filter(
          (row) => row.group === item.group && !row.committed && canAccept(row),
        ) ?? [])
      : [item];
    if (value !== "reject" && !canAccept(item)) return;
    setBusy(true);
    setMessage("");
    try {
      await desktop.workbench("fanqie.pending.decide", {
        work,
        batch,
        decisions: targets.map((row) => ({
          id: row.id,
          decision: value,
          ...(currentBatch?.source === "ledger" &&
          /^\d+$/.test(effective.trim()) &&
          Number(effective) > 0
            ? { effectiveFrom: Number(effective) }
            : {}),
          ...(value === "edit" && edit !== null
            ? { edited: editedOp(row.edited ?? row.op, edit) }
            : {}),
        })),
      });
      setEdit(null);
      data.refresh();
      batches.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        document.querySelector("dialog[open]")
      )
        return;
      const items = data.value?.items ?? [],
        index = items.findIndex((row) => row.id === item?.id);
      if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        setSelected(items[Math.min(items.length - 1, index + 1)]?.id ?? "");
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSelected(items[Math.max(0, index - 1)]?.id ?? "");
      }
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        void decide("accept", event.shiftKey);
      }
      if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        void decide("reject");
      }
      if (event.key.toLowerCase() === "e" && item) setEdit(titleOf(item.edited ?? item.op));
      if (event.key === " ") {
        event.preventDefault();
        setShowSource((value) => !value);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });
  const commit = async (remapToken?: string) => {
    setBusy(true);
    setMessage("");
    try {
      const bible = await desktop.workbench("fanqie.bible.get", { work });
      const result = await desktop.workbench("fanqie.pending.commit", {
        work,
        batch,
        expectedRevs: bible.index.files,
        remapToken,
      });
      setMessage(
        result.stale.length ? `${P["plan.stale"]} ${result.stale.join(", ")}` : P["plan.updated"],
      );
      data.refresh();
      batches.refresh();
      setRemap(null);
    } catch (error) {
      if (error instanceof AppError && error.data?.reason === "remap_required")
        setRemap(RemapPreviewSchema(error.data.preview));
      else setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const quote = item?.src?.[0]?.quote ?? item?.evidence?.quote ?? "",
    text = source.value?.text ?? quote;
  return (
    <section data-testid="pending-page">
      {remap ? (
        <Dialog title={P["plan.remapTitle"]} onClose={() => setRemap(null)}>
          <p>{P["plan.remapHint"]}</p>
          {remap.moves.map((move) => (
            <p key={move.id}>
              {move.title}: {move.from} → {move.to}
            </p>
          ))}
          <Button
            disabled={readonly || busy || !!remap.invalid.length}
            onClick={() => void commit(remap.token)}
          >
            {P["plan.confirm"]}
          </Button>
          <Button onClick={() => setRemap(null)}>{P["plan.cancel"]}</Button>
        </Dialog>
      ) : null}
      <ResourceState loading={batches.loading} error={batches.error} retry={batches.refresh} />
      <div className="zz-plan-toolbar">
        <PendingBatchSelect
          batch={batch}
          rows={batches.value?.batches}
          onSelect={(value) => {
            setBatch(value);
            setPage(0);
            setSelected("");
            setRead(new Set());
            setEdit(null);
            setEffective("");
          }}
        />
        <PendingFilters
          change={change}
          decision={decision}
          onChange={(value) => {
            setChange(value);
            setPage(0);
          }}
          onDecision={(value) => {
            setDecision(value);
            setPage(0);
          }}
        />
      </div>
      <ResourceState loading={data.loading && !!batch} error={data.error} retry={data.refresh} />
      <p role="status">{message}</p>
      <div className="zz-plan-columns">
        <div className="zz-plan-list">
          {data.value?.items.map((row) => (
            <Button
              data-testid="proposal-item"
              key={row.id}
              aria-pressed={item?.id === row.id}
              onClick={() => {
                setSelected(row.id);
                setEdit(null);
                setEffective("");
              }}
            >
              {titleOf(row.edited ?? row.op)} · {P[`plan.change.${row.change}`]} ·{" "}
              {P[`plan.decision.${row.decision}`]}
              {row.confidence
                ? ` · ${row.confidence.band === "high" ? "●" : row.confidence.band === "mid" ? "◐" : "○"} ${P[`plan.band.${row.confidence.band}`]}`
                : ""}
              {row.committed ? ` · ${P["plan.committed"]}` : ""}
            </Button>
          ))}
          <div>
            <Button
              disabled={!page}
              onClick={() => {
                setSelected("");
                setEdit(null);
                setEffective("");
                setPage(page - 1);
              }}
            >
              {P["plan.previous"]}
            </Button>
            <Button
              disabled={(page + 1) * 50 >= (data.value?.total ?? 0)}
              onClick={() => {
                setSelected("");
                setEdit(null);
                setEffective("");
                setPage(page + 1);
              }}
            >
              {P["plan.more"]}
            </Button>
          </div>
        </div>
        <div>
          {item ? (
            <>
              <h3>{titleOf(item.edited ?? item.op)}</h3>
              {item.committed ? <p role="status">{P["plan.committed"]}</p> : null}
              {!item.committed &&
              item.notes.some((note) => note.startsWith("import.candidate:")) ? (
                <ResolveChoice
                  work={work}
                  batch={batch}
                  item={item}
                  readonly={readonly}
                  done={() => data.refresh()}
                />
              ) : null}
              {item.diff?.map((diff, i) => (
                <div key={i} className="zz-plan-card">
                  <strong>{fieldTitle(diff.field)}</strong>
                  <p>
                    {P["plan.before"]}: {String(diff.before ?? "")}
                  </p>
                  <p>
                    {P["plan.after"]}: {String(diff.after ?? "")}
                  </p>
                </div>
              ))}
              {item.notes.map((note, index) => (
                <p key={index}>
                  {note.includes("conflict") || note.includes("clash")
                    ? P["plan.noteConflict"]
                    : note.includes("unlocated")
                      ? P["plan.noteUnlocated"]
                      : P["plan.noteReview"]}
                </p>
              ))}
              {item.confidence ? (
                <p>
                  {P["plan.confidence"]}:{" "}
                  {item.confidence.band === "high"
                    ? "●"
                    : item.confidence.band === "mid"
                      ? "◐"
                      : "○"}{" "}
                  {P[`plan.band.${item.confidence.band}`]} ·{" "}
                  {Math.round(item.confidence.score * 100)}%
                </p>
              ) : null}
              {currentBatch?.source === "ledger" ? (
                <TextField label={P["plan.effective"]} value={effective} onChange={setEffective} />
              ) : null}
              {!item.committed && item.change === "diverge" ? (
                <DivergenceChoice
                  work={work}
                  batch={batch}
                  item={item}
                  readonly={readonly}
                  done={() => {
                    data.refresh();
                    batches.refresh();
                  }}
                />
              ) : null}
              {!item.committed && item.change === "conflict" && !read.has(item.id) ? (
                <Button onClick={() => setRead(new Set([...read, item.id]))}>
                  {P["plan.markRead"]}
                </Button>
              ) : null}
              <div className="zz-plan-toolbar">
                <Button
                  disabled={readonly || busy || !!item.committed || !canAccept(item)}
                  data-testid="proposal-accept"
                  onClick={() => void decide("accept")}
                >
                  {P["plan.accept"]}
                </Button>
                <Button
                  disabled={readonly || busy || !!item.committed}
                  onClick={() => void decide("reject")}
                >
                  {P["plan.reject"]}
                </Button>
                <Button
                  disabled={readonly || busy || !!item.committed || !canAccept(item)}
                  onClick={() => setEdit(titleOf(item.edited ?? item.op))}
                >
                  {P["plan.editAccept"]}
                </Button>
              </div>
              {edit !== null ? (
                <>
                  <TextField label={P["plan.after"]} value={edit} onChange={setEdit} multiline />
                  <Button
                    variant="primary"
                    disabled={readonly || busy || !!item.committed}
                    onClick={() => void decide("edit")}
                  >
                    {P["plan.save"]}
                  </Button>
                </>
              ) : null}
              {showSource ? (
                <SourcePanel
                  text={text}
                  quote={quote}
                  onRead={() => setRead(new Set([...read, item.id]))}
                />
              ) : null}
            </>
          ) : (
            <p>{P["plan.empty"]}</p>
          )}
        </div>
      </div>
      <div className="zz-plan-toolbar">
        <Button
          variant="primary"
          data-testid="pending-commit"
          disabled={readonly || busy || !batch}
          onClick={() => void commit()}
        >
          {currentBatch?.source === "ledger" ? P["plan.saveLedger"] : P["plan.commit"]}
        </Button>
        {currentBatch?.source === "import" ? (
          <Button
            disabled={readonly || busy}
            onClick={() =>
              void desktop
                .workbench("fanqie.import.finish", { work, batch })
                .then(() => {
                  batches.refresh();
                  desktopStore.set({ planTab: "import" });
                })
                .catch((error: unknown) => setMessage(String(error)))
            }
          >
            {P["plan.finishImport"]}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
