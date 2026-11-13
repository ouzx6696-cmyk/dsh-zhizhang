import { COPY as viewCopy, t as viewText } from "@writer/ui/copy";
import { errorText } from "../../../../../../packages/core/src/errors.js";
import type { ModelConnection, Thinking } from "../../../models";
import type { ConnectionResult } from "../../state/store";
import React, { useEffect, useState } from "react";
import { desktop } from "../../state/desktop";
import { Check, LoaderCircle } from "lucide-react";
import { API_LABELS, COPY } from "@writer/ui/copy";
import { APIS, PROVIDERS } from "../../../models";

type ProviderChoice = Partial<ModelConnection> & { id: string; name?: string };
type Catalog = {
  models: (Partial<ModelConnection> & { id: string; name: string; levels?: Thinking[] })[];
  providers?: ProviderChoice[];
  levels?: Thinking[];
  thinkingLevel?: Thinking;
  source?: string;
};
export function ModelFields({
  role,
  model,
  onChange,
  onTest,
  result,
}: {
  role: "writer" | "editor" | "planner";
  model: ModelConnection & { configured: boolean };
  onChange: (value: ModelConnection & { configured: boolean }) => void;
  onTest: () => void;
  result?: ConnectionResult;
}) {
  const [catalog, setCatalog] = useState<Catalog>({ models: [], levels: ["off"] });
  const [catalogError, setCatalogError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async (action?: string) => {
    setLoading(true);
    setCatalogError("");
    try {
      const value = await desktop.modelCatalog(role, model, action);
      setCatalog((current) => ({ ...current, ...value }));
    } catch (error) {
      setCatalogError(errorText(error));
    } finally {
      setLoading(false);
    }
  };
  const latestModel = React.useRef(model);
  latestModel.current = model;
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setCatalogError("");
      desktop
        .modelCatalog(role, latestModel.current)
        .then((value) => {
          if (active) setCatalog(value);
        })
        .catch((error) => {
          if (active) setCatalogError(String(error));
        });
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [model.provider, model.baseUrl, role]);
  const preset = (id: string) => {
    const item: ProviderChoice | undefined =
      catalog.providers?.find((row) => row.id === id) || PROVIDERS.find((row) => row.id === id);
    if (!item) {
      onChange({ ...model, provider: "custom" });
      return;
    }
    onChange({
      ...model,
      provider: id,
      api: item.api ?? model.api,
      baseUrl: item.baseUrl ?? model.baseUrl,
      model: item.model ?? model.model,
      contextWindow: item.contextWindow ?? model.contextWindow,
      maxTokens: item.maxTokens || 8192,
      thinkingLevelMap: item.thinkingLevelMap,
      apiKey: "",
      configured: false,
      reasoning: item.reasoning ?? (id === "deepseek" && role === "editor"),
      thinkingLevel: role === "editor" ? "medium" : "off",
    });
  };
  return (
    <fieldset className="model-fields">
      <legend>
        {role === "writer"
          ? viewCopy.modelFieldsText1
          : role === "editor"
            ? viewCopy.modelFieldsText2
            : viewCopy.tabInspiration}
      </legend>
      <label>
        {viewCopy.modelFieldsText3}
        <select value={model.provider} onChange={(event) => preset(event.target.value)}>
          <option value="custom">{viewCopy.modelFieldsText4}</option>
          {(catalog.providers || [])
            .filter((p) => !PROVIDERS.some((row) => row.id === p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          {PROVIDERS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {viewCopy.modelFieldsText5}
        <input
          value={model.model}
          list={`model-options-${role}`}
          onChange={(event) => {
            const item = catalog.models.find((item) => item.id === event.target.value);
            onChange({ ...model, ...item, model: event.target.value });
          }}
        />
      </label>
      <datalist id={`model-options-${role}`}>
        {catalog.models.map((item) => (
          <option value={item.id} key={item.id}>
            {item.name}
          </option>
        ))}
      </datalist>
      <label>
        API Key
        <input
          type="password"
          autoComplete="off"
          placeholder={model.configured ? viewCopy.modelFieldsText6 : viewCopy.modelFieldsText7}
          value={model.apiKey || ""}
          onChange={(event) => onChange({ ...model, apiKey: event.target.value })}
        />
      </label>
      <details className="model-advanced">
        <summary>{viewCopy.modelFieldsText8}</summary>
        <label>
          {viewCopy.modelFieldsText9}
          <input
            type="url"
            value={model.baseUrl}
            onChange={(event) => onChange({ ...model, baseUrl: event.target.value })}
          />
        </label>
        <p className="form-note">{viewCopy.modelFieldsText10}</p>
        <label>
          {viewCopy.modelFieldsText11}
          <select
            value={model.api}
            onChange={(e) => onChange({ ...model, api: e.target.value as ModelConnection["api"] })}
          >
            {Array.from(new Set([...APIS, model.api])).map((api) => (
              <option key={api} value={api}>
                {API_LABELS[api] || viewCopy.modelFieldsText12}
              </option>
            ))}
          </select>
        </label>
        <label>
          {viewCopy.modelFieldsText13}
          <select
            value=""
            onChange={(e) => {
              const item = catalog.models.find((m) => m.id === e.target.value);
              if (item)
                onChange({
                  ...model,
                  ...item,
                  model: item.id,
                  thinkingLevel: item.levels?.includes(model.thinkingLevel)
                    ? model.thinkingLevel
                    : item.levels?.[0] || "off",
                });
            }}
          >
            <option value="">{viewCopy.modelFieldsText14}</option>
            {catalog.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <div className="button-row">
          <button type="button" disabled={loading} onClick={() => load("refresh")}>
            {viewCopy.refreshModels}
          </button>
          <button type="button" disabled={loading} onClick={() => load("endpoint")}>
            {viewCopy.modelFieldsText15}
          </button>
        </div>
        <p className="form-note">
          {catalog.source?.startsWith("PI")
            ? COPY.modelList
            : catalog.source
              ? viewCopy.modelFieldsText16
              : ""}
        </p>
        {catalogError && <p className="form-error">{catalogError}</p>}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!model.keyless}
            onChange={(e) => onChange({ ...model, keyless: e.target.checked })}
          />
          {viewCopy.modelFieldsText17}
        </label>

        <div className="field-grid">
          <label>
            {viewCopy.modelFieldsText18}
            <input
              type="number"
              min="1024"
              step="1024"
              value={model.contextWindow}
              onChange={(event) =>
                onChange({ ...model, contextWindow: Number(event.target.value) })
              }
            />
          </label>
          <label>
            {viewCopy.modelFieldsText19}
            <input
              type="number"
              min="1"
              step="1024"
              value={model.maxTokens}
              onChange={(event) => onChange({ ...model, maxTokens: Number(event.target.value) })}
            />
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={model.reasoning}
            onChange={(event) => onChange({ ...model, reasoning: event.target.checked })}
          />
          {viewCopy.modelFieldsText20}
        </label>
        {model.reasoning && (
          <label>
            {viewCopy.modelFieldsText21}
            <select
              value={model.thinkingLevel}
              onChange={(event) =>
                onChange({ ...model, thinkingLevel: event.target.value as Thinking })
              }
            >
              {(catalog.levels || ["off"]).map((level: string) => (
                <option key={level}>{level}</option>
              ))}
            </select>
          </label>
        )}
      </details>
      {catalog.thinkingLevel && catalog.thinkingLevel !== model.thinkingLevel && (
        <p className="form-note">
          {viewCopy.modelFieldsText22}
          {catalog.thinkingLevel}
        </p>
      )}
      <button type="button" onClick={onTest} disabled={result?.busy}>
        {result?.busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
        {viewCopy.modelFieldsText23}
      </button>
      {result && (
        <p className={result.error ? "form-error" : "form-note"}>
          {result.busy
            ? viewCopy.modelFieldsText24
            : result.error || viewText("modelFieldsText25", { value0: result.latency })}
        </p>
      )}
    </fieldset>
  );
}
