import { type MethodLibrary } from "../../core/src/profiles.js";
export interface ProfileCommandContext {
    command: string;
    kind: "read" | "write";
    input: Record<string, unknown>;
    reply(result: unknown): void;
}
export declare function profileRoutes(base: string, lib: MethodLibrary, pinned?: () => string | undefined): {
    handle: (ctx: ProfileCommandContext) => Promise<boolean>;
};
//# sourceMappingURL=profile-api.d.ts.map