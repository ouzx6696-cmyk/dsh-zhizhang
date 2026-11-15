import type { Clock } from "../clock.js";
export declare function withRetry<T>(fn: () => Promise<T>, clock: Clock, signal: AbortSignal, jitterFactor?: number): Promise<T>;
//# sourceMappingURL=retry.d.ts.map