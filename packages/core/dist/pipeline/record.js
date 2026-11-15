export function emptyUsage() {
    return { input: 0, cachedInput: 0, output: 0, cost: 0 };
}
export function addUsage(a, b) {
    const cost = a.cost === null || b.cost === null ? null : a.cost + (b.cost ?? 0);
    return {
        input: a.input + (b.input ?? 0),
        cachedInput: a.cachedInput + (b.cachedInput ?? 0),
        output: a.output + (b.output ?? 0),
        cost,
    };
}
