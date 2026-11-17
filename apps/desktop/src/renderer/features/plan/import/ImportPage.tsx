import React, { useEffect, useState } from "react";
import { Button, Dialog } from "@zhizhang/ui/primitives";
import { SectionKindSchema, type ImportBatchView } from "@zhizhang/fanqie/contracts";
import { TextEncodingSchema } from "@zhizhang/core/text/schema";
import { desktop } from "../../../state/desktop";
import { desktopStore } from "../../../state/store";
import { P, ResourceState, TextField, usePlanResource } from "../shared";
const sectionKinds = [
  "outline-volume",
  "outline-act",
  "outline-chapter",
  "setting-character",
  "setting-faction",
  "setting-place",
  "setting-power",
  "setting-item",
  "setting-rule",
  "setting-term",
  "timeline",
  "mixed",
  "ignore",
  "unknown",
];
const sectionKindLabels: Record<string, string> = {
  "outline-volume": P["plan.importKind.outline-volume"],
  "outline-act": P["plan.importKind.outline-act"],
  "outline-chapter": P["plan.importKind.outline-chapter"],
  "setting-character": P["plan.importKind.setting-character"],
  "setting-faction": P["plan.importKind.setting-faction"],
  "setting-place": P["plan.importKind.setting-place"],
  "setting-power": P["plan.importKind.setting-power"],
  "setting-item": P["plan.importKind.setting-item"],
  "setting-rule": P["plan.importKind.setting-rule"],
  "setting-term": P["plan.importKind.setting-term"],
  timeline: P["plan.importKind.timeline"],
  mixed: P["plan.importKind.mixed"],
  ignore: P["plan.importKind.ignore"],
  unknown: P["plan.importKind.unknown"],
};
export function ImportPage({ work, readonly }: { work: string; readonly: boolean }) {
  const data = usePlanResource(() => desktop.workbench("fanqie.import.list", { work }), work);
  const [view, setView] = useState<ImportBatchView | null>(null),
    [step, setStep] = useState<"sections" | "estimate" | "running">("sections"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mapping, setMapping] = useState(false),
    [volume, setVolume] = useState(""),
    [act, setAct] = useState(""),
    [chapter, setChapter] = useState(""),
    [ignore, setIgnore] = useState("");
  useEffect(() => {
    const updated = data.value?.batches.find((row) => row.batch === view?.batch);
    if (updated) setView(updated);
  }, [data.value, view?.batch]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const pick = () =>
    action(async () => {
      const file = await desktop.pickImport();
      if (!file) return;
      const result = await desktop.workbench("fanqie.import.stage", { work, token: file.token });
      setView(result);
      setStep("sections");
      data.refresh();
    });
  const select = (
    sections: { id: string; selected: boolean; kind?: ReturnType<typeof SectionKindSchema> }[],
  ) =>
    action(async () => {
      if (!view) return;
      setView(
        await desktop.workbench("fanqie.import.select", { work, batch: view.batch, sections }),
      );
      data.refresh();
    });
  const start = () =>
    action(async () => {
      if (!view?.estimate) return;
      await desktop.startRun(
        { mode: "fanqie", path: work },
        {
          kind: "fanqie.import",
          request: {
            batch: view.batch,
            sections: view.segments
              .filter((row) => row.selected && row.kind !== "ignore")
              .map((row) => row.id),
            estimate: {
              inputMax: view.estimate.tokens.inputMax,
              outputMax: view.estimate.tokens.outputMax,
            },
          },
        },
      );
      setStep("running");
      data.refresh();
    });
  const resegment = () =>
    action(async () => {
      if (!view) return;
      const lines = (text: string) =>
        text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
      setView(
        await desktop.workbench("fanqie.import.resegment", {
          work,
          batch: view.batch,
          rules: {
            volume: lines(volume),
            act: lines(act),
            chapter: lines(chapter),
            ignore: lines(ignore),
          },
        }),
      );
      setMapping(false);
      data.refresh();
    });
  return (
    <section data-testid="import-page">
      <ResourceState loading={data.loading} error={data.error} retry={data.refresh} />
      <div className="zz-plan-toolbar">
        <Button data-testid="import-pick" disabled={readonly || busy} onClick={() => void pick()}>
          {P["plan.pickFile"]}
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="zz-plan-columns">
        <div className="zz-plan-list">
          {data.value?.batches.map((batch) => (
            <Button
              key={batch.batch}
              aria-pressed={view?.batch === batch.batch}
              onClick={() => {
                setView(batch);
                setStep(batch.status === "running" ? "running" : "sections");
              }}
            >
              {batch.source.name} · {P[`plan.status.${batch.status}`]}
            </Button>
          ))}
        </div>
        <div>
          {view ? (
            <>
              <h3>{view.source.name}</h3>
              {view.duplicateOf ? <p>{P["plan.duplicate"]}</p> : null}
              {view.source.bytes > 900000 ? <p>{P["plan.longSource"]}</p> : null}
              {view.status === "reviewing" ||
              view.status === "partial" ||
              view.status === "closed" ? (
                <Button
                  data-testid="import-review"
                  onClick={() => desktopStore.set({ planTab: "pending", planFocus: view.batch })}
                >
                  {P["plan.review"]}
                </Button>
              ) : null}
              {view.failedChunks.length ? (
                <div>
                  <p>
                    {P["plan.failedChunks"]}: {view.failedChunks.join(", ")}
                  </p>
                  <Button
                    disabled={readonly || busy}
                    onClick={() =>
                      void action(async () => {
                        await desktop.workbench("fanqie.import.retryChunks", {
                          work,
                          batch: view.batch,
                          chunks: view.failedChunks,
                        });
                        data.refresh();
                      })
                    }
                  >
                    {P["plan.retryChunks"]}
                  </Button>
                </div>
              ) : null}
              {step === "running" || view.status === "running" ? (
                <p role="status">{P["plan.running"]}</p>
              ) : step === "sections" ? (
                <>
                  <h4>{P["plan.sections"]}</h4>
                  {view.source.encodingConfidence < 0.8 ? (
                    <p role="alert">{P["plan.encodingWarning"]}</p>
                  ) : null}
                  <label className="zz-plan-field">
                    {P["plan.encoding"]}
                    <select
                      value={view.source.encoding}
                      disabled={readonly || busy || view.status !== "staged"}
                      onChange={(event) => {
                        const encoding = TextEncodingSchema(event.target.value);
                        void action(async () => {
                          setView(
                            await desktop.workbench("fanqie.import.resegment", {
                              work,
                              batch: view.batch,
                              rules: {},
                              encoding,
                            }),
                          );
                          data.refresh();
                        });
                      }}
                    >
                      {["utf-8", "utf-16le", "utf-16be", "gb18030", "big5"].map((encoding) => (
                        <option key={encoding}>{encoding}</option>
                      ))}
                    </select>
                  </label>
                  {view.source.encodingConfidence < 0.8
                    ? view.encodingCandidates?.map((candidate) => (
                        <details key={candidate.encoding}>
                          <summary>{candidate.encoding}</summary>
                          <pre>{candidate.preview}</pre>
                        </details>
                      ))
                    : null}
                  <div className="zz-plan-toolbar">
                    <Button
                      disabled={readonly || busy || view.status !== "staged"}
                      onClick={() =>
                        void select(view.segments.map((row) => ({ id: row.id, selected: true })))
                      }
                    >
                      {P["plan.all"]}
                    </Button>
                    <Button
                      disabled={readonly || busy || view.status !== "staged"}
                      onClick={() => setMapping(true)}
                    >
                      {P["plan.mapping"]}
                    </Button>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>{P["plan.sections"]}</th>
                        <th>{P["plan.kind"]}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.segments.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <label>
                              <input
                                data-testid="import-section"
                                type="checkbox"
                                checked={row.selected}
                                disabled={readonly || busy || view.status !== "staged"}
                                onChange={(event) =>
                                  void select([{ id: row.id, selected: event.target.checked }])
                                }
                              />
                              {row.title || row.id}
                            </label>
                          </td>
                          <td>
                            <select
                              aria-label={P["plan.kind"]}
                              value={row.kind}
                              disabled={readonly || busy || view.status !== "staged"}
                              onChange={(event) =>
                                void select([
                                  {
                                    id: row.id,
                                    selected: row.selected,
                                    kind: SectionKindSchema(event.target.value),
                                  },
                                ])
                              }
                            >
                              {sectionKinds.map((kind) => (
                                <option key={kind} value={kind}>
                                  {sectionKindLabels[kind]}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Button
                    data-testid="import-next"
                    disabled={
                      readonly ||
                      busy ||
                      !view.segments.some((row) => row.selected && row.kind !== "ignore") ||
                      view.source.encodingConfidence < 0.5
                    }
                    onClick={() => setStep("estimate")}
                  >
                    {P["plan.next"]}
                  </Button>
                </>
              ) : (
                <>
                  <h4>{P["plan.estimate"]}</h4>
                  <dl>
                    <dt>{P["plan.inputTokens"]}</dt>
                    <dd>
                      {view.estimate?.tokens.inputMin}–{view.estimate?.tokens.inputMax}
                    </dd>
                    <dt>{P["plan.outputTokens"]}</dt>
                    <dd>
                      {view.estimate?.tokens.outputMin}–{view.estimate?.tokens.outputMax}
                    </dd>
                    <dt>{P["plan.runBudget"]}</dt>
                    <dd>{view.estimate?.runBudget}</dd>
                  </dl>
                  <p>{P["plan.noPrice"]}</p>
                  <Button
                    variant="primary"
                    disabled={readonly || busy || view.status !== "staged"}
                    data-testid="import-start"
                    onClick={() => void start()}
                  >
                    {P["plan.startImport"]}
                  </Button>
                  <Button onClick={() => setStep("sections")}>{P["plan.previous"]}</Button>
                </>
              )}
              {view.status !== "reverted" && view.status !== "running" ? (
                <Button
                  disabled={readonly || busy}
                  onClick={() =>
                    void action(async () => {
                      await desktop.workbench("fanqie.import.revert", { work, batch: view.batch });
                      data.refresh();
                    })
                  }
                >
                  {P["plan.revertImport"]}
                </Button>
              ) : null}
            </>
          ) : (
            <p>{P["plan.empty"]}</p>
          )}
        </div>
      </div>
      {mapping ? (
        <Dialog title={P["plan.mapping"]} onClose={() => setMapping(false)}>
          <TextField label={P["plan.mapVolume"]} value={volume} onChange={setVolume} multiline />
          <TextField label={P["plan.mapAct"]} value={act} onChange={setAct} multiline />
          <TextField label={P["plan.mapChapter"]} value={chapter} onChange={setChapter} multiline />
          <TextField label={P["plan.mapIgnore"]} value={ignore} onChange={setIgnore} multiline />
          <Button variant="primary" disabled={busy || readonly} onClick={() => void resegment()}>
            {P["plan.resegment"]}
          </Button>
        </Dialog>
      ) : null}
    </section>
  );
}
