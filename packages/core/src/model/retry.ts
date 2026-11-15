import type { Clock } from "../clock.js";
import { classify } from "../errors/classify.js";

const BASE_DELAYS_MS = [2000, 6000, 15000] as const;

export async function withRetry<T>(
  fn: () => Promise<T>,
  clock: Clock,
  signal: AbortSignal,
  jitterFactor = 0.2
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const appErr = classify(err, { provider: true });
      if (!appErr.spec.retry || attempt >= BASE_DELAYS_MS.length || signal.aborted) {
        throw appErr;
      }
      const base = BASE_DELAYS_MS[attempt];
      const jitter = 1 + (Math.random() * 2 - 1) * jitterFactor;
      attempt += 1;
      await clock.sleep(Math.round(base * jitter), signal);
    }
  }
}
