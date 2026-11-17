import React, { useState } from "react";
import { Button, Dialog } from "@zhizhang/ui/primitives";
import { FacetSchema, type Entity, type BibleOp } from "@zhizhang/fanqie/contracts";
import { desktop } from "../../../state/desktop";
import { desktopStore, useDesktop } from "../../../state/store";
import { P, ResourceState, TextField, browserId, usePlanResource, usePlanDirty } from "../shared";
import { EntityEditor } from "./EntityEditor";

const entityKinds: Entity["kind"][] = [
  "character",
  "faction",
  "place",
  "power",
  "item",
  "rule",
  "term",
];
const stateFacets: Array<
  "condition" | "location" | "relation" | "possession" | "ability" | "identity" | "other"
> = ["condition", "location", "relation", "possession", "ability", "identity", "other"];

export function LibraryPage({ work, readonly }: { work: string; readonly: boolean }) {
  const focused = useDesktop((state) => state.planFocus);
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState(""),
    [position, setPosition] = useState("1"),
    [selected, setSelected] = useState(focused ?? ""),
    [editing, setEditing] = useState<Entity | null | undefined>(undefined),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState("");
  const [stateDialog, setStateDialog] = useState(false),
    [value, setValue] = useState(""),
    [field, setField] = useState(""),
    [facet, setFacet] = useState("condition"),
    [since, setSince] = useState("1"),
    [until, setUntil] = useState(""),
    [target, setTarget] = useState("");
  const data = usePlanResource(() => desktop.workbench("fanqie.bible.get", { work }), work, dirty);
  usePlanDirty(dirty, () => {
    setDirty(false);
    setEditing(undefined);
  });
  const bible = data.value,
    entities = bible?.entities ?? [],
    entity = entities.find((row) => row.id === selected);
  const filtered = entities.filter(
    (entity) =>
      (!kind || entity.kind === kind) &&
      `${entity.name} ${entity.aliases.join(" ")} ${entity.summary}`.includes(query),
  );
  const asOf = Math.max(1, Number(position) || 1),
    states = bible?.states.filter((state) => state.entity === selected) ?? [],
    relations =
      bible?.states.filter(
        (state) =>
          state.facet === "relation" &&
          (state.entity === selected || state.target === selected) &&
          state.since <= asOf &&
          (state.until === undefined || state.until > asOf),
      ) ?? [];
  const graphIds = [
    ...new Set([selected, ...relations.flatMap((state) => [state.entity, state.target ?? ""])]),
  ]
    .filter(Boolean)
    .slice(0, 30);
  const apply = async (ops: BibleOp[]) => {
    if (!bible) return;
    setError("");
    try {
      await desktop.workbench("fanqie.bible.apply", {
        work,
        ops,
        expectedRev: Math.max(0, ...Object.values(bible.index.files).map((file) => file.rev)),
      });
      setDirty(false);
      setEditing(undefined);
      setStateDialog(false);
      data.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  return (
    <section data-testid="library-page">
      <ResourceState loading={data.loading} error={data.error} retry={data.refresh} />
      <div className="zz-plan-toolbar">
        <TextField label={P["plan.search"]} value={query} onChange={setQuery} />
        <label>
          {P["plan.kind"]}
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">{P["plan.all"]}</option>
            {entityKinds.map((kind) => (
              <option key={kind} value={kind}>
                {P[`plan.kind.${kind}`]}
              </option>
            ))}
          </select>
        </label>
        <TextField label={P["plan.asOf"]} value={position} onChange={setPosition} />
        <Button
          data-testid="new-entity"
          disabled={readonly || dirty}
          onClick={() => setEditing(null)}
        >
          {P["plan.newEntity"]}
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {dirty ? <p role="status">{P["plan.changed"]}</p> : null}
      <div className="zz-plan-columns">
        <div className="zz-plan-list">
          {filtered.map((entity) => (
            <Button
              key={entity.id}
              aria-pressed={selected === entity.id}
              disabled={dirty}
              onClick={() => setSelected(entity.id)}
            >
              {entity.name}
            </Button>
          ))}
        </div>
        <div>
          {editing !== undefined ? (
            <EntityEditor
              key={editing?.id ?? "new"}
              entity={editing ?? undefined}
              readonly={readonly}
              dirty={() => setDirty(true)}
              cancel={() => {
                setEditing(undefined);
                setDirty(false);
              }}
              save={async (entity) => {
                await apply([{ type: "entity.upsert", entity, expectedRev: editing?.rev }]);
                setSelected(entity.id);
              }}
            />
          ) : entity ? (
            <>
              <div className="zz-plan-card">
                <h3>{entity.name}</h3>
                <p>{entity.summary}</p>
                <p>{entity.aliases.join(" · ")}</p>
                <dl>
                  {Object.entries(entity.attributes ?? {}).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <Button disabled={readonly} onClick={() => setEditing(entity)}>
                  {P["plan.edit"]}
                </Button>
                <h4>{P["plan.source"]}</h4>
                {entity.src?.map((src, index) => (
                  <Button
                    key={index}
                    onClick={() => desktopStore.set({ planTab: "pending", planFocus: src.batch })}
                  >
                    {src.quote}
                  </Button>
                ))}
              </div>
              <h3>{P["plan.states"]}</h3>
              {states.map((state) => (
                <div
                  key={state.id}
                  className="zz-plan-card"
                  data-active={
                    state.since <= asOf && (state.until === undefined || state.until > asOf)
                  }
                >
                  <strong>
                    {state.field}: {state.value}
                  </strong>
                  <p>
                    {state.since} → {state.until ?? "∞"} · {state.status}
                  </p>
                  <Button
                    disabled={readonly}
                    onClick={() =>
                      void apply([
                        {
                          type: "state.update",
                          id: state.id,
                          expectedRev: state.rev,
                          patch: { until: asOf },
                        },
                      ]).catch(() => undefined)
                    }
                  >
                    {P["plan.until"]}
                  </Button>
                </div>
              ))}
              <Button
                disabled={readonly}
                onClick={() => {
                  setSince(position);
                  setStateDialog(true);
                }}
              >
                {P["plan.addState"]}
              </Button>
              <h3>{P["plan.relations"]}</h3>
              <table>
                <thead>
                  <tr>
                    <th>{P["plan.name"]}</th>
                    <th>{P["plan.field"]}</th>
                    <th>{P["plan.value"]}</th>
                  </tr>
                </thead>
                <tbody>
                  {relations.map((state) => (
                    <tr key={state.id}>
                      <td>{entities.find((entity) => entity.id === state.entity)?.name}</td>
                      <td>{state.field}</td>
                      <td>
                        {entities.find((entity) => entity.id === state.target)?.name ?? state.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>{P["plan.graph"]}</h3>
              <svg width="480" height="360" role="img" aria-label={P["plan.graph"]}>
                {graphIds.slice(1).map((id, index) => {
                  const angle = (index * Math.PI * 2) / Math.max(1, graphIds.length - 1),
                    x = 240 + Math.cos(angle) * 150,
                    y = 180 + Math.sin(angle) * 130;
                  return (
                    <g key={id}>
                      <line x1="240" y1="180" x2={x} y2={y} />
                      <circle cx={x} cy={y} r="20" />
                      <text x={x} y={y} textAnchor="middle">
                        {entities.find((entity) => entity.id === id)?.name ?? id}
                      </text>
                    </g>
                  );
                })}
                <circle cx="240" cy="180" r="28" />
                <text x="240" y="180" textAnchor="middle">
                  {entity.name}
                </text>
              </svg>
            </>
          ) : (
            <p>{P["plan.empty"]}</p>
          )}
        </div>
      </div>
      {stateDialog && entity ? (
        <Dialog title={P["plan.addState"]} onClose={() => setStateDialog(false)}>
          <label className="zz-plan-field">
            {P["plan.facet"]}
            <select value={facet} onChange={(event) => setFacet(event.target.value)}>
              {stateFacets.map((facet) => (
                <option key={facet} value={facet}>
                  {P[`plan.facet.${facet}`]}
                </option>
              ))}
            </select>
          </label>
          <TextField label={P["plan.field"]} value={field} onChange={setField} />
          <TextField label={P["plan.value"]} value={value} onChange={setValue} />
          <label>
            {P["plan.relations"]}
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">{P["plan.none"]}</option>
              {entities
                .filter((row) => row.id !== selected)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
            </select>
          </label>
          <TextField label={P["plan.since"]} value={since} onChange={setSince} />
          <TextField label={P["plan.until"]} value={until} onChange={setUntil} />
          <Button
            variant="primary"
            disabled={readonly || !value}
            onClick={() =>
              void apply([
                {
                  type: "state.add",
                  entry: {
                    id: browserId("st"),
                    entity: entity.id,
                    facet: FacetSchema(facet),
                    field: field || facet,
                    value,
                    target: target || undefined,
                    since: Number(since),
                    until: until ? Number(until) : undefined,
                    status: "confirmed",
                    mode: "replace",
                    provenance: { source: "author", at: new Date().toISOString() },
                    rev: 0,
                  },
                },
              ]).catch(() => undefined)
            }
          >
            {P["plan.save"]}
          </Button>
        </Dialog>
      ) : null}
    </section>
  );
}
