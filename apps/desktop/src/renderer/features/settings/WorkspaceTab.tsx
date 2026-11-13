import { COPY as viewCopy } from "@writer/ui/copy";
import React from "react";
import { FolderOpen } from "lucide-react";
import { desktop } from "../../state/desktop";

type Health = Awaited<ReturnType<typeof desktop.storageHealth>>;
type Action = (operation: () => unknown) => Promise<unknown>;

export function WorkspaceTab({
  workspace,
  preferences,
  setPreferences,
  health,
  setHealth,
  busy,
  action,
  onWorkspace,
  onImport,
}: {
  workspace: string;
  preferences: string | null;
  setPreferences: (value: string) => void;
  health: Health | null;
  setHealth: (value: Health) => void;
  busy: boolean;
  action: Action;
  onWorkspace: () => void | Promise<void>;
  onImport: (mode: "fanqie" | "toutiao") => void | Promise<void>;
}) {
  return (
    <>
      <h3>{viewCopy.workspace}</h3>
      <p className="path-label">{workspace || viewCopy.settingsDialogText15}</p>
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
        onClick={() => action(async () => setHealth(await desktop.storageHealth()))}
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
                  const result = await desktop.recover({
                    id: health.id,
                    fingerprint: health.fingerprint,
                  });
                  setHealth(await desktop.storageHealth());
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
  );
}
