/**
 * Ending 一致性 — 单一事实源（domain）。
 *
 * 此前「纲末 ending vs 正文」有三套互相矛盾的实现：
 *   foundation 的 bigram 重叠（选 happened 用，宽松）、
 *   payoff-audit 的关键词/时钟命中（质量判定，全文）、
 *   读者合同的 CJK 词组全 miss 才警（几乎不报）。
 * 三者对同一段输入可给出 aligned / missing / 无警告三种结论。
 *
 * 统一后的分工（都从本模块取基元）：
 *   - payoff 审计（质量判定）：scoreEnding，强证据（时钟/词表/长词）权重高，
 *     bigram 只作 0.25 弱兜底；阈值 0.30 / 0.50 / 0.75。
 *   - 读者合同（跨章提示）：scoreEnding，score < 0.25 才警并打印分值。
 *   - foundation（happened 选材）：保留宽松 bigram 重叠（选择行为，非判定）。
 */
const CJK_RUN_RE = /[\u4e00-\u9fff]{2,}/g;
const LATIN_RUN_RE = /[A-Za-z0-9]{2,}/g;
const QUOTED_RE = /[「『"']([^」』"']{1,12})[」』"']/g;
const CLOCK_RE = /\d{1,2}:\d{2}/g;
const CN_CLOCK_RE = /零点[一二三四五六七八九十]{1,3}|凌晨[一二三四五六七八九十]{1,3}点?/g;

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
/** 0–99 的中文数字（口语时刻用：零/一/…/十/十一/二十/二十一/五十九）。 */
export function toCnNumber(n: number): string {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v) || v < 0 || v > 99)
        return String(v);
    if (v < 10)
        return CN_DIGITS[v];
    if (v === 10)
        return "十";
    if (v < 20)
        return `十${CN_DIGITS[v % 10]}`;
    const tens = Math.floor(v / 10);
    const ones = v % 10;
    return ones === 0 ? `${CN_DIGITS[tens]}十` : `${CN_DIGITS[tens]}十${CN_DIGITS[ones]}`;
}
/**
 * 时钟 token 的等价写法集合（双向）：
 * "00:40" ↔ 零点四十 / 0点40 / 零点40 / 00:40；"01:07" ↔ 一点零七 / 1点07 …
 * 此前别名只生成「零点40」，正文写中文数字时永远匹配不到。
 */
export function clockAliases(token: string): string[] {
    const out = [token];
    const m = token.match(/^(\d{1,2}):(\d{2})$/);
    if (!m)
        return out;
    const h = Number(m[1]);
    const min = Number(m[2]);
    const cnH = toCnNumber(h);
    const cnMin = toCnNumber(min);
    out.push(`${cnH}点${cnMin}`, `零点${cnMin}`);
    out.push(`${h}点${min}`, `${h}点${cnMin}`);
    if (min % 10 === 0 && min > 0) {
        // 「四十」也可写作「四零」的口语变体较少见，但「X点整」常见
        out.push(`${cnH}点整`);
    }
    return [...new Set(out)];
}
/** 中文时刻 token（零点四十）的等价写法（含阿拉伯形式）。 */
export function cnClockAliases(token: string): string[] {
    const m = token.match(/^(?:零点|凌晨)?([一二三四五六七八九十]{1,3})点?(?:([一二三四五六七八九十]{1,3}))?$/);
    const out = [token];
    if (!m)
        return out;
    const cnToNum = (s: string | undefined): number => {
        if (!s)
            return NaN;
        if (s === "十")
            return 10;
        if (s.startsWith("十"))
            return 10 + CN_DIGITS.indexOf(s.slice(1));
        if (s.endsWith("十"))
            return 10 * (CN_DIGITS.indexOf(s[0]) + 0 || 0) || 10;
        if (s.includes("十")) {
            const [a, b] = s.split("十");
            return Number(CN_DIGITS.indexOf(a) + 1) * 10 + CN_DIGITS.indexOf(b);
        }
        return CN_DIGITS.indexOf(s);
    };
    const h = cnToNum(m[1]);
    const min = m[2] ? cnToNum(m[2]) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(min))
        return out;
    const pad = (x: number) => String(x).padStart(2, "0");
    out.push(`${pad(h)}:${pad(min)}`, `${h}点${min}`);
    return [...new Set(out)];
}

