/** Compose domain tool arrays — public tool names stay stable. */
import { auditTools } from "./audit.js";
import { candidatesTools } from "./candidates.js";
import { exportTools } from "./export.js";
import { inspirationTools } from "./inspiration.js";
import { libraryTools } from "./library.js";
import { methodsTools } from "./methods.js";
import { systemTools } from "./system.js";
import type { ToolDef } from "./types.js";
import { worksTools } from "./works.js";

export function allTools(): ToolDef[] {
  return [
    ...worksTools(),
    ...auditTools(),
    ...candidatesTools(),
    ...exportTools(),
    ...systemTools(),
    ...methodsTools(),
    ...libraryTools(),
    ...inspirationTools(),
  ];
}

export type { ToolDef } from "./types.js";
export { defineTool } from "./types.js";
export { SYSTEM_BRIEF } from "./brief.js";
export { setPluginConfig, config } from "./context.js";
export { formatLint } from "./render.js";
