/** Shared gate decision types for improvement ports. */
export function deny(code, text) {
    return { ok: false, messages: [{ code, severity: "error", text }] };
}
export function allow(messages = []) {
    return { ok: true, messages };
}
export function warn(code, text) {
    return { code, severity: "warning", text };
}
export function info(code, text) {
    return { code, severity: "info", text };
}
export function mergeDecisions(...parts) {
    const messages = [];
    let ok = true;
    for (const p of parts) {
        if (!p.ok)
            ok = false;
        messages.push(...p.messages);
    }
    return { ok, messages };
}
export function formatGateMessages(messages, opts = {}) {
    return messages.map((m) => {
        if (m.severity === "error")
            return `错误[${m.code}]：${m.text}`;
        if (m.severity === "warning")
            return `警告[${m.code}]：${m.text}`;
        if (opts.textOnlyInfo?.has(m.code))
            return m.text;
        return `${m.code}：${m.text}`;
    });
}
