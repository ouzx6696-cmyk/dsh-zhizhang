import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors/app-error.js";
import { sha256 } from "../fs/hash.js";
import type { Profile, StageMap } from "./stage-map.js";

export interface ProfileRoots {
  builtinDir: string;
  userDir?: string;
}

export async function loadProfile(mode: string, id: string, roots: ProfileRoots): Promise<Profile> {
  const candidates = [
    roots.userDir ? path.join(roots.userDir, mode, id) : undefined,
    path.join(roots.builtinDir, id),
  ].filter((x): x is string => Boolean(x));

  let dir: string | undefined;
  for (const c of candidates) {
    const stat = await fs.stat(c).catch(() => undefined);
    if (stat?.isDirectory()) {
      dir = c;
      break;
    }
  }
  if (!dir) {
    throw new AppError("input.not_found", `Profile not found: ${mode}/${id}`, { mode, id });
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: Record<string, string> = {};
  let stageMap: StageMap = {};
  let name = id;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    const content = await fs.readFile(full, "utf8");
    if (entry.name === "stage-map.json") {
      stageMap = JSON.parse(content) as StageMap;
    } else if (entry.name === "profile.json") {
      const meta = JSON.parse(content) as { name?: string };
      if (meta.name) name = meta.name;
    } else if (entry.name.endsWith(".md")) {
      files[entry.name] = content;
    }
  }

  const hash = sha256(JSON.stringify({ files, stageMap }));
  return { id, name, mode, files, stageMap, hash };
}
