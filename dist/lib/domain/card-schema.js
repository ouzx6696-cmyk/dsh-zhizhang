/**
 * 卡 schema — v2 模块字段、校验、v1→v2 适配视图。
 *
 * 下游（格式化 / 审计 / 报告 / 覆盖率 / 灵感注入）只应看到 v2 视图；
 * v1 旧卡在边界处由 toCardView() 补齐字段并标记 legacy，不再到处写
 * `schemaVersion === 2 || layer` 的分支。
 */

export const LAYERS = ["book", "arc", "unit", "chapter", "scene", "line"];
export const DIMENSIONS = ["structure", "character", "rhythm", "hook", "prose", "commercial"];
export const HOOK_TYPES = ["悬念", "冲突", "反差", "代入", "信息差", "反转", "新角色", "代价", "决定", "发现"];
export const HOOK_STRENGTHS = ["弱", "中", "强"];

/** v2 模块必填/可选字段的单一描述（校验、文档、工具 schema 都从这里读）。 */
export const CARD_V2_FIELDS = [
    { key: "readerWant", label: "读者想看什么", type: "string", required: true },
    { key: "emotionArc", label: "情绪走向", type: "string", required: true },
    { key: "dramaticUnit", label: "戏剧单元", type: "string", required: true },
    { key: "replaceables", label: "可替换项", type: "array", required: true, min: 1 },
    { key: "mustNotCopy", label: "不可照搬", type: "array", required: true, min: 1 },
    { key: "transfer", label: "怎么迁到新作", type: "string", required: true },
    { key: "failWhen", label: "失败边界", type: "string", required: true },
    { key: "evidence", label: "证据", type: "array", required: true, min: 1 },
    { key: "steps", label: "操作步骤", type: "array", required: false, min: 2 },
    { key: "bannedDiction", label: "反AI腔词表", type: "array", required: false },
];

export function deriveAxis(layer, dimension) {
    if (["book", "arc", "unit"].includes(layer))
        return "mind";
    if (["scene", "chapter", "line"].includes(layer))
        return "craft";
    if (["structure", "character", "commercial"].includes(dimension))
        return "mind";
    return "craft";
}

function text(v) {
    return String(v ?? "").trim();
}

function arrayOfText(v) {
    return Array.isArray(v) && v.some((x) => text(x));
}

/** v2 模块校验；v1 卡不走这里（用 toCardView 适配后再校验会缺 evidence）。 */
export function validateModule(card) {
    const errors = [];
    const warnings = [];
    const c = card ?? {};
    const layer = text(c.layer);
    const dimension = text(c.dimension);
    if (!LAYERS.includes(layer))
        errors.push(`layer 非法：${layer || "（空）"}（可用：${LAYERS.join("/")}）`);
    if (!DIMENSIONS.includes(dimension))
        errors.push(`dimension 非法：${dimension || "（空）"}（可用：${DIMENSIONS.join("/")}）`);

    for (const f of CARD_V2_FIELDS) {
        if (f.required) {
            if (f.type === "array") {
                if (!arrayOfText(c[f.key]))
                    errors.push(`${f.key} 不能为空（${f.label}）`);
            }
            else if (!text(c[f.key])) {
                errors.push(`${f.key} 为空（${f.label}）`);
            }
            continue;
        }
        // 可选字段：只有「显式传了但不合格」才警告；空数组视为没传。
        if (c[f.key] === undefined || c[f.key] === null)
            continue;
        if (f.type === "array" && !Array.isArray(c[f.key])) {
            warnings.push(`${f.key} 应为字符串数组（${f.label}）`);
            continue;
        }
        if (f.type === "array" && f.min && c[f.key].length > 0 && c[f.key].length < f.min)
            warnings.push(`${f.key} 应为 ≥${f.min} 项（${f.label}）`);
    }

    if (Array.isArray(c.evidence)) {
        for (const [i, e] of c.evidence.entries()) {
            if (!text(e?.quote))
                errors.push(`evidence[${i}].quote 为空`);
            if (!text(e?.chapter))
                errors.push(`evidence[${i}].chapter 为空`);
        }
    }

    if (!Array.isArray(c.mechanisms) || c.mechanisms.length === 0)
        warnings.push("mechanisms 为空：brief 注入时会少「机制名 + 失败边界」");
    if (/第[0-9０-９]+章/.test(text(c.emotionArc)))
        warnings.push("emotionArc 带章号：情绪走向写成了剧情梗概，应改成可迁移的情绪曲线（建立-延迟-触发-兑现-余波）");
    if (/第[0-9０-９]+章/.test(text(c.dramaticUnit)))
        warnings.push("dramaticUnit 带章号：戏剧单元应去专名、去章号，写成「谁对谁做什么」");
    const evChapters = new Set((c.evidence ?? []).map((e) => text(e?.chapter)).filter(Boolean));
    if (evChapters.size === 1 && (c.evidence ?? []).length > 1)
        warnings.push("证据全部来自同一章：机制可能只是单场景，建议补 1 条跨章证据");
    if (["book", "arc", "unit"].includes(layer) && dimension === "prose")
        warnings.push("book 层配 prose 维度：像是场景技巧写进了全书结论");
    return { errors, warnings };
}

/** 是否 v2 模块（显式 layer/dimension 或 schemaVersion 2）。 */
export function isV2Card(card) {
    return Boolean(card && (card.schemaVersion === 2 || card.layer || card.dimension));
}

/**
 * v1→v2 适配视图。下游只读这个视图；原卡不变。
 * v1 没有 layer/dimension/evidence，按 axis/kind 推断一个最保守的层与维度，
 * 并标 legacy=true；报告/审计必须显式提示「旧卡」。
 */
export function toCardView(card) {
    const c = card ?? {};
    if (isV2Card(c))
        return { ...c, legacy: false };
    const axis = text(c.axis) || (c.kind === "book" ? "mind" : "craft");
    const layer = c.kind === "book" ? "book" : axis === "mind" ? "book" : "scene";
    const dimension = axis === "mind" ? "structure" : "prose";
    const mechanisms = Array.isArray(c.mechanisms) ? c.mechanisms : [];
    return {
        ...c,
        schemaVersion: 2,
        layer,
        dimension,
        axis,
        readerWant: text(c.readerWant),
        emotionArc: text(c.emotionArc),
        dramaticUnit: text(c.dramaticUnit),
        replaceables: Array.isArray(c.replaceables) ? c.replaceables : [],
        mustNotCopy: Array.isArray(c.mustNotCopy) ? c.mustNotCopy : [],
        transfer: text(c.transfer) || text(mechanisms[0]?.rebuild),
        failWhen: text(c.failWhen) || text(mechanisms[0]?.failWhen),
        evidence: Array.isArray(c.evidence) ? c.evidence : [],
        steps: Array.isArray(c.steps) ? c.steps : [],
        bannedDiction: Array.isArray(c.bannedDiction) ? c.bannedDiction : [],
        mechanisms,
        legacy: true,
    };
}
