import type { Clock } from "../clock.js";
import type { LockService } from "../lock/index.js";
import type { Profile, ProfileRoots } from "../methods/index.js";
import type { Parser } from "../schema/parse.js";
import type { Role } from "../tool/roles.js";
import type { ContextPacket } from "./context-packet.js";
import type { BudgetConfig, RunRecord } from "./record.js";

export interface RunCtx<
  Req = unknown,
  State extends Record<string, unknown> = Record<string, unknown>,
> {
  runId: string;
  target: { mode: string; path: string; subId?: string };
  request: Req;
  state: State;
  clock?: Clock;
  lock?: LockService;
  budget?: BudgetConfig;
  profileId?: string;
  profile?: Profile;
  profileRoots?: ProfileRoots;
  libraryRoot?: string;
}

export interface PipelineEnv {
  workspaceRoot: string;
  profileId: string;
  profile?: Profile;
  profileRoots?: ProfileRoots;
  clock?: Clock;
  lock?: LockService;
  budget?: BudgetConfig;
}

export interface DeliveryReceipt {
  runId: string;
  deliveredPaths: string[];
  contentHash: string;
  summary: string;
}

export interface StageSpec<
  I,
  O,
  Req = unknown,
  State extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  title: string;
  role: Role;
  method?: {
    stage: string;
    vars?(ctx: RunCtx<Req, State>): Record<string, string | undefined>;
  };
  input(ctx: RunCtx<Req, State>): I | Promise<I>;
  shape: string;
  format: "text" | "json";
  parse(raw: string): O;
  accept?(
    o: O,
    ctx: RunCtx<Req, State>,
  ): O | { value: O; notes: string[] } | Promise<O | { value: O; notes: string[] }>;
  retries?: number;
  fanOut?: { count(ctx: RunCtx<Req, State>): number };
}

export interface StageRunner<
  Req = unknown,
  State extends Record<string, unknown> = Record<string, unknown>,
> {
  stage<I, O>(spec: StageSpec<I, O, Req, State>, packet: ContextPacket): Promise<O>;
  fanOut<I, O>(spec: StageSpec<I, O, Req, State>, packet: ContextPacket): Promise<O[]>;
  local<O>(id: string, fn: () => Promise<O>): Promise<O>;
  signal: AbortSignal;
}

export interface PipelineEvent {
  type: "stage.start" | "stage.done" | "stage.failed";
  runId: string;
  stageId: string;
  title?: string;
  role: string;
  at: string;
}

export interface ExecutePipelineOptions {
  onPersist?: (rec: RunRecord) => Promise<void>;
  onEvent?: (event: PipelineEvent) => void;
}

export interface PipelineDefinition<
  Req = unknown,
  Res = unknown,
  State extends Record<string, unknown> = Record<string, unknown>,
> {
  kind: `${string}.${string}`;
  request: Parser<Req>;
  context(target: RunRecord["target"], req: Req, env: PipelineEnv): Promise<RunCtx<Req, State>>;
  run(runner: StageRunner<Req, State>, ctx: RunCtx<Req, State>): Promise<Res>;
  deliver(res: Res, ctx: RunCtx<Req, State>): Promise<DeliveryReceipt>;
  recover(record: RunRecord, ctx: RunCtx<Req, State>): Promise<"resume" | "delivered" | "conflict">;
  apply?(record: RunRecord, choice: unknown, ctx: RunCtx<Req, State>): Promise<void>;
}

export type AnyPipelineDefinition = PipelineDefinition<unknown, unknown, Record<string, unknown>>;

export function definePipeline<
  Req,
  Res,
  State extends Record<string, unknown> = Record<string, unknown>,
>(def: PipelineDefinition<Req, Res, State>): PipelineDefinition<Req, Res, State> {
  return def;
}
