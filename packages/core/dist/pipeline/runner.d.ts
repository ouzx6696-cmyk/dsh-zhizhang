import type { Clock } from "../clock.js";
import { createBudgetGuard } from "./budget.js";
import { type RunRecord } from "./record.js";
import type { PipelineDefinition, RunCtx } from "./stage.js";
export interface GatewayLike {
    run(role: string, req: {
        system: string;
        user: string;
        json?: boolean;
    }, opts: {
        runId: string;
        stage: string;
        budget: ReturnType<typeof createBudgetGuard>;
        signal: AbortSignal;
    }): Promise<{
        text: string;
        usage: {
            input: number;
            cachedInput: number;
            output: number;
        };
        cost: number | null;
    }>;
}
export declare function executePipeline<Req, Res>(def: PipelineDefinition<Req, Res>, record: RunRecord, ctx: RunCtx, gateway: GatewayLike, clock: Clock, signal: AbortSignal, onPersist?: (rec: RunRecord) => Promise<void>): Promise<RunRecord>;
//# sourceMappingURL=runner.d.ts.map