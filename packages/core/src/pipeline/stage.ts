import type { ErrorCode } from "../errors/codes.js";
import type { Profile, ProfileRoots } from "../methods/index.js";
import type { Parser } from "../schema/parse.js";
import type { Role } from "../tool/roles.js";
import type { ContextPacket } from "./context-packet.js";
import type { RunRecord } from "./record.js";

export interface RunCtx {
  runId: string;
  target: { mode: string; path: string; subId?: string };
  request: unknown;
  state: Record<string, unknown>;
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
}

export interface DeliveryReceipt {
  runId: string;
  deliveredPaths: string[];
  contentHash: string;
  summary: string;
}

export interface StageSpec<I, O> {
  id: string;
  title: string;
  role: Role;
  method?: { stage: string };
  input(ctx: RunCtx, index?: number): I | Promise<I>;
  shape: string;
  format: "text" | "json";
  parse(raw: string): O;
  accept?(
    o: O,
    ctx: RunCtx,
  ): O | { value: O; notes: string[] } | Promise<O | { value: O; notes: string[] }>;
  retries?: number;
  fanOut?: { count(ctx: RunCtx): number; key?(index: number): string | number };
}

export interface StageRunner {
  stage<I, O>(spec: StageSpec<I, O>, packet: ContextPacket): Promise<O>;
  fanOut<I, O>(spec: StageSpec<I, O>, packet: ContextPacket): Promise<O[]>;
  fanOutSettled<I, O>(
    spec: StageSpec<I, O>,
    packet: ContextPacket,
  ): Promise<
    (
      | { ok: true; index: number; value: O }
      | { ok: false; index: number; error: { code: ErrorCode; message: string } }
    )[]
  >;
  local<O>(id: string, fn: () => Promise<O>): Promise<O>;
  signal: AbortSignal;
}

export interface PipelineDefinition<Req = unknown, Res = unknown> {
  kind: `${string}.${string}`;
  request: Parser<Req>;
  context(target: RunRecord["target"], req: Req, env: PipelineEnv): Promise<RunCtx>;
  run(runner: StageRunner, ctx: RunCtx): Promise<Res>;
  deliver(res: Res, ctx: RunCtx): Promise<DeliveryReceipt>;
  recover(record: RunRecord, ctx: RunCtx): Promise<"resume" | "delivered" | "conflict">;
  apply?(record: RunRecord, choice: unknown, ctx: RunCtx): Promise<void>;
}
