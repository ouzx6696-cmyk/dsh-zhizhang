import { readTextIfExists } from "../fs/read.js";
import { sha256 } from "../fs/hash.js";

export async function isAlreadyDelivered(markerFile: string, runId: string): Promise<boolean> {
  const existing = await readTextIfExists(markerFile);
  if (!existing) return false;
  try {
    const parsed = JSON.parse(existing) as { runId?: string };
    return parsed.runId === runId;
  } catch {
    return false;
  }
}

export function buildDeliveryMarker(runId: string, content: string): string {
  return JSON.stringify({ format: "zhizhang/1.3", runId, hash: sha256(content) }, null, 2);
}
