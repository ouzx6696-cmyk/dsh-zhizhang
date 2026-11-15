import { createEstimator } from "./estimate.js";
import { withRetry } from "./retry.js";
import { createWatchdog } from "./watchdog.js";
export function createModelGateway(port, config, clock) {
    let active = 0;
    const activeByRun = new Map();
    const queue = [];
    const estimator = createEstimator();
    const tryDispatch = () => {
        while (active < config.globalConcurrency && queue.length > 0) {
            const idx = queue.findIndex((w) => {
                if (w.signal.aborted)
                    return false;
                const per = activeByRun.get(w.runId) ?? 0;
                return per < config.perRunConcurrency;
            });
            if (idx === -1)
                break;
            const [waiter] = queue.splice(idx, 1);
            active += 1;
            activeByRun.set(waiter.runId, (activeByRun.get(waiter.runId) ?? 0) + 1);
            waiter.resolve();
        }
    };
    const acquire = (runId, signal) => {
        if (signal.aborted) {
            return Promise.reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        }
        return new Promise((resolve, reject) => {
            const waiter = {
                runId,
                signal,
                resolve: () => {
                    signal.removeEventListener("abort", onAbort);
                    resolve(() => {
                        active = Math.max(0, active - 1);
                        const cur = activeByRun.get(runId) ?? 1;
                        if (cur <= 1)
                            activeByRun.delete(runId);
                        else
                            activeByRun.set(runId, cur - 1);
                        tryDispatch();
                    });
                },
                reject,
            };
            const onAbort = () => {
                const i = queue.indexOf(waiter);
                if (i !== -1)
                    queue.splice(i, 1);
                reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
            };
            signal.addEventListener("abort", onAbort, { once: true });
            queue.push(waiter);
            tryDispatch();
        });
    };
    const resolveBinding = (role) => {
        return (config.roles[role] ??
            config.roles.writer ?? { connection: "default", model: "default" });
    };
    const computeCost = (binding, answer) => {
        if (answer.cost !== null)
            return answer.cost;
        if (!binding.price)
            return null;
        return ((answer.usage.input / 1_000_000) * binding.price.inputPer1M +
            (answer.usage.output / 1_000_000) * binding.price.outputPer1M);
    };
    return {
        async run(role, req, opts) {
            const binding = resolveBinding(role);
            const key = `${binding.connection}:${binding.model}`;
            const est = estimator.estimate(key, `${req.system}\n${req.user}`);
            opts.budget.reserve(est);
            const release = await acquire(opts.runId, opts.signal);
            try {
                const answer = await withRetry(async () => {
                    const wd = createWatchdog(opts.signal);
                    try {
                        return await port.stream({ ...req, connection: binding.connection, model: binding.model }, wd.signal, () => wd.poke());
                    }
                    finally {
                        wd.dispose();
                    }
                }, clock, opts.signal);
                const cost = computeCost(binding, answer);
                estimator.calibrate(key, est, answer.usage.input);
                opts.budget.settle({ ...answer.usage, cost });
                return { ...answer, cost };
            }
            finally {
                release();
            }
        },
        async session(role, fn, opts) {
            const controller = new AbortController();
            const release = await acquire(`session:${opts.scope}`, controller.signal);
            try {
                return await fn(port);
            }
            finally {
                release();
            }
        },
        stats() {
            return { active, queued: queue.length };
        },
    };
}
