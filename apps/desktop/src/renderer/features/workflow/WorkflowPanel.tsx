import React, { useCallback, useEffect, useState } from "react";
import { COPY, DESKTOP_COPY as C, ERROR_COPY, formatCost } from "@zhizhang/ui/copy";
import { Button, Empty, Notice, Select, StatusChip, Steps } from "@zhizhang/ui/primitives";
import type { RunDetail, RunSummary, Target, WorkflowAction } from "../../../shared/views";
import { askConfirm } from "../../state/confirm";
import { desktop } from "../../state/desktop";
import { baseName, desktopStore, sameTarget, useDesktop } from "../../state/store";
import { errorText, notifyError } from "../../format";
import { TextField } from "../workspace/TextField";
import { DraftCompare, type CompareSides } from "./DraftCompare";
import {
  hasCandidate,
  isOpen,
  kindLabel,
  newer,
  progressGroups,
  progressIndex,
  requestField,
  runActions,
  stageLabel,
  stateLabel,
  stateTone,
} from "./workflow-model";

type StartKind =
  "fanqie.chapter" | "fanqie.review" | "fanqie.revise" | "fanqie.health" | "toutiao.article";

const FANQIE_KINDS: StartKind[] = [
  "fanqie.chapter",
  "fanqie.review",
  "fanqie.revise",
  "fanqie.health",
];

