import { readTextIfExists } from "../fs/read.js";
import { sha256 } from "../fs/hash.js";
import { FORMAT_VERSION } from "../paths.js";
import { obj, opt, str } from "../schema/parse.js";

const DeliveryMarkerSchema = obj(
  {
    format: opt(str()),
    runId: opt(str()),
  },
  { strict: false },
);

export async function isAlreadyDelivered(markerFile: string, runId: string): Promise<boolean> {
  const existing = await readTextIfExists(markerFile);
  if (!existing) return false;
  try {
    const parsed = DeliveryMarkerSchema(JSON.parse(existing), markerFile);
    return parsed.format === FORMAT_VERSION && parsed.runId === runId;
  } catch {
    return false;
  }
}

export function buildDeliveryMarker(runId: string, content: string): string {
  return JSON.stringify({ format: FORMAT_VERSION, runId, hash: sha256(content) }, null, 2);
}
