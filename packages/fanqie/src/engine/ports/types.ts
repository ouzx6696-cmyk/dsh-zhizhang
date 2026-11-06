export interface GateMessage {
  code: string;
  text: string;
  severity: "error" | "warning" | "info";
}
export interface GateDecision {
  ok: boolean;
  messages: GateMessage[];
}
/** Shared gate decision types for improvement ports. */
export function deny(code: string, text: string): GateDecision {
  return { ok: false, messages: [{ code, severity: "error", text }] };
}
export function allow(messages: GateMessage[] = []): GateDecision {
  return { ok: true, messages };
}
export function warn(code: string, text: string): GateMessage {
  return { code, severity: "warning", text };
}
export function info(code: string, text: string): GateMessage {
  return { code, severity: "info", text };
}
export function mergeDecisions(...parts: GateDecision[]) {
  const messages = [];
  let ok = true;
  for (const p of parts) {
    if (!p.ok) ok = false;
    messages.push(...p.messages);
  }
  return { ok, messages };
}
export function formatGateMessages(
  messages: GateMessage[],
  opts: { textOnlyInfo?: Set<string> } = {},
) {
  return messages.map((m) => {
    if (m.severity === "error") return `错误[${m.code}]：${m.text}`;
    if (m.severity === "warning") return `警告[${m.code}]：${m.text}`;
    if (opts.textOnlyInfo?.has(m.code)) return m.text;
    return `${m.code}：${m.text}`;
  });
}
