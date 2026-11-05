import path from "node:path";
import { realpathSync } from "node:fs";
import { isMissingFileError } from "./fsx.js";

export function physicalRoot(root: string): string {
  const resolved = path.resolve(root);
  try {
    return realpathSync.native(resolved);
  } catch (error) {
    if (isMissingFileError(error)) return resolved;
    throw error;
  }
}
export function rootIdentity(root: string): string {
  const value = physicalRoot(root).replaceAll("\\", "/");
  return process.platform === "win32" ? value.toLowerCase() : value;
}
