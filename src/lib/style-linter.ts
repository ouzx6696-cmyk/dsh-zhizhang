/** Client-only style diagnostics for AI-ish / lazy prose. Zero network. */
const DIALOGUE_PAIR = /([“「])([\s\S]*?)([”」])/g;
/** Ranges of quoted dialogue that should not trigger narrative style rules. */
export function dialogueRanges(text: string) {
    const ranges = [];
    DIALOGUE_PAIR.lastIndex = 0;
    let match;
    while ((match = DIALOGUE_PAIR.exec(text)) !== null) {
        ranges.push([match.index, match.index + match[0].length]);
    }
    return ranges;
}
function inDialogue(index: number, ranges: any) {
    return ranges.some(([start, end]: [number, number]) => index >= start && index < end);
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
function lastParagraphSpan(text: string) {
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
/** Scan manuscript text; dialogue in “…” / 「…」 is exempt. */
export function lintStyle(text: string) {
    if (!text)
        return [];
    const ranges = dialogueRanges(text);
    const hits = [];
    const seen = new Set();
    for (const rule of RULES) {
        const scopes = rule.endingOnly
            ? (() => {
                const span = lastParagraphSpan(text);
                return span ? [{ offset: span.start, slice: span.text }] : [];
            })()
            : [{ offset: 0, slice: text }];
        for (const scope of scopes) {
            const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
            let match;
            while ((match = re.exec(scope.slice)) !== null) {
                const start = scope.offset + match.index;
                const end = start + match[0].length;
                if (inDialogue(start, ranges))
                    continue;
                const key = `${rule.category}:${start}:${end}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                hits.push({
                    category: rule.category,
                    start,
                    end,
                    match: match[0],
                    hint: rule.hint,
                });
            }
        }
    }
    hits.sort((a: any, b: any) => a.start - b.start || a.end - b.end);
    return hits;
}
export function summarizeStyleLint(hits: any) {
    const summary = {
        cliche_syntax: 0,
        lazy_emotion: 0,
        process_skip: 0,
        slogan_ending: 0,
    };
    for (const hit of hits)
        (summary as Record<string, number>)[hit.category]++;
    return summary;
}
