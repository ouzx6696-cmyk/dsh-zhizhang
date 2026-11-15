import fs from "node:fs";
import path from "node:path";
import { AppError } from "../errors/app-error.js";

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

export function resolveInside(root: string, rel: string): string {
  if (!rel || path.isAbsolute(rel)) {
    throw new AppError("input.invalid", `Path must be relative: ${rel}`, { rel });
  }
  const base = path.resolve(root);
  const target = path.resolve(base, rel);
  const relBack = path.relative(base, target);
  if (relBack.startsWith("..") || path.isAbsolute(relBack)) {
    throw new AppError("input.invalid", `Path escapes root: ${rel}`, { rel });
  }
  for (const seg of rel.split(/[\\/]+/)) {
    if (WIN_RESERVED.test(seg)) {
      throw new AppError("input.invalid", `Reserved filename segment: ${seg}`, { seg });
    }
  }
  let cur = base;
  for (const seg of relBack.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, seg);
    if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink()) {
      throw new AppError("input.invalid", `Symlink not allowed inside root: ${cur}`, { cur });
    }
  }
  return target;
}
