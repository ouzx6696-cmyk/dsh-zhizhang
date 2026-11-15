import { readTextIfExists } from "../fs/read.js";
import { sha256 } from "../fs/hash.js";
export async function isAlreadyDelivered(markerFile, runId) {
    const existing = await readTextIfExists(markerFile);
    if (!existing)
        return false;
    try {
        const parsed = JSON.parse(existing);
        return parsed.runId === runId;
    }
    catch {
        return false;
    }
}
export function buildDeliveryMarker(runId, content) {
    return JSON.stringify({ format: "zhizhang/1.3", runId, hash: sha256(content) }, null, 2);
}
