import React, { useEffect, useState } from "react";
import { Check, ChevronLeft, X } from "lucide-react";
import { DESKTOP_COPY as C, formatCost } from "@zhizhang/ui/copy";
import { useRequestGuard } from "@zhizhang/ui/use-request-guard";
import { Button, Empty, Notice, StatusChip } from "@zhizhang/ui/primitives";
import type { RunDetail, RunSummary, Target } from "../../../shared/views";
import { desktop } from "../../state/desktop";
import { errorText } from "../../format";
import { kindLabel, stageLabel, stateLabel, stateTone } from "./workflow-model";

/**
 * 历史运行的只读详情（D13）：阶段时间线（含每阶段用量与备注）、上下文分区、交付回执。
 * 详情经代号守卫拉取（use-request-guard）；不提供任何重跑或改写入口。
 */
export function RunDetailView({
  run,
  target,
  onBack,
}: {
  run: RunSummary;
  target: Target;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState("");
  const keep = useRequestGuard(run.id);

  useEffect(() => {
    const alive = keep();
    desktop
      .getRun({ runId: run.id, target })
      .then((value) => {
        if (alive()) setDetail(value);
      })
      .catch((err: unknown) => {
        if (alive()) setError(errorText(err));
      });
    return () => {
      alive();
    };
  }, [run.id, target, keep]);

  const steps = detail?.steps ?? [];
  const hasContext = steps.some((step) => {
    const value: unknown = Reflect.get(step, "context");
    return typeof value === "object" && value !== null;
  });
  const deliver = [...steps].reverse().find((step) => step.id.startsWith("deliver"));
  const tokens = run.usage.input + run.usage.cachedInput + run.usage.output;

  return (
    <section
      className="zz-run"
      data-testid="run-detail"
      data-state={run.state}
      data-kind={run.kind}
    >
      <header className="zz-run__head">
        <div className="zz-run__title">
          <Button
            size="sm"
            variant="ghost"
            data-testid="run-detail-back"
            aria-label={C.workflow.back}
            onClick={onBack}
          >
            <ChevronLeft size={14} aria-hidden="true" />
            {C.workflow.back}
          </Button>
          <strong>{kindLabel(run.kind)}</strong>
        </div>
        <StatusChip tone={stateTone(run.state)} label={stateLabel(run.state)} dot />
      </header>
      {error ? <Notice tone="bad" message={error} /> : null}
      {detail ? (
        <>
          <section aria-label={C.workflow.stages} className="zz-stack">
            <h4 className="zz-run__section">{C.workflow.stages}</h4>
            <ol className="zz-stages">
              {steps.map((step) => (
                <li
                  key={step.id}
                  className="zz-stage"
                  data-testid="run-detail-stage"
                  data-stage={step.id}
                  data-phase={step.status}
                >
                  {step.status === "failed" ? (
                    <X size={13} aria-hidden="true" className="zz-stage__icon" />
                  ) : (
                    <Check size={13} aria-hidden="true" className="zz-stage__icon" />
                  )}
                  <span className="zz-stage__label">
                    {stageLabel(step.id)}
                    {step.status === "failed" ? ` · ${C.workflow.stepFailed}` : ""}
                  </span>
                  <span className="zz-stage__marks">
                    {C.workflow.usage(
                      step.usage.input + step.usage.cachedInput + step.usage.output,
                      formatCost(step.usage.cost),
                    )}
                  </span>
                  {step.notes?.length ? (
                    <span className="zz-stage__notes">
                      {C.workflow.notes}：{step.notes.join("；")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
          <section aria-label={C.workflow.contextSection} className="zz-stack">
            <h4 className="zz-run__section">{C.workflow.contextSection}</h4>
            {hasContext ? (
              <ul className="zz-stages">
                {steps.map((step) => {
                  const value: unknown = Reflect.get(step, "context");
                  if (typeof value !== "object" || value === null) return null;
                  return (
                    <li key={step.id} className="zz-stage" data-phase="done">
                      <span className="zz-stage__label">{stageLabel(step.id)}</span>
                      <span className="zz-stage__marks">{describeContext(value)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="zz-muted" data-testid="run-detail-context-empty">
                {C.workflow.contextEmpty}
              </p>
            )}
          </section>
          <section
            aria-label={C.workflow.receipt}
            className="zz-stack"
            data-testid="run-detail-receipt"
          >
            <h4 className="zz-run__section">{C.workflow.receipt}</h4>
            <p className="zz-muted">
              {stateLabel(run.state)} · {C.workflow.usage(tokens, formatCost(run.usage.cost))}
            </p>
            {deliver?.notes?.length ? <p className="zz-muted">{deliver.notes.join("；")}</p> : null}
            <p className="zz-muted">
              {new Date(run.updated).toLocaleString("zh-CN", { hour12: false })}
            </p>
          </section>
        </>
      ) : error ? null : (
        <Empty title={C.workflow.detailMissing} />
      )}
    </section>
  );
}

function describeContext(value: object): string {
  const entries = Object.entries(value).filter(([, v]) => typeof v !== "object" || v === null);
  if (!entries.length) return C.workflow.contextEmpty;
  return entries.map(([k, v]) => `${k}=${String(v)}`).join(" · ");
}
