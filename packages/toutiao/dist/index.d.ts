import type { PipelineDefinition } from "@zhizhang/core/pipeline";
export * from "./domain/index.js";
export * from "./rules/index.js";
export * from "./storage/index.js";
export * from "./view/index.js";
export * as commands from "./commands/index.js";
export declare const toutiaoModule: {
    mode: "toutiao";
    pipelines: {
        "toutiao.article": PipelineDefinition<unknown, unknown>;
    };
    tools: () => import("@zhizhang/core/tool").ToolDefinition[];
    profiles: {
        mode: "toutiao";
        defaultId: string;
    };
};
//# sourceMappingURL=index.d.ts.map