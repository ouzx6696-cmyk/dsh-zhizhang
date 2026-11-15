import { AppError } from "../errors/app-error.js";
export const DEFAULT_FIRST_EVENT_MS = 6 * 60 * 1000;
export const DEFAULT_IDLE_MS = 150 * 1000;
export function createWatchdog(parentSignal, firstEventMs = DEFAULT_FIRST_EVENT_MS, idleMs = DEFAULT_IDLE_MS) {
    const controller = new AbortController();
    let seenFirst = false;
    let timer;
    const onParentAbort = () => controller.abort(parentSignal.reason);
    if (parentSignal.aborted) {
        onParentAbort();
    }
    else {
        parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
    const arm = (ms) => {
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(() => {
            controller.abort(new AppError("model.stalled", "模型流式响应超时"));
        }, ms);
    };
    arm(firstEventMs);
    return {
        signal: controller.signal,
        poke() {
            seenFirst = true;
            arm(idleMs);
        },
        hasSeenFirst: () => seenFirst,
        dispose() {
            if (timer)
                clearTimeout(timer);
            parentSignal.removeEventListener("abort", onParentAbort);
        },
    };
}
