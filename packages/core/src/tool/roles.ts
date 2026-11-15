export type Role = "assistant" | "writer" | "editor" | "planner" | "judge" | "extractor" | "local";
export const ASSISTANT_ROLES: readonly Role[] = ["assistant"];
export const PIPELINE_ROLES: readonly Role[] = ["writer", "editor", "planner", "judge", "extractor", "local"];
