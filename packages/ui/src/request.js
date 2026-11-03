export function newRequestId(prefix = "request") {
  return prefix + "-" + crypto.randomUUID();
}
