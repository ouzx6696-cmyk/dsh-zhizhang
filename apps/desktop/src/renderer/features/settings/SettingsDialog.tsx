import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import { errorText } from "../../../../../../packages/core/src/errors.js";
import { useConnectionTest } from "./useConnectionTest";
import { AppearanceFields } from "./AppearanceFields";
import { Dialog } from "../../../../../../packages/ui/src/primitives";
import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { SystemState } from "../../state/store";
import { desktop } from "../../state/desktop";
import { ModelsTab } from "./ModelsTab";
import { WorkspaceTab } from "./WorkspaceTab";
import { ResourcesTab, initialSearchDraft, type SearchDraft } from "./ResourcesTab";
import { AboutTab } from "./AboutTab";
import { ShortcutsTab } from "./ShortcutsTab";

type SettingsProps = {
  state: SystemState;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  canRestart: () => boolean;
  onWorkspace: () => void | Promise<void>;
  onImport: (mode: "fanqie" | "toutiao") => void | Promise<void>;
};

const TABS = [
  ["models", viewCopy.modelFieldsText5],
  ["workspace", viewCopy.workspace],
  ["appearance", viewCopy.settingsDialogText5],
  ["shortcuts", viewCopy.settingsDialogText6],
  ["resources", viewCopy.settingsDialogText7],
  ["about", viewCopy.settingsDialogText8],
] as const;

/** 作者偏好随写作根读取；写作根切换后丢弃旧请求的迟到结果。 */
function usePreferences(workspace: string, onError: (text: string) => void) {
  const [preferences, setPreferences] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setPreferences(null);
    desktop
      .preferences()
      .then((text) => {
        if (current) setPreferences(text);
      })
      .catch((error) => {
        if (current) onError(errorText(error));
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onError 只写本对话框的提示，不随渲染重新读取。
  }, [workspace]);
  return [preferences, setPreferences] as const;
}

export function Settings({
  state,
  onClose,
  onSaved,
  onWorkspace,
  onImport,
  canRestart,
}: SettingsProps) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("models"),
    [models, setModels] = useState(state.models),
    [appearance, setAppearance] = useState(state.appearance),
    [search, setSearchDraft] = useState<SearchDraft>(() => initialSearchDraft(state)),
    [health, setHealth] = useState<Awaited<ReturnType<typeof desktop.storageHealth>> | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [preferences, setPreferences] = usePreferences(state.workspace, setMessage);
  const { results, run: testConnection } = useConnectionTest();
  const [editorLinked, setEditorLinked] = useState(
    JSON.stringify(state.models.editor) === JSON.stringify(state.models.writer),
  );
  const [roleTab, setRoleTab] = useState<"writer" | "editor" | "planner">("writer");
  const setSearch = (patch: Partial<SearchDraft>) =>
    setSearchDraft((previous) => ({ ...previous, ...patch }));
  const action = async (operation: () => unknown) => {
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
  const testRole = (role: "writer" | "editor" | "planner") => {
    const model = models[role];
    if (model) void testConnection(role, model);
  };
  const save = () =>
    action(async () => {
      if (JSON.stringify(models) !== JSON.stringify(state.models)) await desktop.model(models);
      await desktop.appearance(appearance);
      if (state.workspace && preferences !== null) await desktop.preferences(preferences);
      if (search.changed)
        await desktop.search(
          search.keyChanged ? search.key : undefined,
          search.provider,
          search.mode,
        );
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
          {TABS.map(([id, label]) => (
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
            <ModelsTab
              models={models}
              setModels={setModels}
              secureStorage={state.secureStorage}
              roleTab={roleTab}
              setRoleTab={setRoleTab}
              editorLinked={editorLinked}
              setEditorLinked={setEditorLinked}
              results={results}
              onTest={testRole}
            />
          )}
          {tab === "workspace" && (
            <WorkspaceTab
              workspace={state.workspace}
              preferences={preferences}
              setPreferences={setPreferences}
              health={health}
              setHealth={setHealth}
              busy={busy}
              action={action}
              onWorkspace={onWorkspace}
              onImport={onImport}
            />
          )}
          {tab === "appearance" && (
            <AppearanceFields appearance={appearance} onChange={setAppearance} />
          )}
          {tab === "shortcuts" && <ShortcutsTab />}
          {tab === "about" && (
            <AboutTab
              version={state.version}
              updates={state.updates}
              action={action}
              canRestart={canRestart}
            />
          )}
          {tab === "resources" && (
            <ResourcesTab
              search={search}
              setSearch={setSearch}
              configured={state.searchConfigured}
              busy={busy}
              action={action}
              onMessage={setMessage}
            />
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
