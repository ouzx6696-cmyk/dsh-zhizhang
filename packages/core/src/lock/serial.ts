export function createSerialRunner() {
  const tails = new Map<string, Promise<unknown>>();
  return async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (tails.get(key) === tail) {
        tails.delete(key);
      }
    }
  };
}
