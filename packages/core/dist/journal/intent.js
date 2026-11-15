import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../fs/atomic.js";
import { sha256 } from "../fs/hash.js";
export async function commitIntent(journalDir, intent, lock, resource) {
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
export async function verifyBeforeHash(file, expected) {
    try {
        const content = await fs.readFile(file, "utf8");
        return expected !== null && sha256(content) === expected;
    }
    catch {
        return expected === null;
    }
}
