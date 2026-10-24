const SPEECH_PROMISE = /人声|说话|说出口|不属于[^。；\n]{0,12}话|冒出[^。；\n]{0,12}话|一句[^。；\n]{0,8}话|还没说/;
const BREATH_REVEAL = /自己的呼吸|呼吸声|是他自己的呼吸|棚里响起[^。]{0,12}呼吸|耳机里[^。]{0,12}呼吸|轨上[^。]{0,20}呼吸/;
const SPEECH_IN_BODY = /人声|说话|说出口|那[一两三四]个字|清清楚楚/;
/** Domain unit smell: reverb described with 毫米 (should be 毫秒). */
const REVERB_MM = /混响[^。！？\n]{0,24}毫米|毫米[^。！？\n]{0,24}混响/;
import { DEFAULT_ENDING_LEXICON, scoreEnding } from "./domain/ending-consistency.js";
/**
 * ending 兑付评分阈值（统一口径，见 domain/ending-consistency.ts）：
 *   无 token 且 ending 非空 → ending_unchecked（warning；require_payoff 不再被空审计满足）
 *   强证据全 miss            → ending_missing
 *   有强证据且 score < 0.50  → ending_underdelivered（仅剩弱证据时不判，防同义改写误报）
 *   score ≥ 0.75             → ending_ok（info）
 */
const SCORE_UNDER = 0.5;
const SCORE_OK = 0.75;
function quoteAround(body, needle, max = 48) {
    if (typeof needle === "string") {
        const i = body.indexOf(needle);
        if (i < 0)
            return undefined;
        const start = Math.max(0, i - 8);
        const end = Math.min(body.length, i + needle.length + 24);
        return body.slice(start, end).replace(/\s+/g, " ").trim();
    }
    const m = body.match(needle);
    if (!m || m.index == null)
        return undefined;
    const start = Math.max(0, m.index - 8);
    const end = Math.min(body.length, m.index + m[0].length + 24);
    return body.slice(start, end).replace(/\s+/g, " ").trim();
}
function outlinePromiseText(outline, premise) {
    return [outline.ending, outline.beats, outline.livedScene, outline.synopsis, outline.conflict, premise ?? ""]
        .filter(Boolean)
        .join("\n");
}
/**
 * Audit body against outline promises.
 * ok=true when no warning/error findings (info-only still ok).
 * opts.lexicon 可传 per-work 质量词表（quality-lexicon.json 的 endingKeywords）覆盖默认题材词。
 */
