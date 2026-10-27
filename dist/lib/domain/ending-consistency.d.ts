/** 0–99 的中文数字（口语时刻用：零/一/…/十/十一/二十/二十一/五十九）。 */
export declare function toCnNumber(n: number): string;
/**
 * 时钟 token 的等价写法集合（双向）：
 * "00:40" ↔ 零点四十 / 0点40 / 零点40 / 00:40；"01:07" ↔ 一点零七 / 1点07 …
 * 此前别名只生成「零点40」，正文写中文数字时永远匹配不到。
 */
export declare function clockAliases(token: string): string[];
/** 中文时刻 token（零点四十）的等价写法（含阿拉伯形式）。 */
export declare function cnClockAliases(token: string): string[];
export interface WeightedToken {
    text: string;
    weight: number;
    kind: "clock" | "lexicon" | "cjk" | "quoted" | "latin" | "bigram";
}
/**
 * payoff 兑付审计的默认关键词（题材域词；可用 per-work quality-lexicon.json
 * 覆盖 / 增补，见 loadEndingLexicon）。保留既有词表以不改变现有书的行为。
 */
export declare const DEFAULT_ENDING_LEXICON: string[];
/**
 * 从 ending 提取加权 token：
 *   clock 2.0 · lexicon 关键词 2.0 · 引号内 1.5 · latin 1.0
 *   CJK 整串 min(2, len/4)（4 字以上才算强证据）
 *   CJK bigram 0.25（只作弱兜底，不再能单独把分数抬过阈值）
 */
export declare function tokenizeEnding(ending: any, lexicon?: string[]): WeightedToken[];
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
export declare function tokenHit(token: WeightedToken, text: string): boolean;
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
export declare function scoreEnding(ending: any, text: string, opts?: {
    lexicon?: string[];
}): EndingScore;
/** 正文末拍（最后 1–2 句，至多 maxLen 字）——happened 选材与审计共用。 */
export declare function bodyTailOf(body: any, maxLen?: any): string;
/** 宽松 bigram 重叠（foundation 选 happened 用；非质量判定）。 */
export declare function significantTokens(text: string): string[];
/** 宽松重叠率（foundation 选材口径：空 ending=1，空 tail=0）。 */
export declare function endingBodyOverlap(ending: any, bodyTail: any): number;
