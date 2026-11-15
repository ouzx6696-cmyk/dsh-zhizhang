import type { ModeModule, PipelineDefinition } from "@zhizhang/core/pipeline";
import { bookPipeline } from "./pipelines/book/index.js";
import { chapterPipeline } from "./pipelines/chapter/index.js";
import { dissectPipeline } from "./pipelines/dissect/index.js";
import { healthPipeline } from "./pipelines/health/index.js";
import { ledgerPipeline } from "./pipelines/ledger/index.js";
import { reviewPipeline } from "./pipelines/review/index.js";
import { revisePipeline } from "./pipelines/revise/index.js";
import { fanqieAssistantTools } from "./tools/assistant.js";

export * from "./domain/index.js";
export * from "./bible/index.js";
export * from "./context/index.js";
export * from "./learning/index.js";
export * from "./storage/index.js";
export * from "./view/index.js";
export * as commands from "./commands/index.js";

export {
  bookPipeline,
  chapterPipeline,
  dissectPipeline,
  healthPipeline,
  ledgerPipeline,
  reviewPipeline,
  revisePipeline,
};

export const fanqieModule: ModeModule<"fanqie"> = {
  mode: "fanqie",
  pipelines: {
    "fanqie.book": bookPipeline as PipelineDefinition<unknown, unknown>,
    "fanqie.chapter": chapterPipeline as PipelineDefinition<unknown, unknown>,
    "fanqie.review": reviewPipeline as PipelineDefinition<unknown, unknown>,
    "fanqie.revise": revisePipeline as PipelineDefinition<unknown, unknown>,
    "fanqie.ledger": ledgerPipeline as PipelineDefinition<unknown, unknown>,
    "fanqie.health": healthPipeline as PipelineDefinition<unknown, unknown>,
    "library.dissect": dissectPipeline as PipelineDefinition<unknown, unknown>,
  },
  tools: (role, target) => fanqieAssistantTools(role, target),
  profiles: {
    mode: "fanqie",
    defaultId: "default",
  },
};