export function auditPayoff(outline, body, opts = {}) {
    const findings = [];
    const text = String(body ?? "");
    const promiseBlob = outlinePromiseText(outline, opts.premise);
    const endingText = String(outline?.ending ?? "").trim();
    const lexicon = Array.isArray(opts.lexicon) && opts.lexicon.length
        ? opts.lexicon
        : DEFAULT_ENDING_LEXICON;
    const sc = scoreEnding(endingText, text, { lexicon });
    const hasAnchors = sc.anchorTotal > 0;
    if (sc.score === null) {
        if (endingText) {
            findings.push({
                code: "ending_unchecked",
                severity: "warning",
                message: "章末 ending 提不出可核对的承诺词（时钟/关键词/具体名词），本次兑付审计未真正核对——require_payoff 不应被这种空审计满足",
                promise: endingText.slice(0, 120),
            });
        }
    }
    else if (!hasAnchors) {
        // 无锚点（时钟/词表/引号）的通用 ending：维持旧口径静默，只用弱分供展示；
        // 过短且 vague 的 ending 提示 unchecked。可用 per-work 词表解锁严格审计。
        if (endingText.replace(/[。，、；：！？\s]/g, "").length < 6) {
            findings.push({
                code: "ending_unchecked",
                severity: "warning",
                message: "章末 ending 过短且无可核对的承诺词，本次兑付审计未真正核对——require_payoff 不应被这种空审计满足",
                promise: endingText.slice(0, 120),
            });
        }
    }
    else if (sc.anchorHits === 0) {
        findings.push({
            code: "ending_missing",
            severity: "warning",
            message: "章末 ending 强承诺词（时钟/关键词/引语）均未在正文出现",
            promise: endingText.slice(0, 120),
            evidence: sc.misses.slice(0, 6).join("、"),
        });
    }
    else if (!sc.weak && sc.score < SCORE_UNDER) {
        findings.push({
            code: "ending_underdelivered",
            severity: "warning",
            message: `章末 ending 承诺兑付不足（加权命中 ${(sc.score ?? 0).toFixed(2)} < ${SCORE_UNDER}；缺：${sc.misses.slice(0, 6).join("、")}）`,
            promise: endingText.slice(0, 120),
            evidence: sc.misses.slice(0, 3).join("、"),
        });
    }
    else if (sc.score >= SCORE_OK) {
        findings.push({
            code: "ending_ok",
            severity: "info",
            message: `章末承诺词已兑付（加权命中 ${(sc.score ?? 0).toFixed(2)}）：${sc.hits.slice(0, 8).join("、")}`,
            promise: endingText.slice(0, 80),
        });
    }
    const speechPromise = SPEECH_PROMISE.test(promiseBlob);
    const breathReveal = BREATH_REVEAL.test(text);
    const speechInBody = SPEECH_IN_BODY.test(text);
    const breathCount = (text.match(/呼吸/g) ?? []).length;
    const speechCount = (text.match(/说话|人声|说出口/g) ?? []).length;
    if (speechPromise && breathReveal && (!speechInBody || breathCount > speechCount)) {
        findings.push({
            code: "speech_breath_drift",
            severity: "warning",
            message: "章纲/节拍承诺「人声/说话」类钩子，正文却把轨上内容兑成「呼吸」主导——疑似卖点换轨",
            promise: (promiseBlob.match(SPEECH_PROMISE) ?? ["（说话类承诺）"])[0],
            evidence: quoteAround(text, BREATH_REVEAL),
        });
    }
    const reverbMm = text.match(REVERB_MM);
    if (reverbMm) {
        findings.push({
            code: "domain_unit_reverb_mm",
            severity: "warning",
            message: "专业细节可疑：混响与「毫米」同现（混响时间通常为毫秒量级）",
            evidence: quoteAround(text, REVERB_MM),
        });
    }
    // livedScene hook nouns: if livedScene emphasizes 回放/侧窗 etc., soft-check presence
    const livedScene = String(outline?.livedScene ?? "");
    const livedHooks = ["回放", "侧窗", "时间戳", "属性", "推子", "底噪"].filter((k) => livedScene.includes(k));
    const livedMiss = livedHooks.filter((k) => !text.includes(k));
    if (livedHooks.length >= 2 && livedMiss.length === livedHooks.length) {
        findings.push({
            code: "lived_hooks_missing",
            severity: "warning",
            message: `livedScene 强调的器物/动作均未出现：${livedMiss.join("、")}`,
            promise: livedScene.slice(0, 100),
        });
    }
    const warningCount = findings.filter((f) => f.severity === "warning" || f.severity === "error").length;
    return {
        ok: warningCount === 0,
        warningCount,
        findings,
        checked: {
            endingTokens: [...sc.hits, ...sc.misses],
            endingHits: sc.hits,
            endingMisses: sc.misses,
            endingScore: sc.score,
            speechPromise,
            breathReveal,
        },
    };
}
export function formatPayoffAudit(label, result) {
    const head = [
        `兑付审计 · ${label}`,
        `- 结论：${result.ok ? "ok（无警告）" : `warnings=${result.warningCount}`}`,
        `- ending 命中：${result.checked.endingHits.join("、") || "（无）"}`,
        `- ending 未命中：${result.checked.endingMisses.join("、") || "（无）"}`,
        `- 说话类承诺：${result.checked.speechPromise ? "是" : "否"} · 呼吸兑付：${result.checked.breathReveal ? "是" : "否"}`,
    ];
    if (result.findings.length === 0) {
        return [...head, "", "无发现。"].join("\n");
    }
    const lines = result.findings.map((f, i) => {
        const bits = [`${i + 1}. [${f.severity}/${f.code}] ${f.message}`];
        if (f.promise)
            bits.push(`   承诺：${f.promise}`);
        if (f.evidence)
            bits.push(`   证据：${f.evidence}`);
        return bits.join("\n");
    });
    return [...head, "", ...lines].join("\n");
}
