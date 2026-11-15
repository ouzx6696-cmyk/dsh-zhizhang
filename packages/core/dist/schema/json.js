import { AppError } from "../errors/app-error.js";
export function parseJson(raw, parser, source = "json") {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        throw new AppError("storage.format_unsupported", `${source}: invalid JSON`, {
            source,
            cause: err instanceof Error ? err.message : String(err),
        });
    }
    return parser ? parser(parsed, "$") : parsed;
}
