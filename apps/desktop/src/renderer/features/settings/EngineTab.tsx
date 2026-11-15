import React from "react";
import { BUDGET_LIMITS, type EngineSettings } from "@zhizhang/core";
import { toggleClasses } from "@zhizhang/ui/primitives";
import { AGENT_COPY, DESKTOP_COPY as copy } from "../../../shared/copy";
import type { ContextSettings } from "../../../context-settings";
import type { SessionOptions } from "../../../session/types";

const FLAGS = [
  ["pursuit", "enabled", copy.workflowPursuit, "fanqie"],
  ["pursuit", "radar", copy.workflowReadingRadar, "fanqie"],
  ["continuity", "enabled", copy.workflowContinuity, "fanqie"],
  ["learn", "enabled", copy.workflowLearn, "both"],
  ["brief", "creationFirst", copy.workflowCreation, "both"],
] as const;

function flag(options: SessionOptions, mode: "fanqie" | "toutiao", group: string, key: string) {
  const section = options[mode];
  if (!section || !(group in section)) return false;
  const value = section[group as keyof typeof section];
  return (
    typeof value === "object" && value !== null && key in value && Reflect.get(value, key) === true
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={toggleClasses()}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function EngineTab({
  value,
  onChange,
  options,
  onOptionsChange,
  context,
  onContextChange,
}: {
  value: EngineSettings;
  onChange: (value: EngineSettings) => void;
  options: SessionOptions | null;
  onOptionsChange: (value: SessionOptions) => void;
  context: ContextSettings;
  onContextChange: (value: ContextSettings) => void;
}) {
  const change = (mode: "fanqie" | "toutiao", group: string, key: string, enabled: boolean) => {
    if (!options) return;
    const section = options[mode] ?? {};
    const existing = Reflect.get(section, group);
    onOptionsChange({
      ...options,
      [mode]: {
        ...section,
        [group]: {
          ...(typeof existing === "object" && existing !== null ? existing : {}),
          [key]: enabled,
        },
      },
    });
  };
  return (
    <section>
      <label>
        {copy.workflowGrade}
        <select
          value={value.grade}
          onChange={(e) => onChange({ ...value, grade: e.target.value as EngineSettings["grade"] })}
        >
          <option value="economy">{copy.workflowEconomy}</option>
          <option value="standard">{copy.workflowStandard}</option>
          <option value="premium">{copy.workflowPremium}</option>
        </select>
      </label>
      <label>
        {copy.workflowBudget}
        <input
          type="number"
          min={BUDGET_LIMITS.min}
          max={BUDGET_LIMITS.input}
          value={value.inputBudget}
          onChange={(e) => onChange({ ...value, inputBudget: Number(e.target.value) })}
        />
      </label>
      <label>
        {copy.workflowRunBudget}
        <input
          type="number"
          min={BUDGET_LIMITS.min}
          max={BUDGET_LIMITS.run}
          value={value.runBudget}
          onChange={(e) => onChange({ ...value, runBudget: Number(e.target.value) })}
        />
      </label>
      <p className="form-note">{copy.workflowCostNote}</p>
      <h3>{AGENT_COPY.contextSettings}</h3>
      <ToggleRow
        label={copy.contextPanelText16}
        checked={context.enabled}
        onChange={(checked) => onContextChange({ ...context, enabled: checked })}
      />
      <label>
        {copy.contextPanelText17}
        <input
          type="number"
          min="50"
          max="95"
          value={context.triggerPercent}
          onChange={(e) => onContextChange({ ...context, triggerPercent: Number(e.target.value) })}
        />
      </label>
      <label>
        {copy.contextPanelText18}
        <input
          type="number"
          min="0"
          value={context.budget}
          onChange={(e) => onContextChange({ ...context, budget: Number(e.target.value) })}
        />
      </label>
      <label>
        {copy.contextPanelText19}
        <input
          type="number"
          min="0"
          value={context.keepRecentTokens}
          onChange={(e) =>
            onContextChange({ ...context, keepRecentTokens: Number(e.target.value) })
          }
        />
      </label>
      <h3>{copy.workflowFeatures}</h3>
      <p className="form-note">{copy.workflowExperimental}</p>
      {(["fanqie", "toutiao"] as const).map((mode) => (
        <fieldset key={mode} disabled={!options}>
          <legend>{mode === "fanqie" ? copy.workflowChapter : copy.workflowArticle}</legend>
          {FLAGS.filter((row) => row[3] === "both" || row[3] === mode).map(
            ([group, key, label]) => (
              <ToggleRow
                key={group + key}
                label={label}
                checked={options ? flag(options, mode, group, key) : false}
                onChange={(checked) => void change(mode, group, key, checked)}
              />
            ),
          )}
        </fieldset>
      ))}
    </section>
  );
}
