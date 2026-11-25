import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Button, IconButton, Notice, Skeleton } from "@zhizhang/ui/primitives";
import { desktop } from "../../state/desktop";
import { desktopStore, useDesktop, type CompareRequest } from "../../state/store";
import { errorCode, errorText, notifyError } from "../../format";
import { buildParagraphDiff, computeDiffStats, mergeParagraphChoices } from "./compare-diff";
import { CompareSheets } from "./CompareSheets";
import { decideRun } from "./decide";

export interface CompareSides {
  official: { title: string; body: string; revision: string; wordCount: number };
  candidate: { title: string; body: string; wordCount: number };
}

const SOLID = /\s+/g;
const countChars = (text: string) => text.replace(SOLID, "").length;

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

/**
 * 柔和纸面 C2 裁决与双稿纸对照视图：
 * 1. 顶部决策卡（左 3px 赭橙竖条、衬线标题、改动/增删/提醒 chip、文本丢弃 < 次部分采纳 < 主采纳候选稿）
 * 2. 两张并排浮起稿纸（当前稿 / 候选稿）：行内红删绿增、左边距 18px 圆形编号、聚焦反色与「✓ 采纳此处 / 保留原文」
 */
export function CompareView({ request, kind }: { request: CompareRequest; kind: string }) {
  const [sides, setSides] = useState<CompareSides | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Record<number, "official" | "candidate">>({});
  const [cursor, setCursor] = useState(0);
  const hunkRefs = useRef<Record<number, HTMLElement | null>>({});
  const pendingBible = useDesktop((s) => s.selected?.pendingBible ?? 0);
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
  const stats = useMemo(() => (diff ? computeDiffStats(diff) : null), [diff]);

  const changeCount = diff?.changeIndices.length ?? 0;
  const activeRow = diff && changeCount > 0 ? (diff.changeIndices[cursor % changeCount] ?? -1) : -1;

  const hunkNumberByRow = useMemo(() => {
    const map = new Map<number, number>();
    if (diff) diff.changeIndices.forEach((rowIdx, idx) => map.set(rowIdx, idx + 1));
    return map;
  }, [diff]);

  const selectedCandCount = useMemo(() => {
    if (!diff) return 0;
    return diff.changeIndices.filter((idx) => (choices[idx] ?? "candidate") === "candidate").length;
  }, [diff, choices]);

  useEffect(() => {
    const el = hunkRefs.current[activeRow];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeRow]);

  const saveUndoSnapshot = () => {
    if (!sides) return;
    desktopStore.set({
      adoptedUndo: {
        target: request.target,
        chapter: request.chapter,
        title: sides.official.title,
        body: sides.official.body,
      },
    });
  };

  const decide = async (decision: "apply" | "discard") => {
    setBusy(true);
    try {
      if (decision === "apply") saveUndoSnapshot();
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
      saveUndoSnapshot();
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

  return (
    <section
      className="zz-compare"
      data-testid="workflow-compare-view"
      aria-label={C.workflow.compareTitle}
    >
      {/* 1. 浮起决策卡：左侧 3px 赭橙竖条 */}
      <header className="zz-decision-card" data-testid="decision-card">
        <div className="zz-decision-card__main">
          <div className="zz-decision-card__head">
            <h2 className="zz-decision-card__title">{C.rail.decisionTitle}</h2>
            {changeCount > 0 ? (
              <div className="zz-decision-card__nav">
                <IconButton
                  size="xs"
                  variant="ghost"
                  label={C.compare.prevChange}
                  icon={<ChevronUp size={13} />}
                  onClick={() => stepChange(-1)}
                />
                <span className="zz-decision-card__pos">
                  {(cursor % changeCount) + 1}/{changeCount}
                </span>
                <IconButton
                  size="xs"
                  variant="ghost"
                  label={C.compare.nextChange}
                  icon={<ChevronDown size={13} />}
                  onClick={() => stepChange(1)}
                />
              </div>
            ) : null}
          </div>
          <p className="zz-decision-card__sub">
            {C.workflow.compareHint(request.chapter)}
            {sides ? ` · ${C.workflow.wordsDelta(delta)}` : ""}
            {changeCount ? ` · ${C.compare.selectedSummary(selectedCandCount, changeCount)}` : ""}
          </p>
          {stats ? (
            <div className="zz-decision-card__chips" data-testid="compare-changes">
              <span className="zz-dchip zz-dchip--neutral">
                {changeCount ? C.compare.changesCount(changeCount) : C.compare.noChanges}
              </span>
              {stats.addedChars > 0 ? (
                <span className="zz-dchip zz-dchip--ok">{C.rail.addedChars(stats.addedChars)}</span>
              ) : null}
              {stats.removedChars > 0 ? (
                <span className="zz-dchip zz-dchip--bad">
                  {C.rail.removedChars(stats.removedChars)}
                </span>
              ) : null}
              {pendingBible > 0 ? (
                <span className="zz-dchip zz-dchip--warn">
                  {C.rail.pendingAlerts(pendingBible)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="zz-decision-card__actions">
          <Button
            size="sm"
            variant="text"
            data-testid="workflow-discard"
            disabled={busy || !sides}
            onClick={() => void decide("discard")}
          >
            {C.rail.decisionDiscard}
          </Button>
          {changeCount > 0 ? (
            <Button
              size="sm"
              variant="soft"
              data-testid="workflow-merge-partial"
              loading={busy}
              disabled={!sides}
              onClick={() => void savePartial()}
            >
              {C.rail.decisionPartial}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="decide"
            data-testid="workflow-adopt"
            loading={busy}
            disabled={!sides}
            onClick={() => void decide("apply")}
          >
            {C.rail.decisionAccept}
          </Button>
          <IconButton
            size="xs"
            variant="ghost"
            label={C.workflow.closeCompare}
            data-testid="compare-close"
            icon={<X size={14} />}
            onClick={close}
          />
        </div>
      </header>

      {/* 2. 两张浮起稿纸并排对照 */}
      {error ? (
        <div className="zz-compare__error">
          <Notice tone="bad" message={error} />
        </div>
      ) : !sides || !diff ? (
        <div className="zz-compare-sheets">
          <div className="zz-compare-sheet">
            <Skeleton lines={10} />
          </div>
          <div className="zz-compare-sheet">
            <Skeleton lines={10} />
          </div>
        </div>
      ) : (
        <CompareSheets
          sides={sides}
          diff={diff}
          hunkNumberByRow={hunkNumberByRow}
          activeRow={activeRow}
          choices={choices}
          hunkRefs={hunkRefs}
          onSelectCursor={setCursor}
          onChoose={(rowIndex, side) => setChoices((prev) => ({ ...prev, [rowIndex]: side }))}
        />
      )}
    </section>
  );
}
