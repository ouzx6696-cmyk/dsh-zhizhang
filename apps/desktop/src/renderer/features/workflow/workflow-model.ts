/**
 * 流水线面板的纯函数：阶段 id → 显示名与分组进度、运行状态 → 色调与可用操作。
 * 顶栏指示、右栏阶段列表与进度轨共用这一份口径。
 */
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import type { SemanticTone } from "@zhizhang/ui/tokens";
import type { RunDetail, RunSummary, WorkflowAction } from "../../../shared/views";

type RunState = RunSummary["state"];

/** 阶段 id 前缀 → 显示名键（并行/多轮阶段带序号后缀，如 score-0、review-1）。 */
const STAGE_PREFIXES: readonly (keyof typeof C.workflow.stage)[] = [
  "prepare",
  "beats",
  "draft",
  "gate",
  "score",
  "compare",
  "continuity",
  "review",
  "revise",
  "source",
  "rules",
  "card",
  "title",
  "blueprint",
  "claims",
  "qa",
  "antigaming",
  "import",
  "locate",
  "propose",
  "bible",
  "deliver",
];

function stagePrefix(id: string): keyof typeof C.workflow.stage | undefined {
  return STAGE_PREFIXES.find(
    (prefix) => id === prefix || id.startsWith(prefix + "-") || id.startsWith(prefix + "_"),
  );
}

export function stageLabel(id: string): string {
  const prefix = stagePrefix(id);
  if (!prefix) return id;
  const round = /-(\d+)$/.exec(id);
  const label = C.workflow.stage[prefix];
  return round && prefix !== "prepare"
    ? `${label} ${Number(round[1]) + (prefix === "score" ? 1 : 0)}`
    : label;
}

/** 各流水线的粗分组（进度轨）：每组列出归属的阶段前缀。 */
const KIND_GROUPS: Record<string, { label: string; prefixes: string[] }[]> = {
  "fanqie.chapter": [
    { label: C.workflow.group.prepare, prefixes: ["prepare"] },
    { label: C.workflow.group.beats, prefixes: ["beats"] },
    { label: C.workflow.group.draft, prefixes: ["draft", "gate", "score", "compare"] },
    { label: C.workflow.group.review, prefixes: ["continuity", "review", "revise"] },
    { label: C.workflow.group.deliver, prefixes: ["deliver"] },
  ],
  "toutiao.article": [
    { label: C.workflow.group.source, prefixes: ["source", "rules"] },
    { label: C.workflow.group.card, prefixes: ["card", "title"] },
    { label: C.workflow.group.blueprint, prefixes: ["blueprint"] },
    { label: C.workflow.group.draft, prefixes: ["claims", "draft"] },
    { label: C.workflow.group.review, prefixes: ["review", "revise", "qa", "antigaming"] },
    { label: C.workflow.group.deliver, prefixes: ["deliver"] },
  ],
};

export function kindLabel(kind: string): string {
  return C.workflow.kind[kind] ?? kind;
}

export function progressGroups(kind: string): string[] {
  return (KIND_GROUPS[kind] ?? []).map((g) => g.label);
}

/** 进度轨当前位置：已完成阶段落在的最靠后分组；运行中指向下一组，等你决定时整轨完成。 */
export function progressIndex(run: Pick<RunSummary, "kind" | "stages" | "state">): number {
  const groups = KIND_GROUPS[run.kind] ?? [];
  if (!groups.length) return 0;
  if (run.state === "awaiting-author" || run.state === "applied") return groups.length;
  let reached = -1;
  for (const id of run.stages) {
    const prefix = stagePrefix(id) ?? id;
    const index = groups.findIndex((g) => g.prefixes.includes(prefix));
    if (index > reached) reached = index;
  }
  return Math.min(groups.length - 1, reached + (run.state === "running" ? 1 : 0));
}

export function stateTone(state: RunState): SemanticTone {
  switch (state) {
    case "running":
      return "run";
    case "awaiting-author":
      return "decide";
    case "applied":
      return "ok";
    case "failed":
      return "bad";
    case "paused":
      return "warn";
    default:
      return "neutral";
  }
}

export function stateLabel(state: RunState): string {
  return C.workflow.state[state];
}

/** 当前状态下作者可做的运行控制（采纳/放弃走 decide，另行判断）。 */
export function runActions(state: RunState): WorkflowAction[] {
  switch (state) {
    case "running":
      return ["pause", "stop"];
    case "paused":
      return ["resume", "stop"];
    case "failed":
      return ["retry", "stop"];
    default:
      return [];
  }
}

/** 运行进行中（含暂停/失败可恢复）：同一目标不能再发起新的流水线。 */
export function isOpen(state: RunState): boolean {
  return (
    state === "running" || state === "paused" || state === "failed" || state === "awaiting-author"
  );
}

/** 新事件比手里的旧时才替换，防止迟到的响应盖掉推送。 */
export function newer(current: RunSummary | null, next: RunSummary): RunSummary {
  return current && current.id === next.id && next.updated < current.updated ? current : next;
}

export function requestField(detail: Pick<RunDetail, "request"> | null, key: string): string {
  const request = detail?.request;
  const value: unknown =
    typeof request === "object" && request !== null ? Reflect.get(request, key) : undefined;
  return typeof value === "string" ? value : "";
}

/** 交付候选稿、可在中栏对照的流水线。 */
export function hasCandidate(kind: string): boolean {
  return kind === "fanqie.chapter" || kind === "fanqie.revise";
}
