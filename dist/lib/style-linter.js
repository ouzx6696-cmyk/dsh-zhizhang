/** Deterministic prose signals for tools and local diagnostics; no model or network. */
/** Pair dialogue delimiters in one pass, including nested quotes and unmatched input. */
export function dialogueRanges(text) {
    const stack = [];
    const ranges = [];
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (character === '“' || character === '「')
            stack.push({ character, start: index });
        else if (character === '”' || character === '」') {
            const open = stack[stack.length - 1];
            if (open && (open.character === '“' ? character === '”' : character === '」')) {
                stack.pop();
                ranges.push([open.start, index + 1]);
            }
        }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ranges) {
        const previous = merged[merged.length - 1];
        if (previous && range[0] <= previous[1])
            previous[1] = Math.max(previous[1], range[1]);
        else
            merged.push(range);
    }
    return merged;
}
function inDialogue(index, ranges) {
    // ranges 由 dialogueRanges 按出现顺序产出（按 start 升序），二分定位。
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const [start, end] = ranges[mid];
        if (index < start)
            hi = mid - 1;
        else if (index >= end)
            lo = mid + 1;
        else
            return true;
    }
    return false;
}
const RULES = [
    {
        category: "cliche_syntax",
        pattern: /不是[^。！？\n]{0,48}而是/g,
        hint: "辩证翻案套话：可改为具体动作或判断，不必先否定再立论。",
    },
    {
        category: "cliche_syntax",
        pattern: /与其说(?:是)?[^。！？\n]{0,40}不如说(?:是)?/g,
        hint: "修辞翻案套话：直接写处境下的判断即可。",
    },
    {
        category: "cliche_syntax",
        pattern: /嘴角勾起一抹/g,
        hint: "脸谱微表情：用手头小动作、停顿或视线回避代替。",
    },
    {
        category: "cliche_syntax",
        pattern: /眼中闪过一丝/g,
        hint: "廉价眼神描写：改写为可观察的具体反应。",
    },
    {
        category: "cliche_syntax",
        pattern: /(?:一丝|一抹|几分|些许)(?:[^。！？\n]{0,8})?(?:不禁|不由得)?/g,
        hint: "高频虚词堆砌：删去「一丝/一抹」等填充，保留可感细节。",
    },
    {
        category: "cliche_syntax",
        pattern: /不禁|不由得/g,
        hint: "被动情绪套话：改为角色主动的小动作或算计。",
    },
    {
        category: "lazy_emotion",
        pattern: /(?:他|她|我|他们|她们)(?:感到|觉得|意识到|注意到)[^。！？\n]{0,40}/g,
        hint: "感知前置：去掉「感到/意识到」，用处境偏见或具体代价呈现。",
    },
    {
        category: "lazy_emotion",
        pattern: /心中涌起(?:一股)?[^。！？\n]{0,20}/g,
        hint: "抽象情绪宣判：改写为正在算计/逃避的具体动作。",
    },
    {
        category: "lazy_emotion",
        pattern: /心情无比复杂|感到一阵莫名的|一阵莫名的/g,
        hint: "空泛情绪标签：落到物件、声音或利益阻力上。",
    },
    {
        category: "process_skip",
        pattern: /经过一番(?:激烈的)?心理斗争|经过一番交涉|很快便处理妥当|做出了艰难的抉择/g,
        hint: "过程跳步：补写动作阻力、物件细节或带潜台词的交锋。",
    },
    {
        category: "slogan_ending",
        pattern: /他知道[，,]属于他的[^。！？\n]{0,30}才刚刚开始|暴风雨即将?来临|命运的齿轮开始转动|一切才刚刚开始/g,
        hint: "章末口号癖：让结尾落在现场具体的人、事、声音或当场细节上。",
        endingOnly: true,
    },
];
function lastParagraphSpan(text) {
    const parts = text.split(/\n+/);
    for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        if (!part.trim())
            continue;
        const start = text.lastIndexOf(part);
        return { start: start < 0 ? 0 : start, text: part };
    }
    return null;
}
/** Merge rule cursors in document order; retain at most `limit` results while counting all hits. */
export function scanStyle(text, limit = 120, include = () => true) {
    const ranges = dialogueRanges(text);
    function* matches(rule) {
        const span = rule.endingOnly ? lastParagraphSpan(text) : { start: 0, text };
        if (!span)
            return;
        const re = new RegExp(rule.pattern.source, rule.pattern.flags);
        let match;
        while ((match = re.exec(span.text))) {
            const start = span.start + match.index, end = start + match[0].length;
            if (include(start, end) && !inDialogue(start, ranges)) {
                yield { category: rule.category, start, end, match: match[0], hint: rule.hint };
            }
        }
    }
    const cursors = RULES.map(rule => { const iterator = matches(rule); return { iterator, next: iterator.next() }; });
    const hits = [];
    let totalHits = 0, position = '', seen = new Set();
    while (true) {
        let selected = -1;
        for (let i = 0; i < cursors.length; i++) {
            const candidate = cursors[i].next;
            if (candidate.done)
                continue;
            const current = selected < 0 ? undefined : cursors[selected].next.value;
            if (!current || candidate.value.start < current.start || (candidate.value.start === current.start && candidate.value.end < current.end))
                selected = i;
        }
        if (selected < 0)
            break;
        const cursor = cursors[selected], hit = cursor.next.value;
        const key = `${hit.start}:${hit.end}`;
        if (position !== key) {
            position = key;
            seen = new Set();
        }
        if (!seen.has(hit.category)) {
            seen.add(hit.category);
            totalHits++;
            if (hits.length < limit)
                hits.push(hit);
        }
        cursor.next = cursor.iterator.next();
    }
    return { hits, totalHits };
}
export function lintStyle(text) { return scanStyle(text, Infinity).hits; }
export function summarizeStyleLint(hits) {
    const summary = {
        cliche_syntax: 0,
        lazy_emotion: 0,
        process_skip: 0,
        slogan_ending: 0,
    };
    for (const hit of hits)
        summary[hit.category]++;
    return summary;
}
