export function inlineRuns(text, offset) {
    const runs = [];
    const pattern = /(`[^`\r\n]+`|\*\*[^*\r\n]+\*\*|\*[^*\r\n]+\*)/g;
    let position = 0, match;
    while ((match = pattern.exec(text))) {
        if (match.index > position) {
            runs.push({ text: text.slice(position, match.index), start: offset + position, end: offset + match.index });
        }
        const delimiter = match[0].startsWith('**') ? 2 : 1;
        runs.push({
            text: match[0].slice(delimiter, -delimiter),
            start: offset + match.index + delimiter,
            end: offset + match.index + match[0].length - delimiter,
            style: match[0][0] === '`' ? 'code' : delimiter === 2 ? 'strong' : 'em',
        });
        position = match.index + match[0].length;
    }
    if (position < text.length)
        runs.push({ text: text.slice(position), start: offset + position, end: offset + text.length });
    return runs;
}
export function parseManuscript(text) {
    const blocks = [];
    let paragraph, code;
    for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
        if (!match[0])
            continue;
        const line = match[0].replace(/[\r\n]+$/, '');
        const start = match.index, end = start + line.length;
        if (code) {
            code.end = end;
            if (line.startsWith('```')) {
                code = undefined;
                continue;
            }
            if (code.runs.length)
                code.runs.push({ text: '\n', start: start - 1, end: start });
            code.runs.push({ text: line, start, end });
            continue;
        }
        if (line.startsWith('```')) {
            paragraph = undefined;
            code = { kind: 'pre', start, end, runs: [] };
            blocks.push(code);
            continue;
        }
        if (!line.trim()) {
            paragraph = undefined;
            continue;
        }
        if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
            paragraph = undefined;
            blocks.push({ kind: 'hr', start, end, runs: [] });
            continue;
        }
        const heading = /^(#{1,3})\s+/.exec(line), quote = /^>\s?/.exec(line);
        if (heading || quote) {
            paragraph = undefined;
            const skip = (heading || quote)[0].length;
            blocks.push({ kind: heading ? 'h' + heading[1].length : 'blockquote', start, end, runs: inlineRuns(line.slice(skip), start + skip) });
            continue;
        }
        if (!paragraph) {
            paragraph = { kind: 'p', start, end, runs: [] };
            blocks.push(paragraph);
        }
        else
            paragraph.runs.push({ text: '\n', start: start - 1, end: start });
        paragraph.end = end;
        for (const run of inlineRuns(line, start))
            paragraph.runs.push(run);
    }
    return blocks;
}
