import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../fs/atomic.js";
import { sha256 } from "../fs/hash.js";
import { resolveInsideAsync } from "../fs/sandbox.js";
import type { LockService, ResourceKey } from "../lock/index.js";
import { FORMAT_VERSION } from "../paths.js";
import { arr, lit, nullable, obj, record, str, type Parser } from "../schema/parse.js";
import type { Intent } from "./intent.js";

const IntentSchema: Parser<Intent> = obj(
  {
    format: lit(FORMAT_VERSION),
    id: str({ min: 1 }),
    writes: arr(
      obj({
        path: str({ min: 1 }),
        beforeHash: nullable(str()),
        after: str(),
      }),
    ),
    meta: record(str()),
  },
  { strict: false },
);

interface ReplayIntentsOptions {
  allowedRoots?: readonly string[];
  lock?: LockService;
  resource?: ResourceKey;
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

async function isPathInsideRoots(filePath: string, roots: readonly string[]): Promise<boolean> {
  const resolved = path.resolve(filePath);
  for (const root of roots) {
    const base = path.resolve(root);
    const rel = path.relative(base, resolved);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    try {
      await resolveInsideAsync(base, rel);
      return true;
    } catch {
      // continue checking remaining roots
    }
  }
  return false;
}

async function replayIntentsUnlocked(
  journalDir: string,
  allowedRoots: readonly string[],
): Promise<{ resumed: string[]; conflicts: string[] }> {
  const resumed: string[] = [];
  const conflicts: string[] = [];
  const entries = await fs.readdir(journalDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const intentFile = path.join(journalDir, entry.name);
    const raw = await fs.readFile(intentFile, "utf8").catch(() => undefined);
    if (!raw) continue;
    let intent: Intent;
    try {
      intent = IntentSchema(JSON.parse(raw), intentFile);
    } catch {
      conflicts.push(entry.name);
      continue;
    }

    let conflict = false;
    for (const w of intent.writes) {
      if (!(await isPathInsideRoots(w.path, allowedRoots))) {
        conflict = true;
        break;
      }
      let cur: string | null = null;
      try {
        cur = await fs.readFile(w.path, "utf8");
      } catch (err) {
        if (!isEnoent(err)) {
          conflict = true;
          break;
        }
        cur = null;
      }
      const curHash = cur === null ? null : sha256(cur);
      const afterHash = sha256(w.after);
      if (curHash !== afterHash && curHash !== w.beforeHash) {
        conflict = true;
        break;
      }
    }
    if (conflict) {
      conflicts.push(intent.id);
      continue;
    }

    for (const w of intent.writes) {
      await atomicWrite(w.path, w.after);
    }
    await fs.rm(intentFile, { force: true });
    resumed.push(intent.id);
  }
  return { resumed, conflicts };
}

export async function replayIntents(
  journalDir: string,
  options?: ReplayIntentsOptions,
): Promise<{ resumed: string[]; conflicts: string[] }> {
  const allowedRoots =
    options?.allowedRoots && options.allowedRoots.length > 0
      ? options.allowedRoots
      : [path.dirname(path.resolve(journalDir))];
  if (options?.lock && options?.resource) {
    return options.lock.write(options.resource, () =>
      replayIntentsUnlocked(journalDir, allowedRoots),
    );
  }
  return replayIntentsUnlocked(journalDir, allowedRoots);
}
