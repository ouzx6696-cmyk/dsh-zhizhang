import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors/app-error.js";
import { classify } from "../errors/classify.js";
import { atomicWrite } from "../fs/atomic.js";
import { sha256 } from "../fs/hash.js";
import type { LockService, ResourceKey } from "../lock/index.js";
import type { FormatVersion } from "../paths.js";

export interface IntentWrite {
  path: string;
  beforeHash: string | null;
  after: string;
}

export interface Intent {
  format: FormatVersion;
  id: string;
  writes: IntentWrite[];
  meta: Record<string, string>;
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

export async function commitIntent(
  journalDir: string,
  intent: Intent,
  lock: LockService,
  resource: ResourceKey,
): Promise<void> {
  return lock.write(resource, async () => {
    for (const w of intent.writes) {
      const ok = await verifyBeforeHash(w.path, w.beforeHash);
      if (!ok) {
        throw new AppError("storage.conflict", "写入目标已被外部修改，已中止提交", {
          path: w.path,
          intentId: intent.id,
        });
      }
    }
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
  } catch (err) {
    if (isEnoent(err)) return expected === null;
    throw classify(err);
  }
}
