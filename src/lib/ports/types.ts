/** Shared gate decision types for improvement ports. */
export function deny(code: any, text: string) {
    return { ok: false, messages: [{ code, severity: "error", text }] };
}
export function allow(messages: any = []) {
    return { ok: true, messages };
}
export function warn(code: any, text: string) {
    return { code, severity: "warning", text };
}
export function info(code: any, text: string) {
    return { code, severity: "info", text };
}
export function mergeDecisions(...parts: any[]) {
    const messages = [];
    let ok = true;
    for (const p of parts) {
        if (!p.ok)
            ok = false;
        messages.push(...p.messages);
    }
    return { ok, messages };
}
export function formatGateMessages(messages: any) {
    return messages.map((m: any) => {
        if (m.severity === "error")
            return `错误[${m.code}]：${m.text}`;
        if (m.severity === "warning")
            return `警告[${m.code}]：${m.text}`;
        return `${m.code}：${m.text}`;
    });
}