function StartForm({
  target,
  onStarted,
}: {
  target: Target;
  onStarted: (run: RunSummary) => void;
}) {
  const chapters = useDesktop((s) => s.chapters);
  const preset = useDesktop((s) => s.pipelineChapter);
  const focusChapter = useDesktop((s) => s.focus.chapter);
  const readonly = useDesktop((s) => Boolean(s.workspace?.readonly));
  const root = useDesktop((s) => s.workspace?.roots.toutiao ?? "");
  const [kind, setKind] = useState<StartKind>(
    target.mode === "toutiao" ? "toutiao.article" : "fanqie.chapter",
  );
  const [chapter, setChapter] = useState(preset || focusChapter || chapters[0]?.id || "");
  const [note, setNote] = useState("");
  const [article, setArticle] = useState<{ genre: string; driver: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (preset) {
      setChapter(preset);
      desktopStore.set({ pipelineChapter: "" });
    }
  }, [preset]);

  useEffect(() => {
    if (target.mode !== "toutiao" || !root) return;
    let alive = true;
    desktop
      .workbench("toutiao.articles", { root })
      .then(({ rows }) => {
        const row = rows.find((r) => r.id === baseName(target.path));
        if (alive && row) setArticle({ genre: row.genre, driver: row.driver });
      })
      .catch(notifyError);
    return () => {
      alive = false;
    };
  }, [target, root]);

  const request = (): unknown => {
    const extra = note.trim() ? { note: note.trim() } : {};
    switch (kind) {
      case "toutiao.article":
        return {
          articleId: baseName(target.path),
          genre: article?.genre ?? "",
          driver: article?.driver ?? "",
          ...extra,
        };
      case "fanqie.health":
        return { upToChapter: Math.max(1, chapters.length) };
      default:
        return { chapterId: chapter, ...extra };
    }
  };
  const ready =
    !readonly &&
    (kind === "toutiao.article"
      ? article !== null
      : kind === "fanqie.health"
        ? chapters.length > 0
        : chapter.trim() !== "");

  const start = async () => {
    setBusy(true);
    try {
      const ref = await desktop.startRun(target, { kind, request: request() });
      const detail = await desktop.getRun(ref);
      if (detail)
        onStarted({
          id: detail.id,
          kind: detail.kind,
          target,
          state: detail.state,
          stages: detail.steps.map((s) => s.id),
          usage: detail.usage,
          created: detail.created,
          updated: detail.updated,
        });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };

  const chapterOptions = chapters.map((c) => ({
    value: c.id,
    label: c.title && c.title !== c.id ? `${c.id} · ${c.title}` : c.id,
  }));
  return (
    <form
      className="zz-stack"
      data-testid="workflow-start-form"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      {target.mode === "fanqie" ? (
        <Select<StartKind>
          label={C.workflow.kindLabel}
          testId="workflow-kind"
          value={kind}
          options={FANQIE_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
          onChange={setKind}
        />
      ) : null}
      {target.mode === "fanqie" && kind !== "fanqie.health" ? (
        chapterOptions.length ? (
          <Select
            label={C.workflow.chapter}
            testId="workflow-chapter"
            value={chapter}
            placeholder={C.workflow.pickChapter}
            options={chapterOptions}
            onChange={setChapter}
          />
        ) : (
          <TextField
            label={C.workflow.chapter}
            value={chapter}
            onChange={setChapter}
            testId="workflow-chapter"
            hint={C.fanqie.chapterIdHint}
          />
        )
      ) : null}
      {kind !== "fanqie.health" ? (
        <TextField
          label={C.workflow.note}
          value={note}
          onChange={setNote}
          testId="workflow-note"
          multiline
          placeholder={C.workflow.notePlaceholder}
        />
      ) : null}
      <Button
        type="submit"
        variant="primary"
        data-testid="workflow-start"
        loading={busy}
        disabled={!ready}
      >
        {C.workflow.start}
      </Button>
    </form>
  );
}

function RunView({
  run,
  detail,
  onAction,
  onDecide,
  busy,
}: {
  run: RunSummary;
  detail: RunDetail | null;
  onAction: (action: WorkflowAction) => void;
  onDecide: (decision: "apply" | "discard", sides: CompareSides | null) => void;
  busy: boolean;
}) {
  const [sides, setSides] = useState<CompareSides | null>(null);
  const onLoaded = useCallback((value: CompareSides | null) => setSides(value), []);
  const groups = progressGroups(run.kind);
  const chapter = requestField(detail, "chapterId");
  const awaiting = run.state === "awaiting-author";
  const tokens = run.usage.input + run.usage.cachedInput + run.usage.output;
  return (
    <section
      className="zz-run"
      data-testid="workflow-run"
      data-state={run.state}
      data-kind={run.kind}
      aria-live="polite"
    >
      <header className="zz-run__head">
        <strong>{kindLabel(run.kind)}</strong>
        {chapter ? <span className="zz-muted">{chapter}</span> : null}
        <StatusChip tone={stateTone(run.state)} label={stateLabel(run.state)} dot />
      </header>
      {groups.length ? (
        <div
          data-testid="workflow-progress"
          data-step={progressIndex(run)}
          data-total={groups.length}
        >
          <Steps steps={groups} current={progressIndex(run)} label={C.workflow.progress} />
        </div>
      ) : null}
      <ol className="zz-stages" aria-label={C.workflow.stages}>
        {run.stages.map((id, index) => (
          <li key={id + index} data-testid="workflow-stage" data-stage={id} data-phase="done">
            {stageLabel(id)}
          </li>
        ))}
        {run.state === "running" ? (
          <li
            data-testid="workflow-stage"
            data-stage=""
            data-phase="running"
            className="zz-stages__live"
          >
            {C.workflow.working}
          </li>
        ) : null}
      </ol>
      <p className="zz-muted" data-testid="workflow-usage">
        {C.workflow.usage(tokens, formatCost(run.usage.cost))}
      </p>
      {run.error ? (
        <Notice tone="bad" message={ERROR_COPY[run.error.code]} detail={run.error.message} />
      ) : null}
      {runActions(run.state).length ? (
        <div className="zz-row">
          {runActions(run.state).map((action) => (
            <Button
              key={action}
              size="sm"
              data-testid={`workflow-${action}`}
              disabled={busy}
              onClick={() => onAction(action)}
            >
              {COPY[`workflow.action.${action}`]}
            </Button>
          ))}
        </div>
      ) : null}
      {awaiting ? (
        <div className="zz-decide" data-testid="workflow-decide">
          <p className="zz-decide__title">{COPY["workflow.awaiting_author"]}</p>
          {hasCandidate(run.kind) && chapter && detail ? (
            <DraftCompare
              work={run.target.path}
              chapter={chapter}
              candidateId={run.id}
              onLoaded={onLoaded}
            />
          ) : null}
          <div className="zz-row">
            <Button
              variant="primary"
              data-testid="workflow-adopt"
              disabled={busy}
              onClick={() => onDecide("apply", sides)}
            >
              {C.workflow.adopt}
            </Button>
            <Button
              data-testid="workflow-discard"
              disabled={busy}
              onClick={() => onDecide("discard", sides)}
            >
              {C.workflow.discard}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function History({ runs, currentId }: { runs: RunSummary[]; currentId: string }) {
  const past = runs.filter((r) => r.id !== currentId);
  if (!past.length) return null;
  return (
    <details className="zz-history" data-testid="workflow-history">
      <summary>{C.workflow.history(past.length)}</summary>
      <ul className="zz-list">
        {past.map((r) => (
          <li key={r.id} data-testid="workflow-history-item" data-state={r.state}>
            <span>{kindLabel(r.kind)}</span>
            <StatusChip tone={stateTone(r.state)} label={stateLabel(r.state)} />
            <span className="zz-muted">
              {new Date(r.created).toLocaleString("zh-CN", { hour12: false })}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** 右栏“流水线”：发起 → 阶段进度 → 等你决定（候选稿对照 → 采纳/放弃）；历史折叠在底部。 */
export function WorkflowPanel({ target }: { target: Target }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [current, setCurrent] = useState<RunSummary | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    desktop
      .runHistory(target)
      .then((list) => {
        if (!alive) return;
        const sorted = [...list].sort((a, b) => b.created.localeCompare(a.created));
        setRuns(sorted);
        setCurrent((prev) => prev ?? sorted[0] ?? null);
      })
      .catch((err: unknown) => alive && setError(errorText(err)));
    const off = desktop.subscribe((event) => {
      if (event.kind !== "run" || !sameTarget(event.target, target)) return;
      setCurrent((prev) => newer(prev, event.run));
      setRuns((prev) => [event.run, ...prev.filter((r) => r.id !== event.run.id)]);
    });
    return () => {
      alive = false;
      off();
    };
  }, [target]);

  const currentId = current?.id ?? "";
  useEffect(() => {
    if (!currentId) return setDetail(null);
    let alive = true;
    desktop
      .getRun({ runId: currentId, target })
      .then((value) => alive && setDetail(value))
      .catch(notifyError);
    return () => {
      alive = false;
    };
  }, [currentId, target]);

  const act = async (task: () => Promise<RunSummary>) => {
    setBusy(true);
    try {
      const next = await task();
      setCurrent((prev) => newer(prev, next));
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  const onAction = (action: WorkflowAction) => {
    if (!current) return;
    const ref = { runId: current.id, target };
    void (async () => {
      if (action === "stop" && !(await askConfirm(C.workflow.stopConfirm))) return;
      await act(() => desktop.controlRun(ref, action));
    })();
  };

  const onDecide = (decision: "apply" | "discard", sides: CompareSides | null) => {
    if (!current) return;
    const ref = { runId: current.id, target };
    const chapter = requestField(detail, "chapterId");
    void act(async () => {
      // 章节候选稿：先经写作区命令落盘（采纳写正文 / 放弃记拒收），再结束这次运行。
      if (hasCandidate(current.kind) && chapter && sides) {
        if (decision === "apply")
          await desktop.workbench("fanqie.candidate.accept", {
            work: target.path,
            chapter,
            candidateId: current.id,
            base: sides.official.revision,
          });
        else
          await desktop.workbench("fanqie.candidate.reject", {
            work: target.path,
            chapter,
            candidateId: current.id,
          });
      }
      return desktop.decideRun(ref, decision);
    });
  };

  return (
    <div className="zz-workflow" data-testid="workflow-panel">
      {error ? <Notice tone="bad" message={error} /> : null}
      {current ? (
        <RunView
          run={current}
          detail={detail}
          busy={busy}
          onAction={onAction}
          onDecide={onDecide}
        />
      ) : null}
      {!current ? <Empty title={C.workflow.empty} description={C.workflow.emptyHint} /> : null}
      {!current || !isOpen(current.state) ? (
        <StartForm target={target} onStarted={setCurrent} />
      ) : null}
      <History runs={runs} currentId={currentId} />
    </div>
  );
}
