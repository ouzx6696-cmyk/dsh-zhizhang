import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import React, { useEffect, useState } from "react";
import { errorText } from "../../../../../../packages/core/src/errors.js";
import type { SystemState } from "../../state/store";
import { desktop } from "../../state/desktop";

type Action = (operation: () => unknown) => Promise<unknown>;

/** 搜索设置草稿：keyChanged 区分“保留已存 Key”与“改成新值（含清空）”。 */
export type SearchDraft = {
  provider: SystemState["searchProvider"];
  mode: SystemState["searchMode"];
  key: string;
  keyChanged: boolean;
  changed: boolean;
};

export function initialSearchDraft(state: SystemState): SearchDraft {
  return {
    provider: state.searchProvider,
    mode: state.searchMode,
    key: "",
    keyChanged: false,
    changed: false,
  };
}

function LibraryStorage({ scope, busy, action }: { scope: string; busy: boolean; action: Action }) {
  const [location, setLocation] = useState<Awaited<
    ReturnType<typeof desktop.libraryStorage>
  > | null>(null);
  const [message, setMessage] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [opening, setOpening] = useState({
    anomalyRatio: 0.4,
    abilityChapter: 3,
    firstPayoffChapter: 3,
  });
  useEffect(() => {
    let current = true;
    setLocation(null);
    setMessage("");
    void desktop
      .libraryStorage()
      .then((result) => {
        if (current) {
          setLocation(result);
          setSourceId(result.benchmark?.sourceId ?? "");
          if (result.benchmark?.opening) setOpening(result.benchmark.opening);
        }
      })
      .catch((error) => {
        if (current) setMessage(errorText(error));
      });
    return () => {
      current = false;
    };
  }, [scope]);
  const run = (operation: "open" | "import" | "benchmark" | "clear-benchmark") =>
    action(async () => {
      const result = await desktop.libraryStorage(
        operation,
        operation === "benchmark" ? sourceId : undefined,
      );
      setLocation(result);
      if (result.imported) setSourceId(result.imported.id);
      if (operation === "benchmark" && result.benchmark)
        setMessage(viewCopy.libraryBenchmarkSaved + result.benchmark.sampledChapters);
      if (operation === "clear-benchmark") {
        setSourceId("");
        setMessage("");
      }
      if (result.imported)
        setMessage(
          viewCopy.libraryStorageImported +
            result.imported.title +
            "（" +
            result.imported.id +
            "）",
        );
    });
  return (
    <section>
      <h3>{viewCopy.libraryStorageTitle}</h3>
      <p className="form-note">{viewCopy.libraryStorageNote}</p>
      {location && (
        <p>
          <label>
            {viewCopy.libraryStorageScope}
            <input readOnly value={location.root} />
          </label>
        </p>
      )}
      <button disabled={busy || !location} onClick={() => void run("open")}>
        {viewCopy.libraryStorageOpen}
      </button>
      <button disabled={busy || !location} onClick={() => void run("import")}>
        {viewCopy.libraryStorageImport}
      </button>
      <label>
        {viewCopy.libraryBenchmarkSelect}
        <select
          value={sourceId}
          disabled={busy || !location}
          onChange={(event) => setSourceId(event.target.value)}
        >
          <option value="">{viewCopy.libraryBenchmarkSelect}</option>
          {(location?.sources ?? []).map((source) => (
            <option key={source.id} value={source.id}>
              {source.title}
            </option>
          ))}
        </select>
      </label>
      <p className="form-note">{viewCopy.libraryBenchmarkNote}</p>
      {location && !location.canBenchmark && (
        <p className="form-note">{viewCopy.libraryBenchmarkNeedsWork}</p>
      )}
      <button
        disabled={busy || !sourceId || !location?.canBenchmark}
        onClick={() => void run("benchmark")}
      >
        {viewCopy.libraryBenchmark}
      </button>
      <button disabled={busy || !location?.benchmark} onClick={() => void run("clear-benchmark")}>
        {viewCopy.libraryBenchmarkClear}
      </button>
      {location?.benchmark && (
        <fieldset disabled={busy || sourceId !== location.benchmark.sourceId}>
          <label>
            {viewCopy.libraryOpeningAnomaly}
            <input
              type="number"
              min="0"
              max="100"
              value={opening.anomalyRatio * 100}
              onChange={(event) =>
                setOpening({ ...opening, anomalyRatio: Number(event.target.value) / 100 })
              }
            />
          </label>
          <label>
            {viewCopy.libraryOpeningAbility}
            <input
              type="number"
              min="1"
              value={opening.abilityChapter}
              onChange={(event) =>
                setOpening({ ...opening, abilityChapter: Number(event.target.value) })
              }
            />
          </label>
          <label>
            {viewCopy.libraryOpeningPayoff}
            <input
              type="number"
              min="1"
              value={opening.firstPayoffChapter}
              onChange={(event) =>
                setOpening({ ...opening, firstPayoffChapter: Number(event.target.value) })
              }
            />
          </label>
          <button
            onClick={() =>
              void action(async () => {
                setLocation(await desktop.libraryStorage("benchmark-opening", undefined, opening));
                setMessage(viewCopy.libraryOpeningSave);
              })
            }
          >
            {viewCopy.libraryOpeningSave}
          </button>
        </fieldset>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

export function ResourcesTab({
  scope,
  search,
  setSearch,
  configured,
  busy,
  action,
  onMessage,
}: {
  scope: string;
  search: SearchDraft;
  setSearch: (patch: Partial<SearchDraft>) => void;
  configured: boolean;
  busy: boolean;
  action: Action;
  onMessage: (text: string) => void;
}) {
  const testSearch = () =>
    action(async () => {
      const result = await desktop.testSearch(
        search.keyChanged ? search.key : undefined,
        search.provider,
        search.mode,
      );
      onMessage(
        viewCopy.searchTestSuccess +
          result.results +
          (result.cost === undefined ? viewCopy.searchPriceUnknown : ` · $${result.cost}`),
      );
    });
  return (
    <>
      <LibraryStorage scope={scope} busy={busy} action={action} />
      <button disabled={busy} onClick={() => action(() => desktop.backup())}>
        {viewCopy.settingsDialogText42}
      </button>
      <h3>{viewCopy.settingsDialogText43}</h3>
      <p className="form-note">{viewCopy.settingsDialogText44}</p>
      <label>
        {viewCopy.searchSettingsText1}
        <select
          value={search.provider}
          onChange={(e) =>
            setSearch({ provider: e.target.value === "exa" ? "exa" : "tavily", changed: true })
          }
        >
          <option value="exa">Exa</option>
          <option value="tavily">Tavily</option>
        </select>
      </label>
      <label>
        {viewCopy.searchSettingsText2}
        <select
          value={search.mode}
          onChange={(e) =>
            setSearch({ mode: e.target.value === "auto" ? "auto" : "lite", changed: true })
          }
        >
          <option value="lite">{viewCopy.searchSettingsText3}</option>
          <option value="auto">{viewCopy.searchSettingsText4}</option>
        </select>
      </label>
      <label>
        {search.provider} API Key
        <input
          type="password"
          value={search.key}
          onChange={(event) =>
            setSearch({ key: event.target.value, keyChanged: true, changed: true })
          }
          placeholder={configured ? viewCopy.settingsDialogText45 : viewCopy.settingsDialogText46}
        />
      </label>
      <p className="form-note">{viewCopy.searchTestFee}</p>
      <button disabled={busy} onClick={() => void testSearch()}>
        {viewCopy.searchTestButton}
      </button>
      <button
        disabled={busy}
        onClick={() => setSearch({ key: "", keyChanged: true, changed: true })}
      >
        {viewCopy.settingsDialogText47}
      </button>
      <h3>{viewCopy.settingsDialogText48}</h3>
      <p className="form-note">{viewCopy.settingsDialogText49}</p>
      <button onClick={() => action(() => desktop.diagnostics())}>
        {viewCopy.settingsDialogText50}
      </button>
    </>
  );
}
