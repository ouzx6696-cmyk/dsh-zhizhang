import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../fs/atomic.js";
import { sha256 } from "../fs/hash.js";
import type { LockService, ResourceKey } from "../lock/index.js";

export interface IntentWrite {
  path: string;
  beforeHash: string | null;
  after: string;
}

export interface Intent {
  format: "zhizhang/1.3";
  id: string;
  writes: IntentWrite[];
  meta: Record<string, string>;
}

export async function commitIntent(
  journalDir: string,
  intent: Intent,
  lock: LockService,
  resource: ResourceKey,
): Promise<void> {
  return lock.write(resource, async () => {
    await fs.mkdir(journalDir, { recursive: true });
    const intentFile = path.join(journalDir, `${intent.id}.json`);
    await atomicWrite(intentFile, JSON.stringify(intent, null, 2));
    for (const w of intent.writes) {
      await atomicWrite(w.path, w.after);
    }
    await fs.rm(intentFile, { force: true });
  });
}

export async function verifyBeforeHash(file: string, expected: string | null): Promise<boolean> {
  try {
    const content = await fs.readFile(file, "utf8");
    return expected !== null && sha256(content) === expected;
  } catch {
    return expected === null;
  }
}
