import React, { useState } from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Button, Segmented, Toggle } from "@zhizhang/ui/primitives";
import type { ContextSettings, EngineSettings, PublicSettings } from "../../../shared/settings";
import { saveSettings } from "../../state/controller";
import { notifyError } from "../../format";
import { TextField } from "../workspace/TextField";
import { NumberField, Section } from "./fields";

type Grade = EngineSettings["grade"];

export function EngineTab({ settings }: { settings: PublicSettings }) {
  const [engine, setEngine] = useState<EngineSettings>(settings.engine);
  const [context, setContext] = useState<ContextSettings>(settings.context);
  const [preferences, setPreferences] = useState(settings.assistant.preferences);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await saveSettings({ engine, context, assistant: { preferences } });
      notify({ tone: "success", text: C.settings.saved });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="zz-stack" data-testid="settings-engine">
      <Section title={C.engine.title}>
        <Segmented<Grade>
          label={C.create.grade}
          testId="engine-grade"
          value={engine.grade}
          options={(["economy", "standard", "premium"] as const).map((g) => ({ value: g, label: C.settings.grade[g] }))}
          onChange={(grade) => setEngine({ ...engine, grade })}
        />
        <NumberField label={C.engine.inputBudget} value={engine.inputBudget} testId="engine-input-budget" onChange={(inputBudget) => setEngine({ ...engine, inputBudget })} />
        <NumberField label={C.engine.runBudget} value={engine.runBudget} testId="engine-run-budget" onChange={(runBudget) => setEngine({ ...engine, runBudget })} />
        <TextField
          label={C.engine.moneyCap}
          type="number"
          value={engine.moneyCap === undefined ? "" : String(engine.moneyCap)}
          hint={C.engine.moneyCapHint}
          testId="engine-money-cap"
          onChange={(raw) => {
            const value = Number(raw);
            setEngine({ ...engine, moneyCap: raw.trim() === "" || !Number.isFinite(value) ? undefined : value });
          }}
        />
        <div className="zz-row">
          <NumberField
            label={C.engine.concurrencyGlobal}
            value={engine.concurrency.global}
            testId="engine-concurrency-global"
            onChange={(global) => setEngine({ ...engine, concurrency: { ...engine.concurrency, global } })}
          />
          <NumberField
            label={C.engine.concurrencyRun}
            value={engine.concurrency.perRun}
            testId="engine-concurrency-run"
            onChange={(perRun) => setEngine({ ...engine, concurrency: { ...engine.concurrency, perRun } })}
          />
        </div>
      </Section>
      <Section title={C.engine.assistant}>
        <Toggle label={C.engine.autoCompact} checked={context.enabled} testId="context-enabled" onChange={(enabled) => setContext({ ...context, enabled })} />
        <NumberField label={C.engine.triggerPercent} value={context.triggerPercent} testId="context-trigger" onChange={(triggerPercent) => setContext({ ...context, triggerPercent })} />
        <NumberField label={C.engine.keepRecent} value={context.keepRecentTokens} testId="context-keep" onChange={(keepRecentTokens) => setContext({ ...context, keepRecentTokens })} />
        <TextField label={C.engine.preferences} value={preferences} onChange={setPreferences} multiline testId="assistant-preferences" hint={C.engine.preferencesHint} />
      </Section>
      <Button variant="primary" data-testid="engine-save" loading={busy} onClick={() => void save()}>
        {C.settings.save}
      </Button>
    </div>
  );
}
