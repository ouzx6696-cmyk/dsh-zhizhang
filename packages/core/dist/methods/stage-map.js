import { sha256 } from "../fs/hash.js";
function extractSections(markdown, wanted) {
    if (!wanted || wanted.length === 0) {
        return { text: markdown.trim(), missing: [] };
    }
    const lines = markdown.split(/\r?\n/);
    const blocks = new Map();
    let current;
    for (const line of lines) {
        const match = /^##\s+(.+?)\s*$/.exec(line);
        if (match) {
            current = match[1].trim();
            if (!blocks.has(current))
                blocks.set(current, [line]);
        }
        else if (current) {
            blocks.get(current)?.push(line);
        }
    }
    const out = [];
    const missing = [];
    for (const name of wanted) {
        const sec = blocks.get(name);
        if (sec)
            out.push(sec.join("\n").trim());
        else
            missing.push(name);
    }
    return { text: out.join("\n\n"), missing };
}
export function methodFor(profile, stage) {
    const rule = profile.stageMap[stage];
    if (!rule) {
        return { text: "", hash: sha256(""), omitted: [] };
    }
    const parts = [];
    const omitted = [];
    for (const take of rule.take) {
        const raw = profile.files[take.file];
        if (raw === undefined) {
            omitted.push(take.file);
            continue;
        }
        const extracted = extractSections(raw, take.sections);
        for (const m of extracted.missing)
            omitted.push(`${take.file}#${m}`);
        let content = extracted.text;
        if (take.maxChars !== undefined && content.length > take.maxChars) {
            content = content.slice(0, take.maxChars);
            omitted.push(`${take.file}(truncated)`);
        }
        if (content)
            parts.push(content);
    }
    const text = parts.join("\n\n");
    return { text, hash: sha256(text), omitted };
}
