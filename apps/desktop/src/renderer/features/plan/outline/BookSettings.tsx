import React, { useState } from "react";
import { Button } from "@zhizhang/ui/primitives";
import { desktop } from "../../../state/desktop";
import { P, ResourceState, TextField, usePlanResource, usePlanDirty } from "../shared";
const ledgerModes: Array<"auto" | "ask" | "off"> = ["auto", "ask", "off"];
export function BookSettings({ work, readonly }: { work: string; readonly: boolean }) {
  const [dirty, setDirty] = useState(false),
    [message, setMessage] = useState("");
  const [budget, setBudget] = useState<string | undefined>(undefined),
    [window, setWindow] = useState<string | undefined>(undefined),
    [forget, setForget] = useState<string | undefined>(undefined),
    [terminal, setTerminal] = useState<string | undefined>(undefined),
    [title, setTitle] = useState<string | undefined>(undefined),
    [conflict, setConflict] = useState<string | undefined>(undefined);
  const [logline, setLogline] = useState<string | undefined>(),
    [sellingPoints, setSellingPoints] = useState<string | undefined>(),
    [wordTarget, setWordTarget] = useState<string | undefined>();
  const [mode, setMode] = useState<"auto" | "ask" | "off" | "">("");
  const data = usePlanResource(
    async () => {
      const [meta, outline] = await Promise.all([
        desktop.workbench("fanqie.work.get", { work }),
        desktop.workbench("fanqie.outline.get", { work }),
      ]);
      return { meta, outline };
    },
    work,
    dirty,
  );
  usePlanDirty(dirty, () => {
    setDirty(false);
  });
  const settings = data.value?.meta.settings;
  return (
    <details>
      <summary>{P["plan.book"]}</summary>
      <ResourceState loading={data.loading} error={data.error} retry={data.refresh} />
      <form
        onChange={() => setDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!data.value) return;
          const snapshot = data.value;
          void (async () => {
            try {
              await desktop.workbench("fanqie.work.settings", {
                work,
                ledger: mode || settings?.ledger || "auto",
                contextBudget: Number(budget ?? settings?.contextBudget) || undefined,
                recentFactsWindow: Number(window ?? settings?.recentFactsWindow ?? 5),
                threadForgetAfter: Number(forget ?? settings?.threadForgetAfter ?? 10),
                terminalStates:
                  terminal !== undefined
                    ? terminal.split("\n").filter(Boolean)
                    : settings?.terminalStates,
              });
              await desktop.workbench("fanqie.outline.apply", {
                work,
                expectedRev: snapshot.outline.rev,
                ops: [
                  {
                    type: "book.update",
                    patch: {
                      title: title ?? snapshot.outline.book.title,
                      logline: logline ?? snapshot.outline.book.logline,
                      sellingPoints:
                        sellingPoints === undefined
                          ? snapshot.outline.book.sellingPoints
                          : sellingPoints.split("\n").filter(Boolean),
                      wordTarget:
                        wordTarget === undefined
                          ? snapshot.outline.book.wordTarget
                          : Number(wordTarget) || undefined,
                      coreConflict: conflict ?? snapshot.outline.book.coreConflict,
                    },
                    expectedRev: snapshot.outline.book.rev,
                  },
                ],
              });
              setDirty(false);
              setMessage(P["plan.updated"]);
              data.refresh();
            } catch (error) {
              setMessage(String(error));
            }
          })();
        }}
      >
        <TextField
          label={P["plan.title"]}
          value={title ?? data.value?.outline.book.title ?? ""}
          onChange={setTitle}
          disabled={readonly}
        />
        <TextField
          label={P["plan.coreConflict"]}
          value={conflict ?? data.value?.outline.book.coreConflict ?? ""}
          onChange={setConflict}
          multiline
          disabled={readonly}
        />
        <TextField
          label={P["plan.logline"]}
          value={logline ?? data.value?.outline.book.logline ?? ""}
          onChange={setLogline}
          disabled={readonly}
        />
        <TextField
          label={P["plan.sellingPoints"]}
          value={sellingPoints ?? data.value?.outline.book.sellingPoints?.join("\n") ?? ""}
          onChange={setSellingPoints}
          disabled={readonly}
          multiline
        />
        <TextField
          label={P["plan.target"]}
          value={wordTarget ?? String(data.value?.outline.book.wordTarget ?? "")}
          onChange={setWordTarget}
          disabled={readonly}
        />
        <label>
          {P["plan.ledgerMode"]}
          <select
            value={mode || settings?.ledger || "auto"}
            disabled={readonly}
            onChange={(event) => {
              const value = event.target.value;
              setMode(value === "ask" || value === "off" ? value : "auto");
            }}
          >
            {ledgerModes.map((mode) => (
              <option key={mode} value={mode}>
                {P[`plan.ledger.${mode}`]}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label={P["plan.contextBudget"]}
          value={budget ?? String(settings?.contextBudget ?? "")}
          onChange={setBudget}
          disabled={readonly}
        />
        <TextField
          label={P["plan.factsWindow"]}
          value={window ?? String(settings?.recentFactsWindow ?? 5)}
          onChange={setWindow}
          disabled={readonly}
        />
        <TextField
          label={P["plan.threadWindow"]}
          value={forget ?? String(settings?.threadForgetAfter ?? 10)}
          onChange={setForget}
          disabled={readonly}
        />
        <TextField
          label={P["plan.terminalStates"]}
          value={terminal ?? settings?.terminalStates?.join("\n") ?? ""}
          onChange={setTerminal}
          multiline
          disabled={readonly}
        />
        <Button type="submit" variant="primary" disabled={readonly || !dirty}>
          {P["plan.save"]}
        </Button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}
