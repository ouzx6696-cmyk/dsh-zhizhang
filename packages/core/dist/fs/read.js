import fs from "node:fs/promises";
import { AppError } from "../errors/app-error.js";
import { classify } from "../errors/classify.js";
import { parseJson } from "../schema/json.js";
export async function readTextIfExists(file) {
    try {
        return await fs.readFile(file, "utf8");
    }
    catch (err) {
        const code = err.code;
        if (code === "ENOENT")
            return undefined;
        throw classify(err);
    }
}
export async function readJson(file, parser) {
    const raw = await readTextIfExists(file);
    if (raw === undefined)
        return undefined;
    try {
        return parseJson(raw, parser, file);
    }
    catch (err) {
        if (err instanceof AppError && err.code === "input.invalid") {
            throw new AppError("storage.format_unsupported", `${file}: unsupported format`, {
                file,
                detail: err.message,
            });
        }
        throw err;
    }
}
