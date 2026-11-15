import crypto from "node:crypto";

export function sha256(data: string | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function shortHash(data: string | Uint8Array, len = 12): string {
  return sha256(data).slice(0, len);
}
