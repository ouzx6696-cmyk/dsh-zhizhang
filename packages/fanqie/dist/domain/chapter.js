export function parseChapterMarkdown(raw) {
    const match = /^<!--\s*zhizhang:meta\s*\n([\s\S]*?)\n-->\s*\n?([\s\S]*)$/.exec(raw);
    if (!match) {
        return {
            meta: { id: "", title: "", status: "drafting", revision: "rev-0" },
            body: raw,
        };
    }
    const meta = JSON.parse(match[1]);
    return { meta, body: match[2] };
}
export function serializeChapterMarkdown(doc) {
    return `<!-- zhizhang:meta\n${JSON.stringify(doc.meta, null, 2)}\n-->\n${doc.body}`;
}
