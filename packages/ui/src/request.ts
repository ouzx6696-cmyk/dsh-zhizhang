export function newRequestId(prefix: string = "request") {
  return prefix + "-" + crypto.randomUUID();
}
