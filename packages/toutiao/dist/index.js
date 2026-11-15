import { articlePipeline } from "./pipelines/article/index.js";
import { toutiaoAssistantTools } from "./tools/assistant.js";
export * from "./domain/index.js";
export * from "./rules/index.js";
export * from "./storage/index.js";
export * from "./view/index.js";
export * as commands from "./commands/index.js";
export const toutiaoModule = {
    mode: "toutiao",
    pipelines: {
        "toutiao.article": articlePipeline,
    },
    tools: () => toutiaoAssistantTools(),
    profiles: {
        mode: "toutiao",
        defaultId: "default",
    },
};
