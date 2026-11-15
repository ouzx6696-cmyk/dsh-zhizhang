import { AppError } from "../errors/app-error.js";
import type { Parser } from "./parse.js";

export function parseJson<T>(raw: string, parser?: Parser<T>, source = "json"): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AppError("storage.format_unsupported", `${source}: invalid JSON`, {
      source,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  return parser ? parser(parsed, "$") : (parsed as T);
}