export interface WeightedToken {
    text: string;
    weight: number;
    kind: "clock" | "lexicon" | "cjk" | "quoted" | "latin" | "bigram";
}
/**
 * payoff 兑付审计的默认关键词（题材域词；可用 per-work quality-lexicon.json
 * 覆盖 / 增补，见 loadEndingLexicon）。保留既有词表以不改变现有书的行为。
 */
export const DEFAULT_ENDING_LEXICON = [
    "侧窗", "窗框", "回放", "属性", "时间戳", "文件名", "鼠标", "显示器", "屏幕",
    "墙面", "货架", "雨", "玻璃", "没点开", "刷卡", "东墙", "呼吸", "人声",
];
/**
 * 从 ending 提取加权 token：
 *   clock 2.0 · lexicon 关键词 2.0 · 引号内 1.5 · latin 1.0
 *   CJK 整串 min(2, len/4)（4 字以上才算强证据）
 *   CJK bigram 0.25（只作弱兜底，不再能单独把分数抬过阈值）
 */
export function tokenizeEnding(ending: any, lexicon: string[] = DEFAULT_ENDING_LEXICON): WeightedToken[] {
    const t = String(ending ?? "").trim();
    if (!t)
        return [];
    const byText = new Map<string, WeightedToken>();
    const put = (text: string, weight: number, kind: WeightedToken["kind"]) => {
        const prev = byText.get(text);
        if (!prev || prev.weight < weight)
            byText.set(text, { text, weight, kind });
    };
    for (const m of t.matchAll(CLOCK_RE))
        put(m[0], 2.0, "clock");
    for (const m of t.matchAll(CN_CLOCK_RE))
        put(m[0], 2.0, "clock");
    for (const k of lexicon) {
        if (k && t.includes(k))
            put(k, 2.0, "lexicon");
    }
    for (const m of t.matchAll(QUOTED_RE)) {
        const inner = m[1].trim();
        if (inner)
            put(inner, 1.5, "quoted");
    }
    for (const m of t.matchAll(CJK_RUN_RE)) {
        const w = m[0];
        put(w, Math.min(2, w.length / 4), "cjk");
        for (let i = 0; i + 2 <= w.length; i += 1)
            put(w.slice(i, i + 2), 0.25, "bigram");
    }
    for (const m of t.matchAll(LATIN_RUN_RE))
        put(m[0], 1.0, "latin");
    return [...byText.values()];
}
export interface EndingScore {
    /** 加权命中率 0–1；ending 无任何 token 时为 null（调用方按 unchecked 处理）。 */
    score: number | null;
    hits: string[];
    misses: string[];
    /** 强证据（锚点 + ≥4字 cjk）命中数与总数。 */
    strongHits: number;
    strongTotal: number;
    /** 锚点（时钟/词表/引号——可逐字核对的承诺）命中数与总数。 */
    anchorHits: number;
    anchorTotal: number;
    /** true = 只有弱证据（bigram 兜底口径），判定时应更保守。 */
    weak: boolean;
}
/** token 在正文中的命中（含时钟双向别名软匹配）。 */
export function tokenHit(token: WeightedToken, text: string): boolean {
    if (text.includes(token.text))
        return true;
    if (token.kind === "clock") {
        const aliases = CLOCK_RE.test(token.text) ? clockAliases(token.text) : cnClockAliases(token.text);
        CLOCK_RE.lastIndex = 0;
        return aliases.some((a) => a && a !== token.text && text.includes(a));
    }
    return false;
}
function isStrong(tok: WeightedToken) {
    return (tok.kind === "clock" ||
        tok.kind === "lexicon" ||
        tok.kind === "quoted" ||
        (tok.kind === "cjk" && tok.weight >= 1));
}
function isAnchor(tok: WeightedToken) {
    return tok.kind === "clock" || tok.kind === "lexicon" || tok.kind === "quoted";
}
/**
 * 统一评分：score = 命中权重 / 总权重。payoff（质量判定）与读者合同
 * （跨章提示）共用本函数，只差阈值；保证两处结论不再互相矛盾。
 *
 * 有强证据（锚点/≥4 字名词，合计权重 ≥1）时只按强证据评分：bigram 的未
 * 命中不许把强证据的兑付分拖下水（同义改写正常书里大量存在）；无强证据
 * 时退回 bigram 弱口径并标 weak。
 *
 * 「锚点」（时钟/词表/引号）单独计数：只有锚点是可逐字核对的承诺——
 * 判定性 finding（missing/underdelivered）应由锚点驱动；无锚点的通用
 * ending 维持静默（旧口径），可用 per-work 词表解锁严格审计。
 */
