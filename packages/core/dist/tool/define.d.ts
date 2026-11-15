import type { ErrorCode } from "../errors/codes.js";
import type { Parser } from "../schema/parse.js";
import type { Role } from "./roles.js";
export type JsonSchema = Record<string, unknown>;
export interface ToolCtx {
    workspaceRoot: string;
    readonly: boolean;
    signal?: AbortSignal;
}
export interface ToolSpec<A, V extends object> {
    name: string;
    description: string;
    params: Parser<A>;
    jsonSchema: JsonSchema;
    roles: readonly Role[];
    run(args: A, ctx: ToolCtx): Promise<V>;
    render?(value: V): string;
}
export type ToolDefinition<A = unknown, V extends object = object> = ToolSpec<A, V>;
export type ToolResult<V extends object = object> = ({
    ok: true;
} & V) | {
    ok: false;
    code: ErrorCode;
    message: string;
};
export declare function defineTool<A, V extends object>(spec: ToolSpec<A, V>): ToolDefinition<A, V>;
//# sourceMappingURL=define.d.ts.map