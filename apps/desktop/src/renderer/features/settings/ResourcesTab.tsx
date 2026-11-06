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
  useEffect(() => {
    let current = true;
    setLocation(null);
    setMessage("");
    void desktop
      .libraryStorage()
      .then((result) => {
        if (current) setLocation(result);
      })
      .catch((error) => {
        if (current) setMessage(errorText(error));
      });
    return () => {
      current = false;
    };
  }, [scope]);
  const run = (operation: "open" | "import") =>
    action(async () => {
      const result = await desktop.libraryStorage(operation);
      setLocation(result);
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
