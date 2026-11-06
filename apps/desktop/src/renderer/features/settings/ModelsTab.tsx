import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import { Toggle } from "../../../../../../packages/ui/src/primitives";
import React from "react";
import { Shield } from "lucide-react";
import { ModelFields } from "./ModelFields";
import type { ConnectionResult, SystemModels } from "../../state/store";

type Role = "writer" | "editor" | "planner";

export function ModelsTab({
  models,
  setModels,
  secureStorage,
  roleTab,
  setRoleTab,
  editorLinked,
  setEditorLinked,
  results,
  onTest,
}: {
  models: SystemModels;
  setModels: (update: (previous: SystemModels) => SystemModels) => void;
  secureStorage: boolean;
  roleTab: Role;
  setRoleTab: (role: Role) => void;
  editorLinked: boolean;
  setEditorLinked: (linked: boolean) => void;
  results: Partial<Record<Role, ConnectionResult>>;
  onTest: (role: Role) => void;
}) {
  return (
    <>
      <p className="form-note">{viewCopy.settingsDialogText9}</p>
      {!secureStorage && (
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
          onTest={() => onTest(roleTab)}
          result={results[roleTab]}
        />
      ) : models.planner ? (
        <>
          <ModelFields
            role="planner"
            model={models.planner}
            onChange={(value) => setModels((previous) => ({ ...previous, planner: value }))}
            onTest={() => onTest("planner")}
            result={results.planner}
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
  );
}
