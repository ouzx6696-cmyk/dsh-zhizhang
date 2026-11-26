import * as d3 from "d3";
import type {
  KernelStageId,
  KernelStageMetric,
  PipelineLink,
  PipelineNode,
  PipelineNodeStatus,
} from "./dashboard-model";

function metricFillVar(tone: KernelStageMetric["tone"]): string {
  switch (tone) {
    case "ok":
      return "var(--zz-ok)";
    case "run":
      return "var(--zz-run)";
    case "active":
      return "var(--zz-text-2)";
    default:
      return "var(--zz-border-strong)";
  }
}

function nodeStrokeVar(status: PipelineNodeStatus): string {
  switch (status) {
    case "done":
      return "var(--zz-ok)";
    case "running":
      return "var(--zz-run)";
    case "awaiting":
      return "var(--zz-decide)";
    case "paused":
      return "var(--zz-warn)";
    case "failed":
      return "var(--zz-bad)";
    default:
      return "var(--zz-border-strong)";
  }
}

function nodeFillVar(status: PipelineNodeStatus): string {
  switch (status) {
    case "done":
      return "var(--zz-ok)";
    case "running":
      return "var(--zz-run)";
    case "awaiting":
      return "var(--zz-decide)";
    case "paused":
      return "var(--zz-warn-soft)";
    case "failed":
      return "var(--zz-bad-soft)";
    default:
      return "var(--zz-paper)";
  }
}

/** D3 渲染左栏：拆解 / 整理 / 填充三段式书卷进度仪表。 */
export function renderKernelProgressSvg(
  svgEl: SVGSVGElement,
  metrics: readonly KernelStageMetric[],
  onSelect: (id: KernelStageId) => void,
): void {
  const svg = d3.select(svgEl);
  const width = 456;
  const height = 58;
  svg.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMinYMid meet");
  svg.selectAll("*").remove();

  const colWidth = 140;
  const colGap = 18;
  const barWidth = colWidth;
  const barY = 24;
  const barHeight = 5;
  const xScale = d3.scaleLinear().domain([0, 100]).range([0, barWidth]);

  const groups = svg
    .selectAll<SVGGElement, KernelStageMetric>("g.zz-d3-metric")
    .data(metrics, (d) => d.id)
    .join("g")
    .attr("class", "zz-d3-metric")
    .attr("transform", (_, i) => `translate(${i * (colWidth + colGap)}, 0)`)
    .style("cursor", "pointer")
    .on("click", (_, d) => onSelect(d.id));

  groups.append("title").text((d) => `${d.label} ${d.countText} · ${d.hint}`);

  groups
    .append("text")
    .attr("x", 0)
    .attr("y", 15)
    .attr("class", "zz-d3-metric__label")
    .text((d) => d.label);

  groups
    .append("text")
    .attr("x", barWidth)
    .attr("y", 15)
    .attr("text-anchor", "end")
    .attr("class", "zz-d3-metric__value")
    .text((d) => d.countText);

  groups
    .append("rect")
    .attr("x", 0)
    .attr("y", barY)
    .attr("width", barWidth)
    .attr("height", barHeight)
    .attr("rx", 2.5)
    .attr("fill", "var(--zz-surface-2)");

  const grow = d3.transition().duration(360).ease(d3.easeCubicOut);
  groups
    .append("rect")
    .attr("x", 0)
    .attr("y", barY)
    .attr("height", barHeight)
    .attr("rx", 2.5)
    .attr("fill", (d) => metricFillVar(d.tone))
    .attr("width", 0)
    .transition(grow)
    .attr("width", (d) => Math.max(d.percent > 0 ? 6 : 0, xScale(d.percent)));

  groups
    .append("text")
    .attr("x", 0)
    .attr("y", 46)
    .attr("class", "zz-d3-metric__hint")
    .text((d) => (d.hint.length > 18 ? `${d.hint.slice(0, 17)}…` : d.hint));
}

/** D3 渲染右栏：Agent 流水线有向节点图。 */
export function renderPipelineGraphSvg(
  svgEl: SVGSVGElement,
  nodes: readonly PipelineNode[],
  links: readonly PipelineLink[],
  nodeStateLabels: Readonly<Record<PipelineNodeStatus, string>>,
  onClickNode: () => void,
): void {
  const svg = d3.select(svgEl);
  const width = 468;
  const height = 58;
  svg.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet");
  svg.selectAll("*").remove();

  if (nodes.length === 0) return;

  const padX = nodes.length <= 3 ? 64 : 36;
  const xScale = d3
    .scalePoint<string>()
    .domain(nodes.map((n) => n.id))
    .range([padX, width - padX]);
  const centerY = 20;
  const nodeMap = new Map<string, { x: number; y: number; node: PipelineNode }>();
  for (const node of nodes) {
    nodeMap.set(node.id, { x: xScale(node.id) ?? padX, y: centerY, node });
  }

  const linkGen = d3
    .linkHorizontal<{ source: [number, number]; target: [number, number] }, [number, number]>()
    .x((d) => d[0])
    .y((d) => d[1]);

  svg
    .selectAll<SVGPathElement, PipelineLink>("path.zz-d3-link")
    .data(links)
    .join("path")
    .attr("class", "zz-d3-link")
    .attr("d", (d) => {
      const src = nodeMap.get(d.source);
      const dst = nodeMap.get(d.target);
      if (!src || !dst) return "";
      return linkGen({ source: [src.x + 12.5, src.y], target: [dst.x - 12.5, dst.y] }) ?? "";
    })
    .attr("fill", "none")
    .attr("stroke", (d) =>
      d.completed ? "var(--zz-ok)" : d.active ? "var(--zz-run)" : "var(--zz-border-strong)",
    )
    .attr("stroke-width", (d) => (d.completed || d.active ? 2 : 1.25))
    .attr("stroke-dasharray", (d) => (d.completed || d.active ? "none" : "3 3"));

  const nodeGroups = svg
    .selectAll<SVGGElement, PipelineNode>("g.zz-d3-node")
    .data(nodes, (d) => d.id)
    .join("g")
    .attr("class", (d) => `zz-d3-node zz-d3-node--${d.status}`)
    .attr("transform", (d) => `translate(${xScale(d.id) ?? 46}, ${centerY})`)
    .style("cursor", "pointer")
    .on("click", onClickNode);

  nodeGroups.append("title").text((d) => `${d.label} · ${nodeStateLabels[d.status]}`);

  nodeGroups
    .filter((d) => d.status === "running" || d.status === "awaiting")
    .append("circle")
    .attr("r", 15.5)
    .attr("fill", "none")
    .attr("stroke", (d) => nodeStrokeVar(d.status))
    .attr("stroke-width", 1.5)
    .attr("class", "zz-d3-node__halo");

  nodeGroups
    .append("circle")
    .attr("r", 10.5)
    .attr("fill", (d) => nodeFillVar(d.status))
    .attr("stroke", (d) => nodeStrokeVar(d.status))
    .attr("stroke-width", 1.5);

  nodeGroups
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .attr("class", (d) =>
      d.status === "done" || d.status === "running" || d.status === "awaiting"
        ? "zz-d3-node__index zz-d3-node__index--inv"
        : "zz-d3-node__index",
    )
    .text((d) => (d.status === "done" ? "✓" : String(d.index + 1)));

  nodeGroups
    .append("text")
    .attr("y", 25)
    .attr("text-anchor", "middle")
    .attr("class", (d) =>
      d.status === "running" || d.status === "awaiting"
        ? "zz-d3-node__label zz-d3-node__label--active"
        : "zz-d3-node__label",
    )
    .text((d) => d.label);
}
