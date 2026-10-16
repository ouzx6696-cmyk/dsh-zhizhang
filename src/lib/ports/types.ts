/** Shared gate decision types for improvement ports. */

export type GateSeverity = "error" | "warning" | "info";

export interface GateMessage {
  code: string;
  severity: GateSeverity;
  text: string;
}

/** ok===false means hard refuse; warnings still allow when ok===true. */
export interface GateDecision {
  ok: boolean;
  messages: GateMessage[];
}

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

export function mergeDecisions(...parts: GateDecision[]): GateDecision {
  const messages: GateMessage[] = [];
  let ok = true;
  for (const p of parts) {
    if (!p.ok) ok = false;
    messages.push(...p.messages);
  }
  return { ok, messages };
}

export function formatGateMessages(messages: GateMessage[]): string[] {
  return messages.map((m) => {
    if (m.severity === "error") return `错误[${m.code}]：${m.text}`;
    if (m.severity === "warning") return `警告[${m.code}]：${m.text}`;
    return `${m.code}：${m.text}`;
  });
}
