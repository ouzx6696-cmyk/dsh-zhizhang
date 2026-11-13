import type { Target } from "../context";
import type { ModelSettings } from "../models";
import type { DesktopEvent } from "../renderer-contracts";
import type { AgentSession } from "../session/pi-adapter";
import type { SessionExtras, SessionOptions } from "../session/types";

/** The session capabilities used to run and apply a workflow. */
export interface WorkflowHost {
  readonly home: string;
  readonly python: string | undefined;
  readonly options: SessionOptions;
  readonly extras: SessionExtras;
  readonly settings: () => ModelSettings;
  readonly emit: (event: DesktopEvent) => void;
  readonly confirm: (text: string, signal?: AbortSignal) => Promise<boolean>;
  readonly reconfiguring: boolean;
  readonly sessions: ReadonlyMap<string, { session: AgentSession }>;
  key(target: Target): string;
  isRunning(target: Target): boolean;
  running(): NonNullable<DesktopEvent["running"]>;
}
