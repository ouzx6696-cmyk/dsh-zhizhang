import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../fs/atomic.js";
import { sha256 } from "../fs/hash.js";
import type { Intent } from "./intent.js";

export async function replayIntents(
  journalDir: string,
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
      intent = JSON.parse(raw) as Intent;
      if (intent.format !== "zhizhang/1.3" || !Array.isArray(intent.writes)) {
        conflicts.push(entry.name);
        continue;
      }
    } catch {
      conflicts.push(entry.name);
      continue;
    }

    let conflict = false;
    for (const w of intent.writes) {
      const cur = await fs.readFile(w.path, "utf8").catch(() => null);
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
