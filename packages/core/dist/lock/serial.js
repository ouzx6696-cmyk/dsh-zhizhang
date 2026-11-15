export function createSerialRunner() {
    const tails = new Map();
    return async function serial(key, fn) {
        const prev = tails.get(key) ?? Promise.resolve();
        const next = prev.catch(() => undefined).then(fn);
        const tail = next.then(() => undefined, () => undefined);
        tails.set(key, tail);
        try {
            return await next;
        }
        finally {
            if (tails.get(key) === tail) {
                tails.delete(key);
            }
        }
    };
}
