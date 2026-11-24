import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Button, IconButton, Notice, Skeleton } from "@zhizhang/ui/primitives";
import { Manuscript } from "@zhizhang/workbench/client";
import { desktop } from "../../state/desktop";
import { desktopStore, type CompareRequest } from "../../state/store";
import { errorCode, errorText, notifyError } from "../../format";
import {
  buildParagraphDiff,
  mergeParagraphChoices,
  type DiffRowKind,
  type ParagraphDiffRow,
} from "./compare-diff";
import { decideRun } from "./decide";

export interface CompareSides {
  official: { title: string; body: string; revision: string; wordCount: number };
  candidate: { title: string; body: string; wordCount: number };
}

const SOLID = /\s+/g;
const countChars = (text: string) => text.replace(SOLID, "").length;

function kindBadge(kind: DiffRowKind): string {
  switch (kind) {
    case "added":
      return C.compare.badgeAdded;
    case "modified":
      return C.compare.badgeModified;
    case "removed":
      return C.compare.badgeRemoved;
    default:
      return C.compare.badgeSame;
  }
}

/** 读正式稿与候选稿；只有“正式稿不存在”（新章）时左侧为空，读写故障照常报错。 */
export async function loadCompare(
  work: string,
  chapter: string,
  candidateId: string,
): Promise<CompareSides> {
  const [official, candidate] = await Promise.all([
    desktop.workbench("fanqie.chapter.get", { work, chapter }).catch((error: unknown) => {
      if (errorCode(error) === "input.not_found") return null;
      throw error;
    }),
    desktop.workbench("fanqie.candidate.get", { work, chapter, candidateId }),
  ]);
  return {
    official: official
      ? {
          title: official.title,
          body: official.body,
          revision: official.revision,
          wordCount: countChars(official.body),
        }
      : { title: "", body: "", revision: "", wordCount: 0 },
    candidate: { title: candidate.title, body: candidate.body, wordCount: candidate.wordCount },
  };
}

