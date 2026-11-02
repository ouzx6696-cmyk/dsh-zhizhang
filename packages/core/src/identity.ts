import path from "node:path";
import { realpathSync } from "node:fs";

export function physicalRoot(root: string): string {
  const resolved = path.resolve(root);
  try {
    return realpathSync.native(resolved);
  } catch (error: any) {
    if (error.code === "ENOENT") return resolved;
    throw error;
  }
}
export function rootIdentity(root: string): string {
  const value = physicalRoot(root).replaceAll("\\", "/");
  return process.platform === "win32" ? value.toLowerCase() : value;
}
