import type { ModeTarget } from "@zhizhang/core/pipeline";
import type { Role, ToolDefinition } from "@zhizhang/core/tool";
import { readAssistantTools } from "./assistant-read.js";
import { startAssistantTools } from "./assistant-start.js";
import { planAssistantTools } from "./assistant-plan.js";
export function fanqieAssistantTools(role: Role, target: ModeTarget): ToolDefinition[] {
  if (role !== "assistant") return [];
  return [
    ...readAssistantTools(target.path),
    ...startAssistantTools(target.path),
    ...planAssistantTools(target.path),
  ];
}
