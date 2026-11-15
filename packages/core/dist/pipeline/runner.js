import { AppError, isAppError } from "../errors/app-error.js";
import { loadProfile, methodFor } from "../methods/index.js";
import { renderContextPacket } from "./context-packet.js";
import { createBudgetGuard } from "./budget.js";
import { addUsage, emptyUsage } from "./record.js";
import { transition } from "./state.js";
export async function executePipeline(def, record, ctx, gateway, clock, signal, onPersist) {
    let current = record;
    const budget = createBudgetGuard(current.budget, current.usage);
    const completedMap = new Map(current.steps.filter((s) => s.status === "done").map((s) => [s.id, s]));
    let profilePromise;
    function resolveProfile() {
        if (ctx.profile)
            return Promise.resolve(ctx.profile);
        if (!ctx.profileRoots)
            return Promise.resolve(undefined);
        if (!profilePromise) {
            profilePromise = loadProfile(ctx.target.mode, ctx.profileId ?? "default", ctx.profileRoots);
        }
        return profilePromise;
    }
    const persist = async () => {
        if (onPersist)
            await onPersist(current);
    };
    async function runSingleStage(stepId, spec, packet) {
        const prev = completedMap.get(stepId);
        if (prev && prev.output !== undefined) {
            return spec.parse(typeof prev.output === "string" ? prev.output : JSON.stringify(prev.output));
        }
        const startedAt = clock.iso();
        const rendered = renderContextPacket(packet);
        let method;
        if (spec.method) {
            const profile = await resolveProfile();
            if (profile) {
                method = methodFor(profile, spec.method.stage);
            }
        }
        const systemPrompt = [rendered.system, method?.text].filter(Boolean).join("\n\n");
        const inputVal = await spec.input(ctx);
        const userPrompt = [
            rendered.user,
            typeof inputVal === "string" ? inputVal : JSON.stringify(inputVal),
            spec.shape,
        ]
            .filter(Boolean)
            .join("\n\n");
        const maxRetries = spec.retries ?? 1;
        let lastErr;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const answer = await gateway.run(spec.role, { system: systemPrompt, user: userPrompt, json: spec.format === "json" }, { runId: current.id, stage: stepId, budget, signal });
                const parsed = spec.parse(answer.text);
                let finalValue = parsed;
                let notes;
                if (spec.accept) {
                    const accepted = await spec.accept(parsed, ctx);
                    if (typeof accepted === "object" &&
                        accepted !== null &&
                        "value" in accepted &&
                        "notes" in accepted) {
                        finalValue = accepted.value;
                        notes = accepted.notes;
                    }
                    else {
                        finalValue = accepted;
                    }
                }
                const stepUsage = { ...answer.usage, cost: answer.cost };
                const step = {
                    id: stepId,
                    role: spec.role,
                    status: "done",
                    ...(method ? { methodHash: method.hash, omitted: method.omitted } : {}),
                    notes,
                    output: finalValue,
                    usage: stepUsage,
                    startedAt,
                    finishedAt: clock.iso(),
                };
                current = {
                    ...current,
                    steps: [...current.steps, step],
                    usage: addUsage(current.usage, stepUsage),
                    updated: clock.iso(),
                };
                completedMap.set(stepId, step);
                await persist();
                return finalValue;
            }
            catch (err) {
                lastErr = err;
                if (isAppError(err) && err.code === "model.output_invalid" && attempt < maxRetries) {
                    continue;
                }
                throw err;
            }
        }
        throw lastErr;
    }
    const runner = {
        signal,
        stage: (spec, packet) => runSingleStage(spec.id, spec, packet),
        fanOut: async (spec, packet) => {
            const count = spec.fanOut ? spec.fanOut.count(ctx) : 1;
            const tasks = Array.from({ length: count }, (_, idx) => runSingleStage(`${spec.id}-${idx}`, spec, packet));
            return Promise.all(tasks);
        },
        local: async (id, fn) => {
            const prev = completedMap.get(id);
            if (prev && prev.output !== undefined)
                return prev.output;
            const startedAt = clock.iso();
            const out = await fn();
            const step = {
                id,
                role: "local",
                status: "done",
                output: out,
                usage: emptyUsage(),
                startedAt,
                finishedAt: clock.iso(),
            };
            current = {
                ...current,
                steps: [...current.steps, step],
                updated: clock.iso(),
            };
            completedMap.set(id, step);
            await persist();
            return out;
        },
    };
    try {
        const res = await def.run(runner, ctx);
        await def.deliver(res, ctx);
        current = transition(current, "awaiting-author", "deliver", clock.iso());
        await persist();
        return current;
    }
    catch (err) {
        if (isAppError(err) && err.spec.pause) {
            current = transition(current, "paused", err.spec.pause, clock.iso());
            await persist();
            return current;
        }
        if (signal.aborted) {
            current = transition(current, "paused", "author-stop", clock.iso());
            await persist();
            return current;
        }
        current = transition(current, "failed", "error", clock.iso());
        await persist();
        if (isAppError(err))
            throw err;
        throw new AppError("internal", err instanceof Error ? err.message : String(err));
    }
}
