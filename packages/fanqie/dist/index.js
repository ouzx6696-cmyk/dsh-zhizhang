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
export { bookPipeline, chapterPipeline, dissectPipeline, healthPipeline, ledgerPipeline, reviewPipeline, revisePipeline, };
export const fanqieModule = {
    mode: "fanqie",
    pipelines: {
        "fanqie.book": bookPipeline,
        "fanqie.chapter": chapterPipeline,
        "fanqie.review": reviewPipeline,
        "fanqie.revise": revisePipeline,
        "fanqie.ledger": ledgerPipeline,
        "fanqie.health": healthPipeline,
        "library.dissect": dissectPipeline,
    },
    tools: () => fanqieAssistantTools(),
    profiles: {
        mode: "fanqie",
        defaultId: "default",
    },
};
