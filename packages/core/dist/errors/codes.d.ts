export type ErrorKind = "author" | "transient" | "content" | "infra" | "bug";
export type PauseReason = "budget" | "balance" | "context" | "lock" | "author-stop" | "interrupted";
export interface CodeSpec {
    readonly kind: ErrorKind;
    readonly retry: boolean;
    readonly pause?: PauseReason;
}
export declare const CODES: {
    readonly "input.invalid": {
        readonly kind: "author";
        readonly retry: false;
    };
    readonly "input.not_found": {
        readonly kind: "author";
        readonly retry: false;
    };
    readonly "storage.locked": {
        readonly kind: "transient";
        readonly retry: true;
        readonly pause: "lock";
    };
    readonly "storage.conflict": {
        readonly kind: "author";
        readonly retry: false;
    };
    readonly "storage.format_unsupported": {
        readonly kind: "author";
        readonly retry: false;
    };
    readonly "storage.io": {
        readonly kind: "infra";
        readonly retry: false;
    };
    readonly "gate.denied": {
        readonly kind: "author";
        readonly retry: false;
    };
    readonly "model.rate_limited": {
        readonly kind: "transient";
        readonly retry: true;
    };
    readonly "model.unavailable": {
        readonly kind: "transient";
        readonly retry: true;
    };
    readonly "model.stalled": {
        readonly kind: "transient";
        readonly retry: true;
    };
    readonly "model.context_overflow": {
        readonly kind: "author";
        readonly retry: false;
        readonly pause: "context";
    };
    readonly "model.balance": {
        readonly kind: "author";
        readonly retry: false;
        readonly pause: "balance";
    };
    readonly "model.auth": {
        readonly kind: "author";
        readonly retry: false;
    };
    readonly "model.output_invalid": {
        readonly kind: "content";
        readonly retry: true;
    };
    readonly "budget.tokens": {
        readonly kind: "author";
        readonly retry: false;
        readonly pause: "budget";
    };
    readonly "budget.money": {
        readonly kind: "author";
        readonly retry: false;
        readonly pause: "budget";
    };
    readonly "run.stopped": {
        readonly kind: "author";
        readonly retry: false;
        readonly pause: "author-stop";
    };
    readonly "run.interrupted": {
        readonly kind: "transient";
        readonly retry: false;
        readonly pause: "interrupted";
    };
    readonly "run.invalid_transition": {
        readonly kind: "bug";
        readonly retry: false;
    };
    readonly "python.unavailable": {
        readonly kind: "infra";
        readonly retry: false;
    };
    readonly "python.failed": {
        readonly kind: "infra";
        readonly retry: false;
    };
    readonly "network.proxy": {
        readonly kind: "infra";
        readonly retry: true;
    };
    readonly "ipc.invalid_args": {
        readonly kind: "bug";
        readonly retry: false;
    };
    readonly internal: {
        readonly kind: "bug";
        readonly retry: false;
    };
};
export type ErrorCode = keyof typeof CODES;
//# sourceMappingURL=codes.d.ts.map