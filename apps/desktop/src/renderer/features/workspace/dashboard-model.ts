/**
 * Studio 顶部仪表盘的纯数据模型：计算拆解/整理/填充三段进度与 Agent 流水线节点图。
 * 保持零 DOM 与零 React 依赖，便于单元测试直接校验。
 */

export type KernelStageId = "dissect" | "organize" | "fill";
export type KernelTone = "ok" | "run" | "active" | "neutral";
export type PipelineNodeStatus = "done" | "running" | "awaiting" | "paused" | "failed" | "pending";

export interface KernelStageMetric {
  id: KernelStageId;
  label: string;
  percent: number;
  hint: string;
  countText: string;
  tone: KernelTone;
}

export interface PipelineNode {
  id: string;
  label: string;
  index: number;
  status: PipelineNodeStatus;
}

export interface PipelineLink {
  source: string;
  target: string;
  completed: boolean;
  active: boolean;
}

export type DashboardPipelineState =
  | "idle"
  | "running"
  | "awaiting-author"
  | "paused"
  | "failed"
  | "applied"
  | "discarded"
  | "cancelled";

export interface StudioDashboardModel {
  metrics: KernelStageMetric[];
  pipelineState: DashboardPipelineState;
  nodes: PipelineNode[];
  links: PipelineLink[];
}

export interface LibraryProgressInput {
  totalSources: number;
  dissectedSources: number;
  sourcesWithCards: number;
  totalCards: number;
}

export interface FillProgressInput {
  mode: "fanqie" | "toutiao";
  boundCardCount: number;
  chapterCount: number;
  finalCount: number;
  draftedCount?: number;
  articleStatus?: string;
  qaScore?: number;
}

export interface PipelineGraphInput {
  stageLabels: readonly string[];
  state: DashboardPipelineState;
  activeIndex: number;
}

export interface DashboardTextFormatters {
  dissectLabel: string;
  organizeLabel: string;
  fillLabel: string;
  dissectHint: (done: number, total: number) => string;
  organizeHint: (cards: number, sources: number) => string;
  fillHintFanqie: (bound: number, chaptersDone: number, chaptersTotal: number) => string;
  fillHintToutiao: (score: number | undefined, status: string) => string;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toutiaoFillPercent(status: string | undefined, qaScore: number | undefined): number {
  const baseByStatus: Record<string, number> = {
    初稿待改: 35,
    验收退回: 55,
    待验收: 70,
    已验收: 88,
    已交稿: 100,
  };
  const base = status ? (baseByStatus[status] ?? 25) : 15;
  if (base >= 100) return 100;
  if (qaScore !== undefined && qaScore >= 84) return Math.min(95, base + 10);
  return base;
}

export function buildPipelineGraph(input: PipelineGraphInput): {
  nodes: PipelineNode[];
  links: PipelineLink[];
} {
  const labels = input.stageLabels;
  const nodes: PipelineNode[] = labels.map((label, index) => {
    let status: PipelineNodeStatus = "pending";
    if (input.state === "applied") {
      status = "done";
    } else if (input.state === "awaiting-author") {
      status = index < labels.length - 1 ? "done" : "awaiting";
    } else if (input.state === "running") {
      if (index < input.activeIndex) status = "done";
      else if (index === input.activeIndex) status = "running";
    } else if (input.state === "paused") {
      if (index < input.activeIndex) status = "done";
      else if (index === input.activeIndex) status = "paused";
    } else if (input.state === "failed") {
      if (index < input.activeIndex) status = "done";
      else if (index === input.activeIndex) status = "failed";
    }
    return { id: `stage-${index}`, label, index, status };
  });

  const links: PipelineLink[] = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const src = nodes[i];
    const dst = nodes[i + 1];
    links.push({
      source: src.id,
      target: dst.id,
      completed: src.status === "done" && dst.status === "done",
      active:
        src.status === "done" &&
        (dst.status === "running" || dst.status === "awaiting" || dst.status === "paused"),
    });
  }
  return { nodes, links };
}

export function buildStudioDashboardModel(
  library: LibraryProgressInput,
  fill: FillProgressInput,
  pipeline: PipelineGraphInput,
  text: DashboardTextFormatters,
): StudioDashboardModel {
  const dissectPercent =
    library.totalSources > 0
      ? clampPercent((library.dissectedSources / library.totalSources) * 100)
      : 0;

  const organizePercent =
    library.totalCards > 0
      ? clampPercent(
          (library.sourcesWithCards / Math.max(1, library.totalSources)) * 65 +
            Math.min(35, library.totalCards * 7),
        )
      : 0;

  let fillPercent = 0;
  let fillHint = "";
  let fillCount = "";

  if (fill.mode === "fanqie") {
    const chapterTotal = Math.max(0, fill.chapterCount);
    const drafted = fill.draftedCount ?? fill.finalCount;
    const bindingScore = fill.boundCardCount > 0 ? Math.min(45, 25 + fill.boundCardCount * 5) : 0;
    const chapterScore =
      chapterTotal > 0
        ? Math.round((fill.finalCount / chapterTotal) * 35 + (drafted / chapterTotal) * 20)
        : 0;
    fillPercent = clampPercent(bindingScore + chapterScore);
    fillHint = text.fillHintFanqie(fill.boundCardCount, fill.finalCount, chapterTotal);
    fillCount = `${fillPercent}%`;
  } else {
    fillPercent = toutiaoFillPercent(fill.articleStatus, fill.qaScore);
    fillHint = text.fillHintToutiao(fill.qaScore, fill.articleStatus ?? "初稿待改");
    fillCount = `${fillPercent}%`;
  }

  const metrics: KernelStageMetric[] = [
    {
      id: "dissect",
      label: text.dissectLabel,
      percent: dissectPercent,
      hint: text.dissectHint(library.dissectedSources, library.totalSources),
      countText: `${dissectPercent}%`,
      tone: dissectPercent >= 100 ? "ok" : dissectPercent > 0 ? "run" : "neutral",
    },
    {
      id: "organize",
      label: text.organizeLabel,
      percent: organizePercent,
      hint: text.organizeHint(library.totalCards, library.sourcesWithCards),
      countText: `${organizePercent}%`,
      tone: organizePercent >= 100 ? "ok" : organizePercent > 0 ? "active" : "neutral",
    },
    {
      id: "fill",
      label: text.fillLabel,
      percent: fillPercent,
      hint: fillHint,
      countText: fillCount,
      tone: fillPercent >= 100 ? "ok" : fillPercent > 0 ? "active" : "neutral",
    },
  ];

  const graph = buildPipelineGraph(pipeline);
  return {
    metrics,
    pipelineState: pipeline.state,
    nodes: graph.nodes,
    links: graph.links,
  };
}
