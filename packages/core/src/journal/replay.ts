import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../fs/atomic.js";
import { sha256 } from "../fs/hash.js";
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
      intent = IntentSchema(JSON.parse(raw), intentFile);
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
