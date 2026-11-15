import type { PipelineDefinition } from "@zhizhang/core/pipeline";
import { bookPipeline } from "./pipelines/book/index.js";
import { chapterPipeline } from "./pipelines/chapter/index.js";
import { dissectPipeline } from "./pipelines/dissect/index.js";
import { healthPipeline } from "./pipelines/health/index.js";
import { ledgerPipeline } from "./pipelines/ledger/index.js";
import { reviewPipeline } from "./pipelines/review/index.js";
import { revisePipeline } from "./pipelines/revise/index.js";
export * from "./domain/index.js";
export * from "./bible/index.js";
export * from "./context/index.js";
export * from "./learning/index.js";
export * from "./storage/index.js";
export * from "./view/index.js";
export * as commands from "./commands/index.js";
export { bookPipeline, chapterPipeline, dissectPipeline, healthPipeline, ledgerPipeline, reviewPipeline, revisePipeline, };
export declare const fanqieModule: {
    mode: "fanqie";
    pipelines: {
        "fanqie.book": PipelineDefinition<unknown, unknown>;
        "fanqie.chapter": PipelineDefinition<unknown, unknown>;
        "fanqie.review": PipelineDefinition<unknown, unknown>;
        "fanqie.revise": PipelineDefinition<unknown, unknown>;
        "fanqie.ledger": PipelineDefinition<unknown, unknown>;
        "fanqie.health": PipelineDefinition<unknown, unknown>;
        "library.dissect": PipelineDefinition<unknown, unknown>;
    };
    tools: () => import("@zhizhang/core/tool").ToolDefinition[];
    profiles: {
        mode: "fanqie";
        defaultId: string;
    };
};
//# sourceMappingURL=index.d.ts.map