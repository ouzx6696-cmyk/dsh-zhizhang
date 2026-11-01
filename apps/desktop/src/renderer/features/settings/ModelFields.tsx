import React from "react";
import { Check, LoaderCircle } from "lucide-react";
import { PROVIDERS } from "../../../models";

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
  const preset = (id: string) => {
    const item = PROVIDERS.find((row) => row.id === id);
    if (!item) return;
    onChange({
      ...model,
      provider: id,
      api: item.api,
      baseUrl: item.baseUrl,
      model: item.model,
      contextWindow: item.contextWindow,
      apiKey: "",
      configured: false,
      reasoning: id === "deepseek" && role === "editor",
      thinkingLevel: role === "editor" ? "medium" : "off",
    });
  };
  return (
    <fieldset className="model-fields">
      <legend>
        {role === "writer" ? "写手" : role === "editor" ? "独立编辑" : "规划与拆书"}
      </legend>
      <label>
        服务商
        <select value={model.provider} onChange={(event) => preset(event.target.value)}>
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
            {["off", "minimal", "low", "medium", "high", "xhigh"].map((level) => (
              <option key={level}>{level}</option>
            ))}
          </select>
        </label>
      )}
      </details>
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
