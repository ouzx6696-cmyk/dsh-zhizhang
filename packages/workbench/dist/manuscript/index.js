export function sortAnnotations(items) {
    return [...items].sort((a, b) => a.from - b.from || a.to - b.to);
}
