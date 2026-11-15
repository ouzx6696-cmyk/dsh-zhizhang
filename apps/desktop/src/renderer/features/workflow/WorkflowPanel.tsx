import React, { useEffect, useState } from "react";
import { Check, GitCompare, Hourglass } from "lucide-react";
import { COPY, DESKTOP_COPY as C, ERROR_COPY, formatCost } from "@zhizhang/ui/copy";
import { Button, Empty, Notice, Select, Spinner, StatusChip } from "@zhizhang/ui/primitives";
import type { RunDetail, RunSummary, Target, WorkflowAction } from "../../../shared/views";
import { askConfirm } from "../../state/confirm";
import { desktop } from "../../state/desktop";
import { baseName, desktopStore, sameTarget, useDesktop } from "../../state/store";
import { errorText, notifyError } from "../../format";
import { TextField } from "../workspace/TextField";
import { decideRun } from "./decide";
import {
  hasCandidate,
  isOpen,
  kindLabel,
  newer,
  progressGroups,
  progressIndex,
  requestField,
  runActions,
  stageGroup,
  stageRows,
  stateLabel,
  stateTone,
  type StageRow,
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

  const chapterOptions = chapters.map((c, index) => ({
    value: c.id,
    label: C.workflow.chapterRef(index + 1, c.title && c.title !== c.id ? c.title : ""),
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
        variant="strong"
        data-testid="workflow-start"
        loading={busy}
        disabled={!ready}
      >
        {C.workflow.start}
      </Button>
    </form>
  );
}

/** 分屏（≥1600）时右栏上半只够放进度与决定：任务不在运行时，阶段明细折叠成一行。 */
function StageSection({ run, compact }: { run: RunSummary; compact: boolean }) {
  if (!compact || run.state === "running") return <StageList run={run} />;
  return (
    <details className="zz-stage-details" data-testid="workflow-stage-details">
      <summary>{C.workflow.stagesSummary(stageRows(run.stages).length)}</summary>
      <StageList run={run} />
    </details>
  );
}

function StageList({ run }: { run: RunSummary }) {
  const groups = progressGroups(run.kind);
  const rows = stageRows(run.stages);
  const live = run.state === "running";
  const current = progressIndex(run);
  if (!groups.length)
    return (
      <ol className="zz-stages" aria-label={C.workflow.stages}>
        {rows.map((row) => (
          <StageItem key={row.key} row={row} />
        ))}
        {live ? <LiveItem /> : null}
      </ol>
    );
  return (
    <div className="zz-stage-groups" aria-label={C.workflow.stages} role="group">
      {groups.map((label, index) => {
        const members = rows.filter((row) => stageGroup(run.kind, row.ids[0]) === index);
        const state =
          index < current || run.state === "awaiting-author" || run.state === "applied"
            ? "done"
            : index === current
              ? run.state === "failed"
                ? "failed"
                : live
                  ? "current"
                  : "paused"
              : "todo";
        return (
          <section key={label} className="zz-stage-group" data-state={state}>
            <h4 className="zz-stage-group__head">
              <span className="zz-stage-group__mark" aria-hidden="true" />
              {label}
            </h4>
            {members.length || (state === "current" && live) ? (
              <ol className="zz-stages">
                {members.map((row) => (
                  <StageItem key={row.key} row={row} />
                ))}
                {state === "current" && live ? <LiveItem /> : null}
              </ol>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function StageItem({ row }: { row: StageRow }) {
  return (
    <li
      className="zz-stage"
      data-testid="workflow-stage"
      data-stage={row.ids.join(" ")}
      data-phase="done"
    >
      <Check size={13} aria-hidden="true" className="zz-stage__icon" />
      <span className="zz-stage__label">{row.label}</span>
      {row.marks.length ? <span className="zz-stage__marks">{row.marks.join(" · ")}</span> : null}
    </li>
  );
}

function LiveItem() {
  return (
    <li
      className="zz-stage zz-stage--live"
      data-testid="workflow-stage"
      data-stage=""
      data-phase="running"
    >
      <Spinner size="sm" label={C.workflow.live} className="zz-stage__icon" />
      <span className="zz-stage__label">{C.workflow.live}</span>
    </li>
  );
}

function ProgressTrack({ run }: { run: RunSummary }) {
  const groups = progressGroups(run.kind);
  if (!groups.length) return null;
  const current = progressIndex(run);
  return (
    <div
      className="zz-track"
      data-testid="workflow-progress"
      data-step={current}
      data-total={groups.length}
      data-state={run.state}
      role="progressbar"
      aria-label={C.workflow.progress}
      aria-valuemin={0}
      aria-valuemax={groups.length}
      aria-valuenow={Math.min(current, groups.length)}
      aria-valuetext={groups[Math.min(current, groups.length - 1)]}
    >
      {groups.map((label, index) => (
        <span
          key={label}
          className="zz-track__step"
          data-state={index < current ? "done" : index === current ? "current" : "todo"}
        >
          <i className="zz-track__seg" aria-hidden="true" />
          <span className="zz-track__label">{label}</span>
        </span>
      ))}
    </div>
  );
}

function RunView({
  run,
  detail,
  onAction,
  onDecide,
  busy,
  compact,
}: {
  run: RunSummary;
  detail: RunDetail | null;
  onAction: (action: WorkflowAction) => void;
  onDecide: (decision: "apply" | "discard") => void;
  busy: boolean;
  compact: boolean;
}) {
  const chapter = requestField(detail, "chapterId");
  const chapters = useDesktop((s) => s.chapters);
  const compare = useDesktop((s) => s.compare);
  const awaiting = run.state === "awaiting-author";
  const tokens = run.usage.input + run.usage.cachedInput + run.usage.output;
  const chapterAt = chapters.findIndex((c) => c.id === chapter);
  const chapterTitle = chapterAt >= 0 ? chapters[chapterAt].title : undefined;
  const candidate = hasCandidate(run.kind) && Boolean(chapter);
  const comparing = compare?.runId === run.id;
  const actions = runActions(run.state);
  const groups = progressGroups(run.kind);
  const at = Math.min(progressIndex(run), groups.length - 1);
  return (
    <section
      className="zz-run"
      data-testid="workflow-run"
      data-state={run.state}
      data-kind={run.kind}
    >
      <header className="zz-run__head">
        <div className="zz-run__title">
          <strong>{kindLabel(run.kind)}</strong>
          {chapter ? (
            <span className="zz-run__target" data-testid="workflow-target">
              {chapterAt >= 0
                ? C.workflow.chapterRef(
                    chapterAt + 1,
                    chapterTitle && chapterTitle !== chapter ? chapterTitle : "",
                  )
                : chapter}
            </span>
          ) : null}
        </div>
        <StatusChip tone={stateTone(run.state)} label={stateLabel(run.state)} dot />
      </header>
      <ProgressTrack run={run} />
      {/* 读屏只宣告阶段级变化：当前分组与状态，不朗读用量数字。 */}
      <p className="zz-hidden-value" aria-live="polite">
        {groups.length && at >= 0
          ? C.workflow.groupLabel(stateLabel(run.state), groups[at])
          : stateLabel(run.state)}
      </p>
      {awaiting ? (
        <div className="zz-decide" data-testid="workflow-decide">
          <p className="zz-decide__title">
            <Hourglass size={14} aria-hidden="true" />
            {COPY["workflow.awaiting_author"]}
          </p>
          <p className="zz-decide__hint">
            {candidate
              ? comparing
                ? C.workflow.compareOpened
                : C.workflow.decideCandidate
              : C.workflow.decideGeneric}
          </p>
          <div className="zz-row">
            {candidate ? (
              <Button
                variant="strong"
                size="sm"
                data-testid="workflow-compare"
                disabled={comparing}
                onClick={() =>
                  desktopStore.set({
                    compare: { target: run.target, runId: run.id, chapter },
                    view: "writing",
                  })
                }
              >
                <GitCompare size={14} aria-hidden="true" />
                {C.workflow.openCompare}
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="workflow-adopt"
                  disabled={busy}
                  onClick={() => onDecide("apply")}
                >
                  {C.workflow.adopt}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="workflow-discard"
                  disabled={busy}
                  onClick={() => onDecide("discard")}
                >
                  {C.workflow.discard}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
      {run.error ? (
        <Notice tone="bad" message={ERROR_COPY[run.error.code]} detail={run.error.message} />
      ) : null}
      <StageSection run={run} compact={compact} />
      <footer className="zz-run__foot">
        <span className="zz-run__usage" data-testid="workflow-usage">
          {C.workflow.usage(tokens, formatCost(run.usage.cost))}
        </span>
        {actions.length ? (
          <span className="zz-run__actions" role="group" aria-label={C.workflow.controls}>
            {actions.map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === "stop" ? "ghost" : "secondary"}
                data-testid={`workflow-${action}`}
                disabled={busy}
                onClick={() => onAction(action)}
              >
                {COPY[`workflow.action.${action}`]}
              </Button>
            ))}
          </span>
        ) : null}
      </footer>
    </section>
  );
}

function History({ runs, currentId }: { runs: RunSummary[]; currentId: string }) {
  const past = runs.filter((r) => r.id !== currentId);
  if (!past.length) return null;
  return (
    <details className="zz-history" data-testid="workflow-history">
      <summary>{C.workflow.history(past.length)}</summary>
      <ul className="zz-history__list">
        {past.map((r) => (
          <li key={r.id} data-testid="workflow-history-item" data-state={r.state}>
            <span className="zz-history__kind">{kindLabel(r.kind)}</span>
            <StatusChip tone={stateTone(r.state)} label={stateLabel(r.state)} />
            <span className="zz-history__time">
              {new Date(r.created).toLocaleString("zh-CN", {
                hour12: false,
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** 右栏“流水线”：发起 → 阶段进度 → 等你决定（候选稿对照 → 采纳/放弃）；历史折叠在底部。 */
export function WorkflowPanel({ target, compact = false }: { target: Target; compact?: boolean }) {
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

  const onDecide = (decision: "apply" | "discard") => {
    if (!current) return;
    const chapter = requestField(detail, "chapterId");
    void act(() => decideRun(target, current, chapter, decision, null));
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
          compact={compact}
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