function DiffRows({
  rows,
  choices,
  activeRow,
  onPick,
}: {
  rows: readonly ParagraphDiffRow[];
  choices: Readonly<Record<number, "official" | "candidate">>;
  activeRow: number;
  onPick: (index: number, side: "official" | "candidate") => void;
}) {
  const rowRefs = useRef<Record<number, HTMLElement | null>>({});

  useEffect(() => {
    const el = rowRefs.current[activeRow];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeRow]);

  return (
    <div className="zz-diff-list" data-testid="compare-diff-list">
      {rows.map((row) => {
        const pick = choices[row.index] ?? "candidate";
        const changed = row.kind !== "same";
        return (
          <article
            key={row.index}
            ref={(node) => {
              rowRefs.current[row.index] = node;
            }}
            className="zz-diff-row"
            data-kind={row.kind}
            data-active={activeRow === row.index}
            data-pick={changed ? pick : "same"}
          >
            <header className="zz-diff-row__head">
              <span className="zz-diff-row__num">{String(row.index + 1).padStart(2, "0")}</span>
              <span className="zz-diff-row__badge" data-kind={row.kind}>
                {kindBadge(row.kind)}
              </span>
              {changed ? (
                <div className="zz-diff-row__pick" role="group">
                  <button
                    type="button"
                    className="zz-diff-pick"
                    aria-pressed={pick === "official"}
                    onClick={() => onPick(row.index, "official")}
                  >
                    {C.compare.keepOfficial}
                  </button>
                  <button
                    type="button"
                    className="zz-diff-pick"
                    aria-pressed={pick === "candidate"}
                    onClick={() => onPick(row.index, "candidate")}
                  >
                    {C.compare.useCandidate}
                  </button>
                </div>
              ) : null}
            </header>
            <div className="zz-diff-row__cols">
              <div
                className="zz-diff-cell zz-diff-cell--official"
                data-selected={changed && pick === "official"}
              >
                {row.official || "—"}
              </div>
              <div
                className="zz-diff-cell zz-diff-cell--candidate"
                data-selected={changed && pick === "candidate"}
              >
                {row.candidate || "—"}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/**
 * 中栏对照视图：支持「逐段对照 + 局部采纳（Cherry-pick）」与「双栏纯稿」两种视角。
 * 整章采纳 / 放弃走 decideRun；局部采纳通过 fanqie.chapter.save 经作者显式确认保存。
 */
export function CompareView({ request, kind }: { request: CompareRequest; kind: string }) {
  const [sides, setSides] = useState<CompareSides | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"diff" | "side">("diff");
  const [choices, setChoices] = useState<Record<number, "official" | "candidate">>({});
  const [cursor, setCursor] = useState(0);
  const close = () => desktopStore.set({ compare: null });

  useEffect(() => {
    let alive = true;
    setSides(null);
    setError("");
    setChoices({});
    setCursor(0);
    loadCompare(request.target.path, request.chapter, request.runId)
      .then((value) => alive && setSides(value))
      .catch((err: unknown) => alive && setError(errorText(err)));
    return () => {
      alive = false;
    };
  }, [request]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const diff = useMemo(
    () => (sides ? buildParagraphDiff(sides.official.body, sides.candidate.body) : null),
    [sides],
  );

  const changeCount = diff?.changeIndices.length ?? 0;
  const activeRow = diff && changeCount > 0 ? (diff.changeIndices[cursor % changeCount] ?? -1) : -1;
  const selectedCandCount = useMemo(() => {
    if (!diff) return 0;
    return diff.changeIndices.filter((idx) => (choices[idx] ?? "candidate") === "candidate").length;
  }, [diff, choices]);

  const decide = async (decision: "apply" | "discard") => {
    setBusy(true);
    try {
      await decideRun(
        request.target,
        { id: request.runId, kind },
        request.chapter,
        decision,
        sides,
      );
      close();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  const savePartial = async () => {
    if (!sides || !diff) return;
    setBusy(true);
    try {
      const merged = mergeParagraphChoices(diff.rows, choices);
      await desktop.workbench("fanqie.chapter.save", {
        work: request.target.path,
        chapter: request.chapter,
        base: sides.official.revision,
        body: merged,
        title: sides.candidate.title || sides.official.title || undefined,
      });
      await desktop
        .decideRun({ target: request.target, runId: request.runId }, "discard")
        .catch(() => undefined);
      notify({ tone: "success", text: C.compare.mergeSaved });
      close();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  const stepChange = (deltaStep: number) => {
    if (!changeCount) return;
    setCursor((prev) => (prev + deltaStep + changeCount) % changeCount);
  };

  const delta = sides ? sides.candidate.wordCount - sides.official.wordCount : 0;
  const hasPartialMix = changeCount > 0 && selectedCandCount > 0 && selectedCandCount < changeCount;

  return (
    <section
      className="zz-compare"
      data-testid="workflow-compare-view"
      aria-label={C.workflow.compareTitle}
    >
      <header className="wb-bar zz-compare__bar">
        <div className="wb-bar-lead">
          <span className="wb-bar-ordinal">{C.workflow.compareTitle}</span>
          <span className="zz-compare__hint">{C.workflow.compareHint(request.chapter)}</span>
          {sides ? <span className="zz-compare__delta">{C.workflow.wordsDelta(delta)}</span> : null}
          {diff ? (
            <span className="zz-compare__delta" data-testid="compare-changes">
              {changeCount ? C.compare.changesCount(changeCount) : C.compare.noChanges}
            </span>
          ) : null}
        </div>
        <div className="wb-bar-actions">
          <div className="zz-segmented zz-segmented--sm" role="tablist">
            <button
              type="button"
              role="tab"
              className="zz-segmented__item"
              aria-selected={mode === "diff"}
              data-testid="compare-mode-diff"
              onClick={() => setMode("diff")}
            >
              {C.compare.modeDiff}
            </button>
            <button
              type="button"
              role="tab"
              className="zz-segmented__item"
              aria-selected={mode === "side"}
              data-testid="compare-mode-side"
              onClick={() => setMode("side")}
            >
              {C.compare.modeSide}
            </button>
          </div>
          {mode === "diff" && changeCount > 0 ? (
            <>
              <IconButton
                size="sm"
                label={C.compare.prevChange}
                icon={<ChevronUp size={14} />}
                onClick={() => stepChange(-1)}
              />
              <IconButton
                size="sm"
                label={C.compare.nextChange}
                icon={<ChevronDown size={14} />}
                onClick={() => stepChange(1)}
              />
            </>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            data-testid="workflow-discard"
            disabled={busy || !sides}
            onClick={() => void decide("discard")}
          >
            {C.workflow.discard}
          </Button>
          {mode === "diff" && hasPartialMix ? (
            <Button
              size="sm"
              data-testid="workflow-merge-partial"
              loading={busy}
              disabled={!sides}
              onClick={() => void savePartial()}
            >
              {C.compare.mergeSave}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            data-testid="workflow-adopt"
            loading={busy}
            disabled={!sides}
            onClick={() => void decide("apply")}
          >
            {C.workflow.adoptCandidate}
          </Button>
          <IconButton
            size="sm"
            label={C.workflow.closeCompare}
            data-testid="compare-close"
            icon={<X size={15} />}
            onClick={close}
          />
        </div>
      </header>
      {error ? (
        <div className="zz-compare__error">
          <Notice tone="bad" message={error} />
        </div>
      ) : !sides || !diff ? (
        <div className="zz-compare__cols">
          <div className="zz-compare__col">
            <Skeleton lines={10} />
          </div>
          <div className="zz-compare__col">
            <Skeleton lines={10} />
          </div>
        </div>
      ) : mode === "diff" ? (
        <div className="zz-compare__diff-wrap">
          <div className="zz-compare__diff-subbar">
            <span>
              {C.workflow.official} · {C.workflow.words(sides.official.wordCount)}
            </span>
            <span>
              {changeCount ? C.compare.selectedSummary(selectedCandCount, changeCount) : ""}
            </span>
            <span>
              {C.workflow.candidate} · {C.workflow.words(sides.candidate.wordCount)}
            </span>
          </div>
          <DiffRows
            rows={diff.rows}
            choices={choices}
            activeRow={activeRow}
            onPick={(idx, side) => setChoices((prev) => ({ ...prev, [idx]: side }))}
          />
        </div>
      ) : (
        <div className="zz-compare__cols">
          <section
            className="zz-compare__col"
            data-testid="compare-official"
            aria-label={C.workflow.official}
          >
            <h3 className="zz-compare__head">
              {C.workflow.official}
              <span>{C.workflow.words(sides.official.wordCount)}</span>
            </h3>
            <div className="zz-compare__body">
              <Manuscript
                text={sides.official.body}
                title={sides.official.title}
                emptyText={C.workflow.noOfficial}
              />
            </div>
          </section>
          <section
            className="zz-compare__col"
            data-testid="compare-candidate"
            aria-label={C.workflow.candidate}
          >
            <h3 className="zz-compare__head">
              {C.workflow.candidate}
              <span>{C.workflow.words(sides.candidate.wordCount)}</span>
            </h3>
            <div className="zz-compare__body">
              <Manuscript text={sides.candidate.body} title={sides.candidate.title} />
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
