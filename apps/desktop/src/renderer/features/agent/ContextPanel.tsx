import { COPY as viewCopy, formatCount } from "../../../../../../packages/ui/src/copy.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { scopeId, type Target } from "../../../context";
import { type ContextSettings } from "../../../context-settings";
import { desktop } from "../../state/desktop";
import { errorText } from "../../../../../../packages/core/src/errors.js";

type Usage = Awaited<ReturnType<typeof desktop.contextUsage>>;
const cacheCount = (value: number) =>
  value > 0 ? formatCount(value) : viewCopy.contextCacheUnknown;
export function ContextPanel({
  target,
  busy,
  task,
  initialSettings,
  onSaved,
}: {
  initialSettings: ContextSettings;
  onSaved: () => Promise<unknown>;
  target?: Target;
  busy: boolean;
  task: import("../../../renderer-contracts").TaskState | null;
}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [settings, setSettings] = useState(initialSettings);
  const [working, setWorking] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [message, setMessage] = useState("");
  const [instructions, setInstructions] = useState("");
  const request = useRef({ id: 0 });
  useEffect(() => setSettings(initialSettings), [initialSettings]);
  const refresh = useCallback(async () => {
    if (!target) return;
    const id = ++request.current.id;
    const value = await desktop.contextUsage(target);
    if (request.current.id === id) setUsage(value);
  }, [target]);
  useEffect(() => {
    let active = true;
    const pending = request.current;
    setUsage(null);
    void refresh().catch((e) => {
      if (active) setMessage(errorText(e));
    });
    let frame = 0;
    const unsubscribe = desktop.subscribe(({ target: changed, event, editor }) => {
      if (editor || !changed || scopeId(changed) !== scopeId(target) || !event) return;
      if (event.type === "compaction_start") {
        setUsage((current) => (current ? { ...current, compacting: true } : current));
        return;
      }
      if (
        event.type !== "agent_settled" &&
        event.type !== "compaction_end" &&
        !(event.type === "message_end" && event.message?.role === "assistant")
      )
        return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void refresh().catch((error) => {
          if (active) setMessage(errorText(error));
        });
      });
    });
    return () => {
      active = false;
      pending.id++;
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [target, refresh]);
  const act = async (operation: () => Promise<void>) => {
    setWorking(true);
    setMessage("");
    try {
      await operation();
      await refresh();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setWorking(false);
    }
  };
  const context = usage?.context;
  const tokens = usage?.stats?.tokens;
  const estimatedCost = usage?.stats?.cost ?? 0;
  const input = tokens ? tokens.input + tokens.cacheRead + tokens.cacheWrite : 0;
  return (
    <details className="context-panel">
      <summary>
        {viewCopy.contextPanelText1}
        {context?.tokens == null
          ? viewCopy.contextPanelText2
          : `≈${formatCount(context.tokens)} / ${formatCount(context.contextWindow)} · ${context.percent?.toFixed(1)}%`}
        {usage?.compacting ? viewCopy.contextPanelText3 : ""}
      </summary>
      <p>{viewCopy.contextPanelText4}</p>
      {task?.usage && (
        <p>
          {viewCopy.contextTaskUsage}{" "}
          {formatCount(task.usage.input + task.usage.cacheRead + task.usage.cacheWrite)} /{" "}
          {formatCount(task.usage.output)} / {formatCount(task.usage.cacheRead)}
        </p>
      )}
      {usage?.recent && (
        <p>
          {viewCopy.contextPanelText5}
          {formatCount(usage.recent.input + usage.recent.cacheRead + usage.recent.cacheWrite)}
          {viewCopy.contextPanelText6}
          {formatCount(usage.recent.output)}
          {viewCopy.contextPanelText7}
          {cacheCount(usage.recent.cacheRead)}
        </p>
      )}
      {usage && usage.methods.length > 0 && (
        <ul>
          {usage.methods.map((method) => (
            <li key={method.id}>
              {viewCopy.contextPanelText8}
              {method.profile} / {method.id} · {method.hash.slice(0, 8)}
            </li>
          ))}
        </ul>
      )}
      {usage?.compaction && (
        <details>
          <summary>{viewCopy.contextLastCompaction}</summary>
          <p>
            {usage.compaction.at} · {viewCopy.contextBeforeCompaction}{" "}
            {formatCount(usage.compaction.tokensBefore)}
          </p>
          <p>
            {viewCopy.contextSummaryUsage}{" "}
            {usage.compaction.input == null
              ? viewCopy.contextPanelText2
              : formatCount(usage.compaction.input)}{" "}
            /{" "}
            {usage.compaction.output == null
              ? viewCopy.contextPanelText2
              : formatCount(usage.compaction.output)}
          </p>
          <pre>{usage.compaction.summary}</pre>
        </details>
      )}
      {tokens && (
        <dl>
          <dt>{viewCopy.contextPanelText9}</dt>
          <dd>{formatCount(input)}</dd>
          <dt>{viewCopy.contextPanelText10}</dt>
          <dd>{formatCount(tokens.input)}</dd>
          <dt>{viewCopy.contextPanelText11}</dt>
          <dd>
            {cacheCount(tokens.cacheRead)}
            {input > 0 && tokens.cacheRead > 0
              ? ` · ${((tokens.cacheRead / input) * 100).toFixed(1)}%`
              : ""}
          </dd>
          <dt>{viewCopy.contextPanelText12}</dt>
          <dd>{cacheCount(tokens.cacheWrite)}</dd>
          <dt>{viewCopy.contextPanelText13}</dt>
          <dd>{formatCount(tokens.output)}</dd>
          <dt>{viewCopy.contextPanelText14}</dt>
          <dd>
            {estimatedCost > 0 ? `$${estimatedCost.toFixed(4)}` : viewCopy.contextPanelText15}
          </dd>
        </dl>
      )}
      <label>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
        />
        {viewCopy.contextPanelText16}
      </label>
      <label>
        {viewCopy.contextPanelText17}
        <input
          type="number"
          min="50"
          max="95"
          value={settings.triggerPercent}
          onChange={(e) => setSettings({ ...settings, triggerPercent: Number(e.target.value) })}
        />
      </label>
      <label>
        {viewCopy.contextPanelText18}
        <input
          type="number"
          min="0"
          value={settings.budget}
          onChange={(e) => setSettings({ ...settings, budget: Number(e.target.value) })}
        />
      </label>
      <label>
        {viewCopy.contextPanelText19}
        <input
          type="number"
          min="0"
          value={settings.keepRecentTokens}
          onChange={(e) => setSettings({ ...settings, keepRecentTokens: Number(e.target.value) })}
        />
      </label>
      <button
        disabled={busy || working}
        onClick={() =>
          void act(async () => {
            await desktop.contextSettings(settings);
            await onSaved();
            setMessage(viewCopy.contextPanelText20);
          })
        }
      >
        {viewCopy.contextPanelText21}
      </button>
      <label>
        {viewCopy.contextPanelText22}
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </label>
      <p>{viewCopy.contextPanelText23}</p>
      <button
        disabled={!target || busy || working}
        onClick={() =>
          void act(async () => {
            if (!target) return;
            setCompacting(true);
            let result: Awaited<ReturnType<typeof desktop.compact>>;
            try {
              result = await desktop.compact(target, instructions);
            } finally {
              setCompacting(false);
            }
            setMessage(
              viewCopy.contextPanelText24 +
                formatCount(result.tokensBefore) +
                viewCopy.contextPanelText25,
            );
          })
        }
      >
        {working ? viewCopy.contextPanelText26 : viewCopy.contextPanelText27}
      </button>
      {compacting && target && (
        <button onClick={() => void desktop.stop(target).catch((e) => setMessage(errorText(e)))}>
          {viewCopy.contextPanelText28}
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
