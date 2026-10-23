const SPEECH_PROMISE = /人声|说话|说出口|不属于[^。；\n]{0,12}话|冒出[^。；\n]{0,12}话|一句[^。；\n]{0,8}话|还没说/;
const BREATH_REVEAL = /自己的呼吸|呼吸声|是他自己的呼吸|棚里响起[^。]{0,12}呼吸|耳机里[^。]{0,12}呼吸|轨上[^。]{0,20}呼吸/;
const SPEECH_IN_BODY = /人声|说话|说出口|那[一两三四]个字|清清楚楚/;
/** Domain unit smell: reverb described with 毫米 (should be 毫秒). */
const REVERB_MM = /混响[^。！？\n]{0,24}毫米|毫米[^。！？\n]{0,24}混响/;
/** Extract round/clock tokens and key content nouns from ending text. */
export function extractEndingTokens(ending: any) {
    const text = String(ending ?? "").trim();
    if (!text)
        return [];
    const tokens = new Set();
    for (const m of text.matchAll(/\d{1,2}:\d{2}/g))
        tokens.add(m[0]);
    for (const m of text.matchAll(/零点\d{1,2}|凌晨\d{1,2}点?/g))
        tokens.add(m[0]);
    const keywords = [
        "侧窗",
        "窗框",
        "回放",
        "属性",
        "时间戳",
        "文件名",
        "鼠标",
        "显示器",
        "屏幕",
        "墙面",
        "货架",
        "雨",
        "玻璃",
        "没点开",
        "刷卡",
    ];
    for (const k of keywords) {
        if (text.includes(k))
            tokens.add(k);
    }
    // Standalone CJK nouns of length 2 from ending (light heuristic)
    const nounish = text.match(/[\u4e00-\u9fff]{2,4}/g) ?? [];
    const prefer = ["侧窗", "东墙", "窗框", "回放", "属性", "文件名", "时间戳", "鼠标", "墙面", "货架", "呼吸", "人声"];
    for (const n of nounish) {
        if (prefer.includes(n))
            tokens.add(n);
    }
    return [...tokens];
}
function quoteAround(body: string, needle: any, max: any = 48) {
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
function outlinePromiseText(outline: any, premise: any) {
    return [outline.ending, outline.beats, outline.livedScene, outline.synopsis, outline.conflict, premise ?? ""]
        .filter(Boolean)
        .join("\n");
}
/**
 * Audit body against outline promises.
 * ok=true when no warning/error findings (info-only still ok).
 */
export function auditPayoff(outline: any, body: string, opts: any = {}) {
    const findings = [];
    const text = String(body ?? "");
    const promiseBlob = outlinePromiseText(outline, opts.premise);
    const endingTokens = extractEndingTokens(outline.ending);
    const endingHits = [];
    const endingMisses = [];
    for (const tok of endingTokens) {
        // Normalize 零点四十 ↔ 00:40 soft: if token is clock, also accept Chinese forms later
        if (text.includes(String(tok)))
            endingHits.push(tok);
        else
            endingMisses.push(tok);
    }
    // Soft clock alias: 00:40 ↔ 零点四十
    const softMisses = endingMisses.filter((tok: any) => {
        const m = tok.match(/^(\d{1,2}):(\d{2})$/);
        if (!m)
            return true;
        const h = Number(m[1]);
        const min = m[2];
        const cn = `零点${Number(min)}`; // rough: only for hour 0
        if (h === 0 && (text.includes(cn) || text.includes(`零点${min}`))) {
            endingHits.push(tok);
            return false;
        }
        // also 0点40 / 凌晨0点40
        if (text.includes(`${h}点${Number(min)}`) || text.includes(`${h}:${min}`)) {
            endingHits.push(tok);
            return false;
        }
        return true;
    });
    if (endingTokens.length >= 2 && softMisses.length > Math.ceil(endingTokens.length / 2)) {
        findings.push({
            code: "ending_underdelivered",
            severity: "warning",
            message: `章末 ending 关键承诺词多数未在正文出现（缺：${softMisses.slice(0, 6).join("、")}）`,
            promise: outline.ending.slice(0, 120),
            evidence: softMisses.slice(0, 3).join("、"),
        });
    }
    else if (endingTokens.length >= 1 && softMisses.length === endingTokens.length) {
        findings.push({
            code: "ending_missing",
            severity: "warning",
            message: "章末 ending 承诺词均未在正文出现",
            promise: outline.ending.slice(0, 120),
        });
    }
    else if (endingHits.length > 0 && softMisses.length === 0) {
        findings.push({
            code: "ending_ok",
            severity: "info",
            message: `章末承诺词已兑付：${endingHits.slice(0, 8).join("、")}`,
            promise: outline.ending.slice(0, 80),
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
    const livedHooks = ["回放", "侧窗", "时间戳", "属性", "推子", "底噪"].filter((k: any) => outline.livedScene.includes(k));
    const livedMiss = livedHooks.filter((k: any) => !text.includes(k));
    if (livedHooks.length >= 2 && livedMiss.length === livedHooks.length) {
        findings.push({
            code: "lived_hooks_missing",
            severity: "warning",
            message: `livedScene 强调的器物/动作均未出现：${livedMiss.join("、")}`,
            promise: outline.livedScene.slice(0, 100),
        });
    }
    const warningCount = findings.filter((f: any) => f.severity === "warning" || f.severity === "error").length;
    return {
        ok: warningCount === 0,
        warningCount,
        findings,
        checked: {
            endingTokens,
            endingHits,
            endingMisses: softMisses,
            speechPromise,
            breathReveal,
        },
    };
}
export function formatPayoffAudit(label: string, result: any) {
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
    const lines = result.findings.map((f: any, i: number) => {
        const bits = [`${i + 1}. [${f.severity}/${f.code}] ${f.message}`];
        if (f.promise)
            bits.push(`   承诺：${f.promise}`);
        if (f.evidence)
            bits.push(`   证据：${f.evidence}`);
        return bits.join("\n");
    });
    return [...head, "", ...lines].join("\n");
}
