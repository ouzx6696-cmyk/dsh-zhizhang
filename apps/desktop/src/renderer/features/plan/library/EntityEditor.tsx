import React, { useState } from "react";
import { Button } from "@zhizhang/ui/primitives";
import { EntityKindSchema, type Entity } from "@zhizhang/fanqie/contracts";
import { P, TextField, browserId } from "../shared";
const kinds: Entity["kind"][] = ["character", "faction", "place", "power", "item", "rule", "term"];
export function EntityEditor({
  entity,
  readonly,
  save,
  cancel,
  dirty,
}: {
  entity?: Entity;
  readonly: boolean;
  save: (value: Entity) => Promise<void>;
  cancel: () => void;
  dirty: () => void;
}) {
  const [name, setName] = useState(entity?.name ?? ""),
    [summary, setSummary] = useState(entity?.summary ?? ""),
    [aliases, setAliases] = useState(entity?.aliases.join(",") ?? ""),
    [locked, setLocked] = useState(entity?.locked.join(",") ?? "");
  const [kind, setKind] = useState<Entity["kind"]>(entity?.kind ?? "character"),
    [global, setGlobal] = useState(entity?.global ?? false),
    [attributes, setAttributes] = useState(
      Object.entries(entity?.attributes ?? {}).map(([field, value]) => ({ field, value })),
    );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      data-testid="entity-editor"
      onChange={dirty}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        void save({
          ...entity,
          id: entity?.id ?? browserId("ent"),
          name,
          kind,
          summary,
          aliases: aliases
            .split(/[,，]/u)
            .map((value) => value.trim())
            .filter(Boolean),
          attributes: Object.fromEntries(
            attributes.filter((row) => row.field.trim()).map((row) => [row.field, row.value]),
          ),
          locked: locked
            .split(/[,，]/u)
            .map((value) => value.trim())
            .filter(Boolean),
          global,
          provenance: entity?.provenance ?? { source: "author", at: new Date().toISOString() },
          rev: entity?.rev ?? 0,
        })
          .catch((error: unknown) =>
            setError(error instanceof Error ? error.message : String(error)),
          )
          .finally(() => setBusy(false));
      }}
    >
      <TextField
        label={P["plan.name"]}
        value={name}
        onChange={setName}
        testId="entity-name"
        disabled={readonly}
      />
      <label className="zz-plan-field">
        {P["plan.kind"]}
        <select
          value={kind}
          disabled={readonly}
          onChange={(event) => setKind(EntityKindSchema(event.target.value))}
        >
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {P[`plan.kind.${kind}`]}
            </option>
          ))}
        </select>
      </label>
      <TextField
        label={P["plan.aliases"]}
        value={aliases}
        onChange={setAliases}
        disabled={readonly}
      />
      <TextField
        label={P["plan.summary"]}
        value={summary}
        onChange={setSummary}
        multiline
        disabled={readonly}
      />
      <fieldset>
        <legend>{P["plan.attributes"]}</legend>
        {attributes.map((row, index) => (
          <div className="zz-plan-toolbar" key={index}>
            <TextField
              label={P["plan.field"]}
              value={row.field}
              disabled={readonly}
              onChange={(field) =>
                setAttributes(
                  attributes.map((value, i) => (i === index ? { ...value, field } : value)),
                )
              }
            />
            <TextField
              label={P["plan.value"]}
              value={row.value}
              disabled={readonly}
              onChange={(value) =>
                setAttributes(attributes.map((row, i) => (i === index ? { ...row, value } : row)))
              }
            />
            <Button
              disabled={readonly}
              onClick={() => {
                setAttributes(attributes.filter((_, i) => i !== index));
                dirty();
              }}
            >
              {P["plan.delete"]}
            </Button>
          </div>
        ))}
        <Button
          disabled={readonly}
          onClick={() => {
            setAttributes([...attributes, { field: "", value: "" }]);
            dirty();
          }}
        >
          {P["plan.addAttribute"]}
        </Button>
      </fieldset>
      <TextField label={P["plan.locked"]} value={locked} onChange={setLocked} disabled={readonly} />
      <label>
        <input
          type="checkbox"
          checked={global}
          disabled={readonly}
          onChange={(event) => setGlobal(event.target.checked)}
        />
        {P["plan.global"]}
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="zz-plan-toolbar">
        <Button
          type="submit"
          variant="primary"
          disabled={readonly || busy || !name.trim()}
          data-testid="entity-save"
        >
          {P["plan.save"]}
        </Button>
        <Button onClick={cancel}>{P["plan.cancel"]}</Button>
      </div>
    </form>
  );
}
