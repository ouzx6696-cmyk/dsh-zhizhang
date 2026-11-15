import type { PipelineDefinition } from "@zhizhang/core/pipeline";
import { articlePipeline } from "./pipelines/article/index.js";
import { toutiaoAssistantTools } from "./tools/assistant.js";

export * from "./domain/index.js";
export * from "./rules/index.js";
export * from "./storage/index.js";
export * from "./view/index.js";
export * as commands from "./commands/index.js";

export const toutiaoModule = {
  mode: "toutiao" as const,
  pipelines: {
    "toutiao.article": articlePipeline as PipelineDefinition<unknown, unknown>,
  },
  tools: () => toutiaoAssistantTools(),
  profiles: {
    mode: "toutiao" as const,
    defaultId: "default",
  },
};
