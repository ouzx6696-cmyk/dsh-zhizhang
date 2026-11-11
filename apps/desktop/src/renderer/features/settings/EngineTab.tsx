import React from "react";
import { AGENT_COPY, COPY as copy } from "../../../../../../packages/ui/src/copy.js";
import { Toggle } from "../../../../../../packages/ui/src/primitives";
import {
  BUDGET_LIMITS,
  type EngineSettings,
} from "../../../../../../packages/core/src/workflow-config.js";
import type { SessionOptions } from "../../../session/types";
import type { ContextSettings } from "../../../context-settings";

const FLAGS = [
  ["pursuit", "enabled", copy.workflowPursuit, "fanqie"],
  ["pursuit", "radar", copy.workflowReadingRadar, "fanqie"],
  ["handoff", "v2", copy.workflowHandoff, "both"],
  ["continuity", "enabled", copy.workflowContinuity, "fanqie"],
  ["multiDraft", "enabled", copy.workflowMultiDraft, "fanqie"],
  ["draw", "enabled", copy.workflowDraw, "both"],
  ["learn", "enabled", copy.workflowLearn, "both"],
  ["session", "perChapter", copy.workflowPerChapter, "fanqie"],
  ["session", "proactiveCompact", copy.workflowCompact, "both"],
  ["toolset", "narrowed", copy.workflowNarrow, "fanqie"],
  ["brief", "creationFirst", copy.workflowCreation, "both"],
  ["qa", "judge", copy.workflowReader, "toutiao"],
] as const;
/** 1.1.1 safety switches: on unless explicitly false, so turning one off restores 1.1.0. */
const SAFETY = [
  ["safety", "finalStructureGuard", copy.safetyFinalStructure, "fanqie"],
  ["safety", "narrowPlanningBasis", copy.safetyPlanningBasis, "fanqie"],
  ["safety", "fullDissectAuthor", copy.safetyFullDissect, "fanqie"],
  ["revision", "strict", copy.safetyStrictRevision, "toutiao"],
] as const;
function safety(options: SessionOptions, mode: "fanqie" | "toutiao", group: string, key: string) {
  const section = options[mode];
  const value = section && group in section ? Reflect.get(section, group) : undefined;
  return !(typeof value === "object" && value !== null && Reflect.get(value, key) === false);
}
function flag(options: SessionOptions, mode: "fanqie" | "toutiao", group: string, key: string) {
  const section = options[mode];
  if (!section || !(group in section)) return false;
  const value = section[group as keyof typeof section];
  return (
    typeof value === "object" && value !== null && key in value && Reflect.get(value, key) === true
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
    const section = options[mode] ?? {},
      existing = Reflect.get(section, group);
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
      <Toggle
        label={copy.workflowGuided}
        checked={value.guided}
        onChange={(checked: boolean) => onChange({ ...value, guided: checked })}
      />
      <p className="form-note">{copy.workflowGuideNote}</p>
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
      <Toggle
        label={copy.contextPanelText16}
        checked={context.enabled}
        onChange={(checked: boolean) => onContextChange({ ...context, enabled: checked })}
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
              <Toggle
                key={group + key}
                label={label}
                checked={options ? flag(options, mode, group, key) : false}
                onChange={(checked: boolean) => void change(mode, group, key, checked)}
              />
            ),
          )}
        </fieldset>
      ))}
      <h3>{copy.safetyTitle}</h3>
      <p className="form-note">{copy.safetyNote}</p>
      {(["fanqie", "toutiao"] as const).map((mode) => {
        const rows = SAFETY.filter((row) => row[3] === mode);
        if (!rows.length) return null;
        return (
          <fieldset key={`safety-${mode}`} disabled={!options}>
            <legend>{mode === "fanqie" ? copy.workflowChapter : copy.workflowArticle}</legend>
            {rows.map(([group, key, label]) => (
              <Toggle
                key={group + key}
                label={label}
                checked={options ? safety(options, mode, group, key) : true}
                onChange={(checked: boolean) => void change(mode, group, key, checked)}
              />
            ))}
          </fieldset>
        );
      })}
    </section>
  );
}
