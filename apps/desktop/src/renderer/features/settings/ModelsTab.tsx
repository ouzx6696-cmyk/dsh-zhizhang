import React, { useState } from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Button, Select } from "@zhizhang/ui/primitives";
import { MODEL_ROLES, type ModelRole, type PublicSettings, type RoleBinding, type RoleBindings } from "../../../shared/settings";
import { askConfirm } from "../../state/confirm";
import { saveModels } from "../../state/controller";
import { notifyError } from "../../format";
import { TextField } from "../workspace/TextField";
import { binding as bindingOf, ConnectionForm, keepConnection } from "./ConnectionForm";
import { Section } from "./fields";

const NONE = "";

function RoleRow({
  role,
  binding,
  settings,
  onChange,
}: {
  role: ModelRole;
  binding: RoleBinding | undefined;
  settings: PublicSettings;
  onChange: (binding: RoleBinding | undefined) => void;
}) {
  const options = [
    { value: NONE, label: role === "writer" ? C.models.unbound : C.models.fallback },
    ...settings.models.connections.map((c) => ({ value: c.id, label: c.label })),
  ];
  return (
    <div className="zz-role" data-testid="model-role" data-role={role}>
      <strong>{C.models.role[role]}</strong>
      <Select
        label={C.models.connection}
        testId={`model-role-${role}-connection`}
        value={binding?.connection ?? NONE}
        options={options}
        onChange={(connection) => onChange(connection ? bindingOf(connection, binding?.model ?? "", binding) : undefined)}
      />
      <TextField
        label={C.models.model}
        value={binding?.model ?? ""}
        disabled={!binding}
        testId={`model-role-${role}-model`}
        onChange={(model) => binding && onChange({ ...binding, model })}
      />
    </div>
  );
}

export function ModelsTab({ settings }: { settings: PublicSettings }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleBindings>(settings.models.roles);
  const [busy, setBusy] = useState(false);
  const connections = settings.models.connections.map(keepConnection);

  const saveRoles = async () => {
    setBusy(true);
    try {
      await saveModels({ connections, roles });
      notify({ tone: "success", text: C.settings.saved });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!(await askConfirm(C.models.removeConfirm))) return;
    const nextRoles: RoleBindings = { ...roles };
    for (const role of MODEL_ROLES) if (nextRoles[role]?.connection === id) nextRoles[role] = undefined;
    try {
      await saveModels({ connections: connections.filter((c) => c.id !== id), roles: nextRoles });
      setRoles(nextRoles);
    } catch (error) {
      notifyError(error);
    }
  };

  if (editing !== null)
    return (
      <Section title={editing ? C.models.editConnection : C.models.addConnection} testId="models-edit">
        <ConnectionForm
          settings={settings}
          connectionId={editing || `c-${Date.now().toString(36)}`}
          bind={!settings.models.roles.writer}
          submitLabel={C.models.saveConnection}
          onSaved={(next) => {
            setRoles(next.models.roles);
            setEditing(null);
          }}
        />
        <Button variant="ghost" onClick={() => setEditing(null)}>
          {C.settings.back}
        </Button>
      </Section>
    );

  return (
    <div className="zz-stack" data-testid="settings-models">
      {!settings.secretsPersisted ? <p className="zz-muted">{C.models.secretsMemory}</p> : null}
      <Section title={C.models.connections}>
        <ul className="zz-list">
          {settings.models.connections.map((c) => (
            <li key={c.id} data-testid="model-connection" data-configured={c.configured || c.keyless}>
              <strong>{c.label}</strong>
              <span className="zz-muted">{c.baseUrl}</span>
              <span className="zz-row">
                <Button size="sm" onClick={() => setEditing(c.id)}>
                  {C.models.edit}
                </Button>
                <Button size="sm" variant="danger" onClick={() => void remove(c.id)}>
                  {C.models.remove}
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <Button data-testid="model-add-connection" onClick={() => setEditing("")}>
          {C.models.addConnection}
        </Button>
      </Section>
      <Section title={C.models.roles}>
        {MODEL_ROLES.map((role) => (
          <RoleRow key={role} role={role} binding={roles[role]} settings={settings} onChange={(binding) => setRoles((r) => ({ ...r, [role]: binding }))} />
        ))}
        <Button variant="primary" data-testid="model-roles-save" loading={busy} onClick={() => void saveRoles()}>
          {C.settings.save}
        </Button>
      </Section>
    </div>
  );
}
