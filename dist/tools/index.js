/** Compose domain tool arrays — public tool names stay stable. */
import { auditTools } from "./audit.js";
import { candidatesTools } from "./candidates.js";
import { exportTools } from "./export.js";
import { inspirationTools } from "./inspiration.js";
import { libraryTools } from "./library.js";
import { analysisTools } from "./analysis.js";
import { methodsTools } from "./methods.js";
import { systemTools } from "./system.js";
import { worksTools } from "./works.js";
export function allTools() {
    return [
        ...worksTools(),
        ...auditTools(),
        ...candidatesTools(),
        ...exportTools(),
        ...systemTools(),
        ...methodsTools(),
        ...libraryTools(),
        ...analysisTools(),
        ...inspirationTools(),
    ];
}
export { defineTool } from "./types.js";
export { SYSTEM_BRIEF } from "./brief.js";
export { setPluginConfig, config } from "./context.js";
export { formatLint } from "./render.js";
