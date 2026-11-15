export const systemClock = {
    now: () => Date.now(),
    iso: () => new Date().toISOString(),
    sleep(ms, signal) {
        if (signal?.aborted) {
            return Promise.reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                signal?.removeEventListener("abort", onAbort);
                resolve();
            }, ms);
            const onAbort = () => {
                clearTimeout(timer);
                reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
            };
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    },
};
