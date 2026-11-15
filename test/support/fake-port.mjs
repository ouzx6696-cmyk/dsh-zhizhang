export function createFakeModelPort(program = [], opts = {}) {
  const queue = Array.isArray(program) ? [...program] : [program];
  const calls = [];
  const repeatLast = opts.repeatLast === true;

  return {
    calls,
    async stream(req, signal, on) {
      calls.push(req);
      if (signal?.aborted) {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      }

      const next = queue.length > 1 ? queue.shift() : repeatLast ? queue[0] : queue.shift();
      if (next === undefined) {
        throw new Error(`FakeModelPort: unexpected call #${calls.length}`);
      }

      const spec = typeof next === "function" ? await next(req, signal, on, calls.length) : next;
      if (spec?.error) {
        throw spec.error;
      }

      const chunks = Array.isArray(spec?.chunks)
        ? spec.chunks
        : spec?.text !== undefined
          ? [spec.text]
          : [];
      for (const chunk of chunks) {
        if (signal?.aborted) {
          throw Object.assign(new Error("Aborted"), { name: "AbortError" });
        }
        on?.({ type: "delta", text: chunk });
      }
      on?.({ type: "done" });

      const text = spec?.text ?? chunks.join("");
      const usage = spec?.usage ?? {
        input: req.user?.length ?? 0,
        cachedInput: 0,
        output: text.length,
      };
      return {
        text,
        usage,
        cost: spec?.cost === undefined ? 0 : spec.cost,
      };
    },
  };
}
