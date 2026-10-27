export declare const QUALITY_AXES: {
    id: string;
    title: string;
    craft: string;
    sensor: string;
}[];
/**
 * Single poison policy — used by dissect / forge / reader contract / novel_sense tip.
 * Positive craft framing (what TO write); sensors still catch dump patterns in code.
 */
export declare const QUALITY_POISON_POLICY = "\u8D28\u91CF\u5199\u6CD5\uFF1A\u7EC6\u8282\u4E0E\u4EE3\u4EF7\u5D4C\u8FDB\u52A8\u4F5C\u4E0E\u5F53\u573A\u538B\u529B\uFF1B\u987F\u53F7\u591A\u4EF6\u6536\u83B7\u5199\u6210\u5E26\u963B\u529B\u7684\u573A\u9762\uFF1B\u8D26\u4E0E\u6570\u5B57\u53EA\u5F53\u8FD9\u4E00\u523B\u7684\u538B\u529B\u7EBF\u7D22\uFF1B\u751F\u6D3B\u7410\u4E8B\u7559\u4E00\u4EF6\u6709\u620F\u7684\uFF1B\u7269\u4EF6\u968F\u573A\u9762\u81EA\u7136\u5E26\u7740\u3002";
/** One-line variant for compact contract headers. */
export declare const QUALITY_POISON_HINT = "\u5199\u6CD5\u63D0\u9192\uFF1A\u7EC6\u8282\u5D4C\u8FDB\u52A8\u4F5C\u4E0E\u5F53\u573A\u538B\u529B\uFF1B\u8D26\u4E0E\u6570\u5B57\u5F53\u538B\u529B\u7EBF\u7D22\uFF1B\u7269\u4EF6\u81EA\u7136\u5E26\u7740\u5373\u53EF\u3002";
/**
 * Book-debt / open-stake cues for NovelSense ending checks.
 * Situational openers only — deliberately EXCLUDES ledger-inventory words
 * (账本/账页/对账单/差额/账还) so «book debt» does not reward 对账流水毒点.
 */
export declare const QUALITY_BOOK_DEBT_CUE_RE: RegExp;
/** Living-person wobble shared by soft radars (optional import). */
export declare const QUALITY_WOBBLE_RE: RegExp;
/** 拆书验收五条：脚本核不了，只能真读原文回答。 */
export declare const CARD_JUDGMENT_CRITERIA: string[];
export declare const CARD_JUDGMENT_LINE = "\u62C6\u4E66\u9A8C\u6536\uFF1A\u5F15\u6587 100% \u2260 \u5361\u80FD\u7528\uFF1B\u5B57\u6BB5\u9F50 \u2260 \u62C6\u5B8C\u4E86\u3002\u811A\u672C\u53EA\u6838\u5DF2\u58F0\u660E\u5B57\u6BB5\u4E0E\u5B57\u9762\u5F15\u6587\uFF0C\u4E0D\u80FD\u8BC1\u660E\u89E3\u91CA\u6216\u9605\u8BFB\u6DF1\u5EA6\uFF1B\u80FD\u4E0D\u80FD\u7528\u8981\u771F\u8BFB\u539F\u6587\u6309\u4E94\u6761\u5224\uFF1A\u53EF\u64CD\u4F5C / \u7279\u5F02\u6027\uFF08\u6362\u4E66\u540D\u8FD8\u6210\u7ACB=\u6CA1\u6293\u5230\u672C\u4E66\uFF09/ \u975E\u6897\u6982 / \u72B6\u6001\u843D\u7EB8 / \u5931\u8D25\u8FB9\u754C\u5177\u4F53\u3002";
export declare const QualityPolicy: {
    id: string;
    axes: {
        id: string;
        title: string;
        craft: string;
        sensor: string;
    }[];
    poisonPolicy: string;
    poisonHint: string;
    bookDebtCue: RegExp;
    wobble: RegExp;
    /** Compact line for reader contract / brief engineering. */
    cardJudgmentLine(): string;
    cardJudgmentBlock(): string;
    surfaceLine(): string;
    poisonPolicyLine(): string;
    poisonHintLine(): string;
    formatAxesForAgent(): string;
};
