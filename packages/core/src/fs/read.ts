import fs from "node:fs/promises";
import { AppError } from "../errors/app-error.js";
import { classify } from "../errors/classify.js";
import { parseJson } from "../schema/json.js";
import type { Parser } from "../schema/parse.js";

export async function readTextIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") return undefined;
    throw classify(err);
  }
}

export async function readJson<T>(file: string, parser: Parser<T>): Promise<T | undefined> {
  const raw = await readTextIfExists(file);
  if (raw === undefined) return undefined;
  try {
    return parseJson(raw, parser, file);
  } catch (err) {
    if (err instanceof AppError && err.code === "input.invalid") {
      throw new AppError("storage.format_unsupported", `${file}: unsupported format`, {
        file,
        detail: err.message,
      });
    }
    throw err;
  }
}
