import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors/app-error.js";

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

function validateResourceSegments(segments: readonly string[]): string {
  for (const segment of segments) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      /[\\/:*?"<>|\u0000-\u001f]/.test(segment)
    ) {
      throw new AppError("input.invalid", `Invalid resource name: ${segment}`);
    }
  }
  return segments.join("/");
}

function validateInsidePaths(
  root: string,
  rel: string,
): {
  base: string;
  target: string;
  segments: string[];
} {
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
  return { base, target, segments: relBack.split(path.sep).filter(Boolean) };
}

export function resolveResourcePath(root: string, ...segments: string[]): string {
  return resolveInside(root, validateResourceSegments(segments));
}

export async function resolveResourcePathAsync(
  root: string,
  ...segments: string[]
): Promise<string> {
  return resolveInsideAsync(root, validateResourceSegments(segments));
}

export function resolveInside(root: string, rel: string): string {
  const { base, target, segments } = validateInsidePaths(root, rel);
  let cur = base;
  for (const seg of segments) {
    cur = path.join(cur, seg);
    if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink()) {
      throw new AppError("input.invalid", `Symlink not allowed inside root: ${cur}`, { cur });
    }
  }
  return target;
}

export async function resolveInsideAsync(root: string, rel: string): Promise<string> {
  const { base, target, segments } = validateInsidePaths(root, rel);
  let cur = base;
  for (const seg of segments) {
    cur = path.join(cur, seg);
    const stat = await fsp.lstat(cur).catch(() => undefined);
    if (stat?.isSymbolicLink()) {
      throw new AppError("input.invalid", `Symlink not allowed inside root: ${cur}`, { cur });
    }
  }
  return target;
}
