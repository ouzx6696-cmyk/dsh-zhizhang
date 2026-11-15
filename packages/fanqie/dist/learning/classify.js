const AI_CLICHE_PATTERNS = [
    "不由得",
    "微微一笑",
    "心中一凛",
    "瞳孔骤缩",
    "嘴角勾起",
    "空气仿佛凝固",
    "深吸一口气",
    "说时迟那时快",
];
function detectClicheReplacement(before, after) {
    for (const cliché of AI_CLICHE_PATTERNS) {
        if (before.includes(cliché) && !after.includes(cliché)) {
            return cliché;
        }
    }
    return undefined;
}
export function classifyHunk(hunk) {
    const before = hunk.before.trim();
    const after = hunk.after.trim();
    if (hunk.kind === "split") {
        return {
            kind: "split",
            signature: "split:long-sentence",
            condition: "出现超过 25 字的长复句或密集信息句",
            change: "拆分为短句与独立动作节拍",
            why: "提升移动端阅读节奏与断句爽感",
            before,
            after,
        };
    }
    if (hunk.kind === "word") {
        const cliché = detectClicheReplacement(before, after);
        if (cliché) {
            return {
                kind: "word",
                signature: `word:replace-${cliché}`,
                condition: `出现网文套话「${cliché}」`,
                change: `删去或替换为具体动作与神态描写`,
                why: "去除 AI 味套话，增强画面实感",
                before,
                after,
            };
        }
        return {
            kind: "word",
            signature: "word:lexical-polish",
            condition: "用词偏书面或抽象总结",
            change: "替换为更口语、具象的番茄网文表达",
            why: "保持口语化与强代入感",
            before,
            after,
        };
    }
    if (hunk.kind === "dialogue") {
        return {
            kind: "dialogue",
            signature: before ? "dialogue:sharpen" : "dialogue:add-beat",
            condition: before ? "人物对白偏长或缺乏锋芒" : "冲突或情绪转折处缺少直接对白",
            change: before ? "精简并强化人物台词交锋" : "补入简短直接的人物对白推进冲突",
            why: "用对话直接推动矛盾与展现人物性格",
            before,
            after,
        };
    }
    if (hunk.kind === "action") {
        return {
            kind: "action",
            signature: "action:show-not-tell",
            condition: "段落存在心理总结或抽象情绪概括",
            change: "改写为可感知的肢体动作、视线或环境反馈",
            why: "以动作代说明，增强现场感",
            before,
            after,
        };
    }
    if (hunk.kind === "delete") {
        const cliché = detectClicheReplacement(before, "");
        if (cliché) {
            return {
                kind: "delete",
                signature: `delete:cliche-${cliché}`,
                condition: `出现冗余套话「${cliché}」`,
                change: "直接删除冗余套话句",
                why: "减少废话与 AI 腔调",
                before,
                after,
            };
        }
        return {
            kind: "delete",
            signature: "delete:trim-redundancy",
            condition: "出现重复解释、过渡废话或事后总结",
            change: "整句删减，保留核心动作与信息",
            why: "加快叙事节奏，避免拖沓",
            before,
            after,
        };
    }
    return {
        kind: "expand",
        signature: "expand:detail-beat",
        condition: "关键转折或爽点处细节偏薄",
        change: "补写具体反应、代价或即时反馈",
        why: "放大情绪落点与爽点兑现",
        before,
        after,
    };
}
export function classifyHunks(hunks) {
    return hunks.map(classifyHunk);
}
