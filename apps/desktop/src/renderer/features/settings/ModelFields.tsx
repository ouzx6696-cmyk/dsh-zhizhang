import React, { useEffect, useState } from "react";
import { desktop } from "../../state/desktop";
import { Check, LoaderCircle } from "lucide-react";
import { APIS, PROVIDERS } from "../../../models";

export function ModelFields({
  role,
  model,
  onChange,
  onTest,
  result,
}: {
  role: "writer" | "editor" | "planner";
  model: any;
  onChange: (value: any) => void;
  onTest: () => void;
  result?: any;
}) {
  const [catalog, setCatalog] = useState<any>({ models: [], levels: ["off"] });
  const [catalogError, setCatalogError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async (action?: string) => {
    setLoading(true);
    setCatalogError("");
    try {
      const value = await desktop.modelCatalog(role, model, action);
      setCatalog((current: any) => ({ ...current, ...value }));
    } catch (error) {
      setCatalogError(String(error instanceof Error ? error.message : error));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    desktop
      .modelCatalog(role, model)
      .then((value) => {
        if (active) setCatalog(value);
      })
      .catch((error) => {
        if (active) setCatalogError(String(error));
      });
    return () => {
      active = false;
    };
  }, [model, role]);
  const preset = (id: string) => {
    const item =
      catalog.providers?.find((row: any) => row.id === id) ||
      PROVIDERS.find((row) => row.id === id);
    if (!item) {
      onChange({ ...model, provider: "custom" });
      return;
    }
    onChange({
      ...model,
      provider: id,
      api: item.api,
      baseUrl: item.baseUrl,
      model: item.model,
      contextWindow: item.contextWindow,
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
      <legend>{role === "writer" ? "写手" : role === "editor" ? "独立编辑" : "规划与拆书"}</legend>
      <label>
        服务商
        <select value={model.provider} onChange={(event) => preset(event.target.value)}>
          <option value="custom">自定义连接</option>
          {(catalog.providers || [])
            .filter((p: any) => !PROVIDERS.some((row) => row.id === p.id))
            .map((p: any) => (
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
        接口地址
        <input
          type="url"
          value={model.baseUrl}
          onChange={(event) => onChange({ ...model, baseUrl: event.target.value })}
        />
      </label>
      <p className="form-note">
        填写基础地址，端口直接写在地址中，例如 http://127.0.0.1:11434/v1；保留代理路径。
      </p>
      <label>
        接口类型
        <select value={model.api} onChange={(e) => onChange({ ...model, api: e.target.value })}>
          {Array.from(new Set([...APIS, model.api])).map((api) => (
            <option key={api} value={api}>
              {api}
            </option>
          ))}
        </select>
      </label>
      <label>
        选择模型
        <select
          value=""
          onChange={(e) => {
            const item = catalog.models.find((m: any) => m.id === e.target.value);
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
          <option value="">从列表选择，也可手填</option>
          {catalog.models.map((m: any) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <div className="button-row">
        <button type="button" disabled={loading} onClick={() => load("refresh")}>
          刷新 PI 目录
        </button>
        <button type="button" disabled={loading} onClick={() => load("endpoint")}>
          抓取当前端点模型
        </button>
      </div>
      <p className="form-note">{catalog.source}</p>
      {catalogError && <p className="form-error">{catalogError}</p>}
      <label>
        模型 ID
        <input
          value={model.model}
          onChange={(event) => onChange({ ...model, model: event.target.value })}
        />
      </label>
      <label>
        API Key
        <input
          type="password"
          autoComplete="off"
          placeholder={model.configured ? "已保存，留空保持" : "编辑可沿用同一接口的写手 Key"}
          value={model.apiKey || ""}
          onChange={(event) => onChange({ ...model, apiKey: event.target.value })}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={!!model.keyless}
          onChange={(e) => onChange({ ...model, keyless: e.target.checked })}
        />
        本地服务无需 Key
      </label>
      <details className="model-advanced">
        <summary>高级</summary>
        <div className="field-grid">
          <label>
            上下文窗口
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
            最大输出
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
          启用模型思考能力
        </label>
        {model.reasoning && (
          <label>
            思考档位
            <select
              value={model.thinkingLevel}
              onChange={(event) => onChange({ ...model, thinkingLevel: event.target.value })}
            >
              {(catalog.levels || ["off"]).map((level: string) => (
                <option key={level}>{level}</option>
              ))}
            </select>
          </label>
        )}
      </details>
      {catalog.thinkingLevel && catalog.thinkingLevel !== model.thinkingLevel && (
        <p className="form-note">此模型实际使用思考档位：{catalog.thinkingLevel}</p>
      )}
      <button type="button" onClick={onTest} disabled={result?.busy}>
        {result?.busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
        测试连接
      </button>
      {result && (
        <p className={result.error ? "form-error" : "form-note"}>
          {result.busy
            ? "正在发送最短连接请求…"
            : result.error || `连接成功 · ${result.latency} ms`}
        </p>
      )}
    </fieldset>
  );
}