export function scoreEnding(ending: any, text: string, opts: { lexicon?: string[] } = {}): EndingScore {
    const tokens = tokenizeEnding(ending, opts.lexicon);
    if (tokens.length === 0)
        return { score: null, hits: [], misses: [], strongHits: 0, strongTotal: 0, anchorHits: 0, anchorTotal: 0, weak: true };
    const body = String(text ?? "");
    const anchorTotal = tokens.filter((t) => isAnchor(t)).length;
    // 有锚点时强证据只算锚点：长句整串通常只是把锚点重说一遍，重复计入
    // 会把锚点已兑付的正文误压到 0.5 以下。无锚点才用 ≥4 字整串当强证据。
    const strongIsAnchor = anchorTotal > 0;
    let strongTotalW = 0;
    let strongHitW = 0;
    let weakTotalW = 0;
    let weakHitW = 0;
    const hits = [];
    const misses = [];
    let strongTotal = 0;
    let strongHits = 0;
    let anchorHits = 0;
    for (const tok of tokens) {
        const hit = tokenHit(tok, body);
        if (hit)
            hits.push(tok.text);
        else
            misses.push(tok.text);
        const strong = strongIsAnchor ? isAnchor(tok) : isStrong(tok);
        if (strong) {
            strongTotal += 1;
            strongTotalW += tok.weight;
            if (hit) {
                strongHitW += tok.weight;
                strongHits += 1;
            }
        }
        else {
            weakTotalW += tok.weight;
            if (hit)
                weakHitW += tok.weight;
        }
        if (isAnchor(tok) && hit)
            anchorHits += 1;
    }
    const score = strongTotalW >= 1
        ? strongHitW / strongTotalW
        : weakTotalW > 0
            ? weakHitW / weakTotalW
            : null;
    return { score, hits, misses, strongHits, strongTotal, anchorHits, anchorTotal, weak: strongTotalW < 1 };
}
/** 正文末拍（最后 1–2 句，至多 maxLen 字）——happened 选材与审计共用。 */
export function bodyTailOf(body: any, maxLen: any = 120) {
    const raw = String(body ?? "").trim().replace(/\s+/g, " ");
    if (!raw)
        return "";
    const slice = raw.length > maxLen * 2 ? raw.slice(-(maxLen * 2)) : raw;
    const parts = slice
        .split(/(?<=[。！？])|(?<=…)|(?<=……)/)
        .map((s: string) => s.trim())
        .filter(Boolean);
    let picked = "";
    if (parts.length === 0)
        picked = slice;
    else if (parts.length === 1)
        picked = parts[0];
    else
        picked = `${parts[parts.length - 2]} ${parts[parts.length - 1]}`.trim();
    if (picked.length > maxLen)
        picked = `${picked.slice(-maxLen).trim()}`;
    return picked;
}
/** 宽松 bigram 重叠（foundation 选 happened 用；非质量判定）。 */
export function significantTokens(text: string): string[] {
    const t = String(text ?? "").trim();
    if (!t)
        return [];
    const out = [];
    const cjk = t.match(CJK_RUN_RE) ?? [];
    for (const w of cjk) {
        out.push(w);
        for (let i = 0; i + 2 <= w.length; i += 1)
            out.push(w.slice(i, i + 2));
    }
    out.push(...(t.match(LATIN_RUN_RE) ?? []));
    for (const q of t.match(QUOTED_RE) ?? []) {
        const inner = q.slice(1, -1).trim();
        if (inner.length >= 1)
            out.push(inner);
    }
    return [...new Set(out.filter((x: any) => x.length >= 1))];
}
/** 宽松重叠率（foundation 选材口径：空 ending=1，空 tail=0）。 */
export function endingBodyOverlap(ending: any, bodyTail: any) {
    const tokens = significantTokens(ending);
    if (tokens.length === 0)
        return 1;
    const hay = String(bodyTail ?? "");
    if (!hay.trim())
        return 0;
    let hit = 0;
    for (const tok of tokens) {
        if (hay.includes(tok))
            hit += 1;
    }
    return hit / tokens.length;
}
