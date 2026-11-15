import type { ModeModule, PipelineDefinition } from "@zhizhang/core/pipeline";
import { articlePipeline } from "./pipelines/article/index.js";
import { toutiaoAssistantTools } from "./tools/assistant.js";

export * from "./domain/index.js";
export * from "./rules/index.js";
export * from "./storage/index.js";
export * from "./view/index.js";
export * as commands from "./commands/index.js";

export const toutiaoModule: ModeModule<"toutiao"> = {
  mode: "toutiao",
  pipelines: {
    "toutiao.article": articlePipeline as PipelineDefinition<unknown, unknown>,
  },
  tools: (role, target) => toutiaoAssistantTools(role, target),
  profiles: {
    mode: "toutiao",
    defaultId: "default",
  },
};
