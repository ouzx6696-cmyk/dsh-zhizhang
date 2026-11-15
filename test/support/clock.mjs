export function createFakeClock(initialMs = Date.parse("2026-11-15T00:00:00.000Z"), opts = {}) {
  let currentMs = initialMs;
  const autoAdvance = opts.autoAdvance !== false;
  const waiters = [];

  function flushWaiters() {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (currentMs >= waiters[i].until) {
        const w = waiters.splice(i, 1)[0];
        w.cleanup();
        w.resolve();
      }
    }
  }

  return {
    now() {
      return currentMs;
    },
    iso() {
      return new Date(currentMs).toISOString();
    },
    advance(ms) {
      currentMs += ms;
      flushWaiters();
    },
    set(ms) {
      currentMs = ms;
      flushWaiters();
    },
    async sleep(ms, signal) {
      if (signal?.aborted) {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      }
      if (autoAdvance) {
        currentMs += ms;
        await Promise.resolve();
        if (signal?.aborted) {
          throw Object.assign(new Error("Aborted"), { name: "AbortError" });
        }
        return;
      }
      const until = currentMs + ms;
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          const idx = waiters.findIndex((w) => w.resolve === resolve);
          if (idx !== -1) waiters.splice(idx, 1);
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        };
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        signal?.addEventListener("abort", onAbort, { once: true });
        waiters.push({ until, resolve, cleanup });
      });
    },
  };
}
