export type ErrorKind = "author" | "transient" | "content" | "infra" | "bug";
export type PauseReason = "budget" | "balance" | "context" | "lock" | "author-stop" | "interrupted";

export interface CodeSpec {
  readonly kind: ErrorKind;
  readonly retry: boolean;
  readonly pause?: PauseReason;
}

export const CODES = {
  "input.invalid": { kind: "author", retry: false },
  "input.not_found": { kind: "author", retry: false },
  "storage.locked": { kind: "transient", retry: true, pause: "lock" },
  "storage.conflict": { kind: "author", retry: false },
  "storage.format_unsupported": { kind: "author", retry: false },
  "storage.io": { kind: "infra", retry: false },
  "gate.denied": { kind: "author", retry: false },
  "model.rate_limited": { kind: "transient", retry: true },
  "model.unavailable": { kind: "transient", retry: true },
  "model.stalled": { kind: "transient", retry: true },
  "model.context_overflow": { kind: "author", retry: false, pause: "context" },
  "model.balance": { kind: "author", retry: false, pause: "balance" },
  "model.auth": { kind: "author", retry: false },
  "model.output_invalid": { kind: "content", retry: true },
  "budget.tokens": { kind: "author", retry: false, pause: "budget" },
  "budget.money": { kind: "author", retry: false, pause: "budget" },
  "run.stopped": { kind: "author", retry: false, pause: "author-stop" },
  "run.interrupted": { kind: "transient", retry: false, pause: "interrupted" },
  "run.invalid_transition": { kind: "bug", retry: false },
  "network.proxy": { kind: "infra", retry: true },
  "ipc.invalid_args": { kind: "bug", retry: false },
  internal: { kind: "bug", retry: false },
} as const satisfies Record<string, CodeSpec>;

export type ErrorCode = keyof typeof CODES;
