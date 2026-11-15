import crypto from "node:crypto";
export function sha256(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
}
export function shortHash(data, len = 12) {
    return sha256(data).slice(0, len);
}
