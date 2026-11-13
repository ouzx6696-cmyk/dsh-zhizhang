import {
  COPY as viewCopy,
  formatBytes,
  formatCost,
  formatCount,
  formatTokens,
  AGENT_COPY,
} from "@writer/ui/copy";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { scopeId, type Target } from "../../../context";
import { type ContextSettings } from "../../../context-settings";
import { desktop, onDesktopEvent } from "../../state/desktop";
import { errorText } from "../../../../../../packages/core/src/errors.js";
import type { TaskState } from "../../../renderer-contracts";

type Usage = Awaited<ReturnType<typeof desktop.contextUsage>>;
const cacheCount = (value: number) =>
  value > 0 ? formatCount(value) : viewCopy.contextCacheUnknown;

/** 指示环的提醒档位：离自动压缩阈值越近越醒目，未统计时保持中性。 */
function contextLevel(percent: number | null, settings: ContextSettings) {
  if (percent == null) return "unknown";
  if (percent >= settings.triggerPercent) return "high";
  return percent >= settings.triggerPercent * 0.8 ? "near" : "ok";
}

function ContextRing({ percent }: { percent: number | null }) {
  return (
    <svg className="context-panel-ring" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" pathLength="100" />
      <circle
        cx="8"
        cy="8"
        r="6"
        pathLength="100"
        strokeDasharray={`${Math.min(100, percent ?? 0)} 100`}
      />
    </svg>
  );
}

function Fold({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="context-panel-fold">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight size={13} aria-hidden="true" />
        {label}
      </button>
      {/* 折叠只隐藏不卸载：未保存的设置输入在收起后仍保留。 */}
      <div id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

function ContextDetails({ usage, task }: { usage: Usage | null; task: TaskState | null }) {
  const tokens = usage?.stats?.tokens;
  const input = tokens ? tokens.input + tokens.cacheRead + tokens.cacheWrite : 0;
  return (
    <>
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
        </dl>
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
      {usage?.handoff && usage.handoff.methods.length > 0 && (
        <section>
          <h4>{viewCopy.contextMethodPack}</h4>
          <p>
            {viewCopy.contextMethodIntent}
            {usage.handoff.intent}
            {" · "}
            {usage.handoff.intentSource === "focus"
              ? viewCopy.contextMethodFocus
              : viewCopy.contextMethodState}
          </p>
          <ul>
            {usage.handoff.methods.map((method) => (
              <li key={method.id}>
                {method.id} ·{" "}
                {method.trimmed
                  ? viewCopy.contextMethodTrimmed
                  : method.injected
                    ? `${viewCopy.contextMethodInjected} ${formatBytes(method.bytes)}`
                    : viewCopy.contextMethodDeduped}
              </li>
            ))}
          </ul>
        </section>
      )}
      {usage?.compaction && (
        <section>
          <h4>{viewCopy.contextLastCompaction}</h4>
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
        </section>
      )}
    </>
  );
}
export function ContextPanel({
  target,
  busy,
  task,
  initialSettings,
}: {
  initialSettings: ContextSettings;
  target?: Target;
  busy: boolean;
  task: TaskState | null;
}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [working, setWorking] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [message, setMessage] = useState("");
  const [instructions, setInstructions] = useState("");
  const request = useRef({ id: 0 });
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
    const unsubscribe = onDesktopEvent(({ target: changed, event, editor }) => {
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
  const percent = context?.tokens == null ? null : context.percent;
  return (
    <details className="context-panel" data-level={contextLevel(percent, initialSettings)}>
      <summary>
        <ContextRing percent={percent} />
        <span>{AGENT_COPY.contextTitle}</span>
        <span className="context-panel-percent">
          {percent == null ? viewCopy.contextPanelText2 : `${Math.round(percent)}%`}
        </span>
        {usage?.compacting && (
          <span className="context-panel-flag">{AGENT_COPY.contextCompacting}</span>
        )}
      </summary>
      <div className="context-panel-body">
        <p className="context-panel-window">
          {context?.tokens == null
            ? AGENT_COPY.contextUnknown
            : `${AGENT_COPY.contextWindow}${formatCount(context.tokens)} / ${formatCount(context.contextWindow)}`}
          {" · "}
          {initialSettings.enabled
            ? `${AGENT_COPY.contextAuto}${initialSettings.triggerPercent}%`
            : AGENT_COPY.contextAutoOff}
        </p>
        {(task?.usage || tokens) && (
          <dl className="context-panel-usage">
            {task?.usage && (
              <>
                <dt>{AGENT_COPY.contextTask}</dt>
                <dd>
                  {formatTokens(task.usage)} · {formatCost(task.cost > 0 ? task.cost : null)}
                </dd>
              </>
            )}
            {tokens && (
              <>
                <dt>{AGENT_COPY.contextSession}</dt>
                <dd>
                  {formatTokens(tokens)} · {formatCost(estimatedCost > 0 ? estimatedCost : null)}
                </dd>
              </>
            )}
          </dl>
        )}
        <div className="context-panel-actions">
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
            <button
              onClick={() => void desktop.stop(target).catch((e) => setMessage(errorText(e)))}
            >
              {viewCopy.contextPanelText28}
            </button>
          )}
        </div>
        <label className="context-panel-focus">
          {viewCopy.contextPanelText22}
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </label>
        <p className="context-panel-hint">
          {viewCopy.contextPanelText23}
          {AGENT_COPY.contextSettingsHint}
        </p>
        {message && <p role="status">{message}</p>}
        <Fold label={AGENT_COPY.contextDetails}>
          <ContextDetails usage={usage} task={task} />
        </Fold>
      </div>
    </details>
  );
}
