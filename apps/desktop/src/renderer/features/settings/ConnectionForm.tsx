import React, { useState } from "react";
import { API_LABELS, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, Notice, Select, Toggle } from "@zhizhang/ui/primitives";
import {
  MODEL_APIS,
  type ConnectionInput,
  type ModelApi,
  type ModelRole,
  type PublicConnection,
  type PublicSettings,
  type RoleBinding,
  type RoleBindings,
} from "../../../shared/settings";
import { saveModels } from "../../state/controller";
import { desktop } from "../../state/desktop";
import { errorText } from "../../format";
import { TextField } from "../workspace/TextField";
import { NumberField } from "./fields";

export interface ConnectionDraft {
  id: string;
  label: string;
  api: ModelApi;
  baseUrl: string;
  apiKey: string;
  keyless: boolean;
  model: string;
  contextWindow: number;
  maxTokens: number;
}

export function draftFrom(
  settings: PublicSettings,
  connectionId?: string,
  role: ModelRole = "writer",
): ConnectionDraft {
  const binding = settings.models.roles[role];
  const id = connectionId ?? binding?.connection;
  const existing = settings.models.connections.find((c) => c.id === id);
  return {
    id: existing?.id ?? `c-${Date.now().toString(36)}`,
    label: existing?.label ?? "",
    api: existing?.api ?? "openai-completions",
    baseUrl: existing?.baseUrl ?? "",
    apiKey: "",
    keyless: existing?.keyless ?? false,
    model: binding && binding.connection === existing?.id ? binding.model : "",
    contextWindow: existing?.contextWindow ?? 128000,
    maxTokens: existing?.maxTokens ?? 8192,
  };
}

/** 草稿 → models.save 的连接：apiKey 留空表示沿用已存密钥（不随请求发送）。 */
export function connectionInput(
  draft: ConnectionDraft,
  existing: PublicConnection | undefined,
): ConnectionInput {
  return {
    id: draft.id,
    label: draft.label.trim() || draft.baseUrl.trim(),
    provider: draft.api.split("-")[0] ?? draft.api,
    api: draft.api,
    baseUrl: draft.baseUrl.trim(),
    keyless: draft.keyless,
    contextWindow: draft.contextWindow,
    maxTokens: draft.maxTokens,
    price: existing?.price,
    apiKey: draft.apiKey || !existing ? draft.apiKey : undefined,
  };
}

/** 已保存连接原样回写（不带密钥字段 = 沿用已存密钥）。 */
export function keepConnection({
  configured: _configured,
  ...rest
}: PublicConnection): ConnectionInput {
  return { ...rest, apiKey: undefined };
}

export function binding(connection: string, model: string, previous?: RoleBinding): RoleBinding {
  return { connection, model, thinking: previous?.thinking, temperature: previous?.temperature };
}

