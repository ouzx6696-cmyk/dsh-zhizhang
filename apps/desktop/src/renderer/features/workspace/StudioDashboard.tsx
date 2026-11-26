import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { SerialBufferMetrics } from "@zhizhang/fanqie/view";
import { DESKTOP_COPY } from "@zhizhang/ui/copy";
import type { TargetItem } from "../../../shared/views";
import { openPipeline } from "../../state/controller";
import { desktop } from "../../state/desktop";
import { desktopStore, useDesktop } from "../../state/store";
import { headlineRun } from "../topbar/LeftRail";
import { kindLabel, progressGroups, progressIndex, stateLabel } from "../workflow/workflow-model";
import { renderKernelProgressSvg, renderPipelineGraphSvg } from "./dashboard-d3";
import { buildStudioDashboardModel } from "./dashboard-model";

const C = DESKTOP_COPY;

interface LibraryStats {
  totalSources: number;
  dissectedSources: number;
  sourcesWithCards: number;
  totalCards: number;
}

const EMPTY_LIBRARY: LibraryStats = {
  totalSources: 0,
  dissectedSources: 0,
  sourcesWithCards: 0,
  totalCards: 0,
};

/** Studio 顶部 D3 可视化仪表盘：左栏展示拆解/整理/填充内核进度，右栏以节点图展示 Agent 流水线状态。 */
export function StudioDashboard({ item }: { item: TargetItem }) {
  const libraryRoot = useDesktop((s) => s.workspace?.roots.library ?? "");
  const runs = useDesktop((s) => s.runs);
  const chapters = useDesktop((s) => s.chapters);
  const libRev = useDesktop((s) => s.revisions.library);
  const rowsRev = useDesktop((s) => s.revisions.rows);

  const [collapsed, setCollapsed] = useState(false);
  const [libraryStats, setLibraryStats] = useState<LibraryStats>(EMPTY_LIBRARY);
  const [boundCardCount, setBoundCardCount] = useState(0);
  const [buffer, setBuffer] = useState<SerialBufferMetrics | null>(null);

  const progressSvgRef = useRef<SVGSVGElement | null>(null);
  const pipelineSvgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!libraryRoot) {
      setLibraryStats(EMPTY_LIBRARY);
      return;
    }
    let alive = true;
    desktop
      .workbench("library.list", { libraryRoot })
      .then((res) => {
        if (!alive) return;
        const sources = res.sources;
        setLibraryStats({
          totalSources: sources.length,
          dissectedSources: sources.filter((s) => s.hasReport || s.cardCount > 0).length,
          sourcesWithCards: sources.filter((s) => s.cardCount > 0).length,
          totalCards: sources.reduce((sum, s) => sum + s.cardCount, 0),
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [libraryRoot, libRev]);

  useEffect(() => {
    if (item.target.mode !== "fanqie") {
      setBoundCardCount(0);
      setBuffer(null);
      return;
    }
    let alive = true;
    desktop
      .workbench("fanqie.reference.list", { work: item.target.path })
      .then((res) => {
        if (!alive) return;
        const unique = new Set<string>();
        for (const binding of res.bindings) {
          for (const cid of binding.cardIds) unique.add(`${binding.sourceId}:${cid}`);
        }
        setBoundCardCount(unique.size);
      })
      .catch(() => undefined);
    desktop
      .workbench("fanqie.snapshot", { work: item.target.path })
      .then((res) => {
        if (alive && res.buffer) setBuffer(res.buffer);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [item.target.mode, item.target.path, rowsRev, libRev]);

  const defaultKind = item.target.mode === "fanqie" ? "fanqie.chapter" : "toutiao.article";
  const head = headlineRun(runs);
  const activeKind = head && progressGroups(head.kind).length > 0 ? head.kind : defaultKind;
  const stageLabels = useMemo(() => progressGroups(activeKind), [activeKind]);

  const model = useMemo(() => {
    const pipelineState = head ? head.state : "idle";
    const activeIndex = head ? progressIndex(head) : 0;
    const chapterCount = item.chapterCount ?? chapters.length;
    const finalCount = item.finalCount ?? 0;
    const realDrafted = chapters.filter(
      (c) =>
        c.status === "drafted" ||
        c.status === "reviewed" ||
        c.status === "final" ||
        c.wordCount > 0,
    ).length;
    const draftedCount = Math.max(finalCount, chapters.length > 0 ? realDrafted : finalCount);

    return buildStudioDashboardModel(
      libraryStats,
      {
        mode: item.target.mode,
        boundCardCount,
        chapterCount,
        finalCount,
        draftedCount,
        articleStatus: item.status,
        qaScore: item.qaScore,
      },
      {
        stageLabels,
        state: pipelineState,
        activeIndex,
      },
      {
        dissectLabel: C.dashboard.dissectLabel,
        organizeLabel: C.dashboard.organizeLabel,
        fillLabel: C.dashboard.fillLabel,
        dissectHint: C.dashboard.dissectHint,
        organizeHint: C.dashboard.organizeHint,
        fillHintFanqie: C.dashboard.fillHintFanqie,
        fillHintToutiao: C.dashboard.fillHintToutiao,
      },
    );
  }, [
    libraryStats,
    boundCardCount,
    item.target.mode,
    item.chapterCount,
    item.finalCount,
    item.status,
    item.qaScore,
    chapters,
    head,
    stageLabels,
  ]);

  useEffect(() => {
    if (collapsed || !progressSvgRef.current) return;
    renderKernelProgressSvg(progressSvgRef.current, model.metrics, (id) => {
      desktopStore.set({ view: id === "fill" ? "board" : "warehouse" });
    });
  }, [model.metrics, collapsed]);

  useEffect(() => {
    if (collapsed || !pipelineSvgRef.current) return;
    renderPipelineGraphSvg(
      pipelineSvgRef.current,
      model.nodes,
      model.links,
      C.dashboard.nodeState,
      () => openPipeline(),
    );
  }, [model.nodes, model.links, collapsed]);

  const pipelineBadgeText = head
    ? C.dashboard.pipelineActive(kindLabel(head.kind), stateLabel(head.state))
    : C.dashboard.pipelineIdle;

  return (
    <section
      className="zz-studio-dash"
      data-collapsed={collapsed ? "true" : "false"}
      data-testid="studio-dashboard"
      aria-label={C.dashboard.ariaLabel}
    >
      <div className="zz-studio-dash__bar">
        <div className="zz-studio-dash__titles">
          <span className="zz-studio-dash__heading">{C.dashboard.heading}</span>
          <span className="zz-studio-dash__sep" aria-hidden="true">
            ·
          </span>
          <span className="zz-studio-dash__status" data-state={model.pipelineState}>
            {pipelineBadgeText}
          </span>
          {item.target.mode === "fanqie" && buffer ? (
            <span className="zz-studio-dash__buffer" data-testid="serial-buffer-bar">
              <span className="zz-studio-dash__sep" aria-hidden="true">
                ·
              </span>
              <span className="zz-studio-dash__buffer-metric zz-tabular">
                {C.dashboard.bufferSummary(
                  buffer.continuousFinalCount,
                  buffer.continuousFinalChars,
                  buffer.publishableDays,
                )}
              </span>
              {buffer.postGapFinalChapters.length > 0 ? (
                <span className="zz-studio-dash__buffer-warn" data-testid="serial-buffer-warn">
                  {C.dashboard.bufferPostGapWarn(buffer.postGapFinalChapters)}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="zz-studio-dash__toggle"
          data-testid="dashboard-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          <span>{collapsed ? C.dashboard.expand : C.dashboard.collapse}</span>
          {collapsed ? (
            <ChevronDown size={13} aria-hidden="true" />
          ) : (
            <ChevronUp size={13} aria-hidden="true" />
          )}
        </button>
      </div>

      {!collapsed ? (
        <div className="zz-studio-dash__grid">
          <div className="zz-studio-dash__panel" title={C.dashboard.openWarehouseHint}>
            <svg
              ref={progressSvgRef}
              className="zz-d3-svg zz-d3-svg--progress"
              role="img"
              aria-label={C.dashboard.heading}
              data-testid="d3-kernel-progress"
            />
          </div>
          <div
            className="zz-studio-dash__panel zz-studio-dash__panel--pipeline"
            title={C.dashboard.openPipelineHint}
          >
            <svg
              ref={pipelineSvgRef}
              className="zz-d3-svg zz-d3-svg--pipeline"
              role="img"
              aria-label={C.dashboard.pipelineHeading}
              data-testid="d3-pipeline-graph"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
