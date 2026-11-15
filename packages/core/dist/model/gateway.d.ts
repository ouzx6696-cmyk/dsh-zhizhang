import type { Clock } from "../clock.js";
import type { BudgetGuard } from "../pipeline/budget.js";
import type { Role } from "../tool/roles.js";
import type { ModelAnswer, ModelPort, ModelRequest } from "./port.js";
export interface RoleBinding {
    connection: string;
    model: string;
    price?: {
        inputPer1M: number;
        outputPer1M: number;
    };
}
export interface GatewayConfig {
    globalConcurrency: number;
    perRunConcurrency: number;
    roles: Record<string, RoleBinding>;
}
export interface ModelGateway {
    run(role: Role, req: Omit<ModelRequest, "connection" | "model">, opts: {
        runId: string;
        stage: string;
        budget: BudgetGuard;
        signal: AbortSignal;
    }): Promise<ModelAnswer>;
    session<T>(role: Role, fn: (port: ModelPort) => Promise<T>, opts: {
        scope: string;
    }): Promise<T>;
    stats(): {
        active: number;
        queued: number;
    };
}
export declare function createModelGateway(port: ModelPort, config: GatewayConfig, clock: Clock): ModelGateway;
//# sourceMappingURL=gateway.d.ts.map