/** 一条模型连接 + 绑定到给定角色（引导与设置共用）。 */
export function ConnectionForm({
  settings,
  connectionId,
  role = "writer",
  bind = true,
  submitLabel,
  onSaved,
}: {
  settings: PublicSettings;
  connectionId?: string;
  role?: ModelRole;
  /** 保存时把连接与模型绑定到 role；设置页编辑已有连接时只改连接本身。 */
  bind?: boolean;
  submitLabel: string;
  onSaved: (settings: PublicSettings) => void;
}) {
  const [draft, setDraft] = useState(() => draftFrom(settings, connectionId, role));
  const [busy, setBusy] = useState<"" | "save" | "test">("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const patch = (next: Partial<ConnectionDraft>) => setDraft((d) => ({ ...d, ...next }));
  const existing = settings.models.connections.find((c) => c.id === draft.id);
  const configured = existing?.configured ?? false;
  const valid =
    draft.baseUrl.trim() !== "" &&
    draft.model.trim() !== "" &&
    (draft.keyless || configured || draft.apiKey.trim() !== "");

  const save = async () => {
    setBusy("save");
    setResult(null);
    try {
      const others = settings.models.connections
        .filter((c) => c.id !== draft.id)
        .map(keepConnection);
      const roles: RoleBindings = bind
        ? {
            ...settings.models.roles,
            [role]: binding(draft.id, draft.model.trim(), settings.models.roles[role]),
          }
        : settings.models.roles;
      onSaved(
        await saveModels({ connections: [...others, connectionInput(draft, existing)], roles }),
      );
    } catch (error) {
      setResult({ ok: false, text: errorText(error) });
    } finally {
      setBusy("");
    }
  };

  const test = async () => {
    setBusy("test");
    setResult(null);
    try {
      const value = await desktop.testModel({
        connectionId: draft.id,
        model: draft.model.trim(),
        draft: connectionInput(draft, existing),
      });
      setResult({ ok: true, text: C.models.testOk(value.model, value.latencyMs) });
    } catch (error) {
      setResult({ ok: false, text: errorText(error) });
    } finally {
      setBusy("");
    }
  };

  return (
    <form
      className="zz-connection-form"
      data-testid="model-connection-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) void save();
      }}
    >
      <TextField
        label={C.models.label}
        value={draft.label}
        onChange={(label) => patch({ label })}
        testId="connection-label"
        placeholder={C.models.labelHint}
      />
      <div className="zz-field">
        {/* 下拉框已有 aria-label；这里只补一个可见标签，与左侧“名称”对齐。 */}
        <span className="zz-field__label" aria-hidden="true">
          {C.models.api}
        </span>
        <Select<ModelApi>
          label={C.models.api}
          testId="connection-api"
          value={draft.api}
          options={MODEL_APIS.map((api) => ({ value: api, label: API_LABELS[api] ?? api }))}
          onChange={(api) => patch({ api })}
        />
      </div>
      <TextField
        label={C.models.baseUrl}
        type="url"
        value={draft.baseUrl}
        onChange={(baseUrl) => patch({ baseUrl })}
        testId="connection-base-url"
        placeholder={C.models.baseUrlHint}
        required
      />
      <Toggle
        label={C.models.keyless}
        checked={draft.keyless}
        testId="connection-keyless"
        onChange={(keyless) => patch({ keyless })}
      />
      {!draft.keyless ? (
        <TextField
          label={C.models.apiKey}
          type="password"
          value={draft.apiKey}
          onChange={(apiKey) => patch({ apiKey })}
          testId="connection-api-key"
          hint={configured ? C.models.apiKeyKept : C.models.apiKeyHint}
        />
      ) : null}
      <TextField
        label={C.models.model}
        value={draft.model}
        onChange={(model) => patch({ model })}
        testId="connection-model"
        placeholder={C.models.modelHint}
        required
      />
      <div className="zz-row zz-connection-form__pair">
        <NumberField
          label={C.models.contextWindow}
          value={draft.contextWindow}
          onChange={(contextWindow) => patch({ contextWindow })}
          testId="connection-context-window"
        />
        <NumberField
          label={C.models.maxTokens}
          value={draft.maxTokens}
          onChange={(maxTokens) => patch({ maxTokens })}
          testId="connection-max-tokens"
        />
      </div>
      {result ? (
        <div data-testid="connection-result" data-ok={result.ok}>
          <Notice tone={result.ok ? "ok" : "bad"} message={result.text} />
        </div>
      ) : null}
      <div className="zz-row zz-connection-form__actions">
        <Button
          data-testid="connection-test"
          loading={busy === "test"}
          disabled={!valid || busy !== ""}
          onClick={() => void test()}
        >
          {C.models.test}
        </Button>
        <Button
          type="submit"
          variant="strong"
          data-testid="connection-save"
          loading={busy === "save"}
          disabled={!valid || busy !== ""}
        >
          {submitLabel}
        </Button>
      </div>
      <p className="zz-muted">{C.models.testCost}</p>
    </form>
  );
}
