import { COPY as viewCopy, t as viewText } from "../../../../../../packages/ui/src/copy.js";
import { errorText } from "../../../../../../packages/core/src/errors.js";
import { useConnectionTest } from "./useConnectionTest";
import { AppearanceFields } from "./AppearanceFields";
import { Dialog, Brand, Toggle } from "../../../../../../packages/ui/src/primitives";
import React, { useEffect, useState } from "react";
import { X, FolderOpen, Download, Shield } from "lucide-react";
import { ModelFields } from "./ModelFields";
import type { SystemState } from "../../state/store";
import { desktop } from "../../state/desktop";
import { askConfirm } from "../../state/confirm";
const api = desktop;
type SettingsProps = {
  state: SystemState;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  canRestart: () => boolean;
  onWorkspace: () => void | Promise<void>;
  onImport: (mode: "fanqie" | "toutiao") => void | Promise<void>;
};
export function Settings({
  state,
  onClose,
  onSaved,
  onWorkspace,
  onImport,
  canRestart,
}: SettingsProps) {
  const [tab, setTab] = useState("models"),
    [models, setModels] = useState(state.models),
    [appearance, setAppearance] = useState(state.appearance),
    [preferences, setPreferences] = useState<string | null>(null),
    [searchKey, setSearchKey] = useState(""),
    [searchProvider, setSearchProvider] = useState(state.searchProvider),
    [searchMode, setSearchMode] = useState(state.searchMode),
    [searchKeyChanged, setSearchKeyChanged] = useState(false),
    [health, setHealth] = useState<Awaited<ReturnType<typeof api.storageHealth>> | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [updates, setUpdates] = useState(state.updates);
  const { results: test, run: testConnection } = useConnectionTest();
  const [searchChanged, setSearchChanged] = useState(false);
  const [editorLinked, setEditorLinked] = useState(
    JSON.stringify(state.models.editor) === JSON.stringify(state.models.writer),
  );
  const [roleTab, setRoleTab] = useState<"writer" | "editor" | "planner">("writer");
  useEffect(() => {
    setPreferences(null);
    api
      .preferences()
      .then(setPreferences)
      .catch((error) => setMessage(errorText(error)));
  }, [state.workspace]);
  useEffect(() => {
    const unsubscribe = api.subscribe((value) => {
      if (value.updates) setUpdates(value.updates);
    });
    return unsubscribe;
  }, []);
  const action = async (operation: () => unknown | Promise<unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await operation();
      if (result && typeof result === "object" && "file" in result)
        setMessage(viewCopy.settingsDialogText1 + result.file);
      return result;
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const testSearch = () => action(async () => {
    const result = await api.testSearch(searchKeyChanged ? searchKey : undefined, searchProvider, searchMode);
    setMessage(viewCopy.searchTestSuccess + result.results + (result.cost === undefined ? viewCopy.searchPriceUnknown : ` · $${result.cost}`));
  });
  const testRole = (role: "writer" | "editor" | "planner") => {
    const model = models[role];
    if (model) void testConnection(role, model);
  };
  const save = () =>
    action(async () => {
      if (JSON.stringify(models) !== JSON.stringify(state.models)) await api.model(models);
      await api.appearance(appearance);
      if (state.workspace && preferences !== null) await api.preferences(preferences);
      if (searchChanged) await api.search(searchKeyChanged ? searchKey : undefined, searchProvider, searchMode);
      await onSaved();
      onClose();
    });
  return (
    <Dialog title={viewCopy.settingsDialogText2} className="studio-settings" onClose={onClose}>
      <header>
        <h2>{viewCopy.settingsDialogText2}</h2>
        <button className="icon-button" aria-label={viewCopy.settingsDialogText3} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="settings-body">
        <nav className="settings-nav" aria-label={viewCopy.settingsDialogText4}>
          {[
            ["models", viewCopy.modelFieldsText5],
            ["workspace", viewCopy.workspace],
            ["appearance", viewCopy.settingsDialogText5],
            ["shortcuts", viewCopy.settingsDialogText6],
            ["resources", viewCopy.settingsDialogText7],
            ["about", viewCopy.settingsDialogText8],
          ].map(([id, label]) => (
            <button
              aria-current={tab === id ? "page" : undefined}
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "models" && (
            <>
              <p className="form-note">{viewCopy.settingsDialogText9}</p>
              {!state.secureStorage && (
                <p className="form-warning">
                  <Shield size={16} />
                  {viewCopy.settingsDialogText10}
                </p>
              )}
              <div className="role-tabs" role="tablist" aria-label={viewCopy.settingsDialogText11}>
                {(["writer", "editor", "planner"] as const).map((role) => (
                  <button
                    key={role}
                    role="tab"
                    aria-selected={roleTab === role}
                    className={roleTab === role ? "active" : ""}
                    onClick={() => setRoleTab(role)}
                  >
                    {role === "writer"
                      ? viewCopy.modelFieldsText1
                      : role === "editor"
                        ? viewCopy.modelFieldsText2
                        : viewCopy.tabInspiration}
                  </button>
                ))}
              </div>
              {roleTab === "editor" && (
                <Toggle
                  label={viewCopy.settingsDialogText12}
                  checked={editorLinked}
                  onChange={(checked: boolean) => {
                    setEditorLinked(checked);
                    if (checked)
                      setModels((previous) => ({
                        ...previous,
                        editor: { ...previous.writer },
                      }));
                  }}
                />
              )}
              {roleTab !== "planner" ? (
                <ModelFields
                  role={roleTab}
                  model={models[roleTab]}
                  onChange={(value) => {
                    if (roleTab === "editor") setEditorLinked(false);
                    setModels((previous) => ({
                      ...previous,
                      [roleTab]: value,
                      ...(roleTab === "writer" && editorLinked ? { editor: { ...value } } : {}),
                    }));
                  }}
                  onTest={() => testRole(roleTab)}
                  result={test[roleTab]}
                />
              ) : models.planner ? (
                <>
                  <ModelFields
                    role="planner"
                    model={models.planner}
                    onChange={(value) => setModels((previous) => ({ ...previous, planner: value }))}
                    onTest={() => testRole("planner")}
                    result={test.planner}
                  />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => setModels((previous) => ({ ...previous, planner: null }))}
                    />
                    {viewCopy.settingsDialogText13}
                  </label>
                </>
              ) : (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() =>
                      setModels((previous) => ({
                        ...previous,
                        planner: { ...previous.writer, apiKey: "" },
                      }))
                    }
                  />
                  {viewCopy.settingsDialogText14}
                </label>
              )}
            </>
          )}
          {tab === "workspace" && (
            <>
              <h3>{viewCopy.workspace}</h3>
              <p className="path-label">{state.workspace || viewCopy.settingsDialogText15}</p>
              <p className="form-note">{viewCopy.settingsDialogText16}</p>
              <div className="button-row">
                <button onClick={() => action(onWorkspace)}>
                  <FolderOpen size={16} />
                  {viewCopy.onboardingText4}
                </button>
                <button onClick={() => action(() => onImport("fanqie"))}>
                  {viewCopy.settingsDialogText17}
                </button>
                <button onClick={() => action(() => onImport("toutiao"))}>
                  {viewCopy.settingsDialogText18}
                </button>
              </div>
              <h3>{viewCopy.settingsDialogText19}</h3>
              <p className="form-note">{viewCopy.settingsDialogText20}</p>
              <textarea
                className="preferences-editor"
                value={preferences ?? ""}
                disabled={preferences === null}
                onChange={(event) => setPreferences(event.target.value)}
                placeholder={viewCopy.settingsDialogText21}
              />
              <h3>{viewCopy.settingsDialogText22}</h3>
              <button
                disabled={busy}
                onClick={() => action(async () => setHealth(await api.storageHealth()))}
              >
                {viewCopy.settingsDialogText23}
              </button>
              {health && (
                <div role="status">
                  <p>
                    {health.label}：{health.reason}
                  </p>
                  {health.files.map((item) => (
                    <p key={item.file}>
                      {item.file}：{item.state}
                    </p>
                  ))}
                  {health.canRecover && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        action(async () => {
                          const result = await api.recover({
                            id: health.id,
                            fingerprint: health.fingerprint,
                          });
                          setHealth(await api.storageHealth());
                          return result;
                        })
                      }
                    >
                      {viewCopy.settingsDialogText24}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {tab === "appearance" && (
            <AppearanceFields appearance={appearance} onChange={setAppearance} />
          )}
          {tab === "shortcuts" && (
            <div>
              <h3>{viewCopy.settingsDialogText25}</h3>
              <p>
                <kbd>Ctrl K</kbd>
                {viewCopy.settingsDialogText26}
              </p>
              <p>
                <kbd>Ctrl S</kbd>
                {viewCopy.settingsDialogText27}
              </p>
              <p>
                <kbd>Ctrl 1 / 2 / 3</kbd>
                {viewCopy.settingsDialogText28}
              </p>
              <p>
                <kbd>Esc</kbd>
                {viewCopy.settingsDialogText29}
              </p>
              <p>{viewCopy.settingsDialogText30}</p>
            </div>
          )}
          {tab === "about" && (
            <div>
              <Brand />
              <h3>
                {viewCopy.settingsDialogText31}
                {state.version}
              </h3>
              <p>{viewCopy.settingsDialogText32}</p>
              <h3>{viewCopy.settingsDialogText33}</h3>
              <p>
                {updates.state === "available"
                  ? viewText("settingsDialogText34", { value0: updates.version })
                  : updates.state === "downloaded"
                    ? viewCopy.settingsDialogText35
                    : updates.state === "downloading"
                      ? viewText("settingsDialogText36", { value0: updates.percent })
                      : updates.message || viewCopy.settingsDialogText37}
              </p>
              <div className="button-row">
                <button onClick={() => action(() => api.updates())}>
                  {viewCopy.settingsDialogText38}
                </button>
                {updates.state === "available" && (
                  <button onClick={() => action(() => api.updates("download"))}>
                    <Download size={16} />
                    {viewCopy.settingsDialogText39}
                  </button>
                )}
                {updates.state === "downloaded" && (
                  <button
                    onClick={async () => {
                      if (canRestart() && (await askConfirm(viewCopy.settingsDialogText40)))
                        void action(() => api.updates("install"));
                    }}
                  >
                    {viewCopy.settingsDialogText41}
                  </button>
                )}
              </div>
            </div>
          )}
          {tab === "resources" && (
            <>
              <button disabled={busy} onClick={() => action(() => api.backup())}>
                {viewCopy.settingsDialogText42}
              </button>
              <h3>{viewCopy.settingsDialogText43}</h3>
              <p className="form-note">{viewCopy.settingsDialogText44}</p>
              <label>{viewCopy.searchSettingsText1}<select value={searchProvider} onChange={e => { setSearchProvider(e.target.value === "exa" ? "exa" : "tavily"); setSearchChanged(true); }}><option value="exa">Exa</option><option value="tavily">Tavily</option></select></label>
              <label>{viewCopy.searchSettingsText2}<select value={searchMode} onChange={e => { setSearchMode(e.target.value === "auto" ? "auto" : "lite"); setSearchChanged(true); }}><option value="lite">{viewCopy.searchSettingsText3}</option><option value="auto">{viewCopy.searchSettingsText4}</option></select></label>
              <label>{searchProvider} API Key
                <input
                  type="password"
                  value={searchKey}
                  onChange={(event) => {
                    setSearchKey(event.target.value);
                    setSearchKeyChanged(true);
                    setSearchChanged(true);
                  }}
                  placeholder={
                    state.searchConfigured
                      ? viewCopy.settingsDialogText45
                      : viewCopy.settingsDialogText46
                  }
                />
              </label>
              <p className="form-note">{viewCopy.searchTestFee}</p>
              <button disabled={busy} onClick={() => void testSearch()}>{viewCopy.searchTestButton}</button>
              <button
                disabled={busy}
                onClick={() => {
                  setSearchKey("");
                  setSearchKeyChanged(true);
                  setSearchChanged(true);
                }}
              >
                {viewCopy.settingsDialogText47}
              </button>
              <h3>{viewCopy.settingsDialogText48}</h3>
              <p className="form-note">{viewCopy.settingsDialogText49}</p>
              <button onClick={() => action(() => api.diagnostics())}>
                {viewCopy.settingsDialogText50}
              </button>
            </>
          )}
        </div>
      </div>
      {message && (
        <p className="form-note" role="status">
          {message}
        </p>
      )}
      <footer>
        <button onClick={onClose}>{viewCopy.cancel}</button>
        <button className="primary" disabled={busy} onClick={save}>
          {viewCopy.settingsDialogText51}
        </button>
      </footer>
    </Dialog>
  );
}
