import { DEFAULT_ENDING_LEXICON, scoreEnding } from "./domain/ending-consistency.js";
import type { PayoffCaseLexicon } from "./storage/payoff-lexicon.js";
/**
 * ending 兑付评分阈值（统一口径，见 domain/ending-consistency.ts）：
 *   无 token 且 ending 非空 → ending_unchecked（warning；require_payoff 不再被空审计满足）
 *   强证据全 miss            → ending_missing
 *   有强证据且 score < 0.50  → ending_underdelivered（仅剩弱证据时不判，防同义改写误报）
 *   score ≥ 0.75             → ending_ok（info）
 */
const SCORE_UNDER = 0.5;
const SCORE_OK = 0.75;

export interface PayoffFinding {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  promise?: string;
  evidence?: string;
}

export interface PayoffAuditResult {
  ok: boolean;
  warningCount: number;
  findings: PayoffFinding[];
  checked: {
    endingTokens: string[];
    endingHits: string[];
    endingMisses: string[];
    endingScore: number | null;
    /** 说话类承诺是否出现在章纲；null = 作品未配词表，本检查跳过。 */
    speechPromise: boolean | null;
    /** 正文是否兑成呼吸类；null = 作品未配词表，本检查跳过。 */
    breathReveal: boolean | null;
  };
}

function quoteAround(body: string, needle: string | RegExp) {
  if (typeof needle === "string") {
    const i = body.indexOf(needle);
    if (i < 0) return undefined;
    const start = Math.max(0, i - 8);
    const end = Math.min(body.length, i + needle.length + 24);
    return body.slice(start, end).replace(/\s+/g, " ").trim();
  }
  const m = body.match(needle);
  if (!m || m.index == null) return undefined;
  const start = Math.max(0, m.index - 8);
  const end = Math.min(body.length, m.index + m[0].length + 24);
  return body.slice(start, end).replace(/\s+/g, " ").trim();
}
function outlinePromiseText(outline: Partial<import("./types.js").Outline>, premise?: string) {
  return [
    outline.ending,
    outline.beats,
    outline.livedScene,
    outline.synopsis,
    outline.conflict,
    premise ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}
function countOccurrences(text: string, words: string[]) {
  return words.reduce((n, w) => n + text.split(w).length - 1, 0);
}
function sentencesOf(text: string) {
  return text
    .split(/[。！？\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function clip(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
/**
 * 题材敏感检查（说话/呼吸漂移、单位错配、livedScene 器物）按作品词表运行；
 * 词表缺失时完全跳过，默认路径只保留通用 ending 兑付评分。
 * 词表只负责把本题材的「承诺词/兑付词」交给审计，判定仍是结构条件组合
 * （出现位置、次数对比、同句共现），不再绑定单一题材的具体写法。
 */
function caseFindings(
  caseLexicon: PayoffCaseLexicon,
  livedScene: string,
  promiseBlob: string,
  text: string,
) {
  const findings: PayoffFinding[] = [];
  const speech = caseLexicon.speech ?? [];
  const breath = caseLexicon.breath ?? [];
  let speechPromise: boolean | null = null;
  let breathReveal: boolean | null = null;
  if (speech.length && breath.length) {
    speechPromise = speech.some((w) => promiseBlob.includes(w));
    breathReveal = breath.some((w) => text.includes(w));
    const speechInBody = speech.some((w) => text.includes(w));
    const breathCount = countOccurrences(text, breath);
    const speechCount = countOccurrences(text, speech);
    if (speechPromise && breathReveal && (!speechInBody || breathCount > speechCount)) {
      findings.push({
        code: "speech_breath_drift",
        severity: "warning",
        message: "章纲/节拍承诺「说话类」钩子，正文却把轨上内容兑成「呼吸类」主导——疑似卖点换轨",
        promise: `「${speech.find((w) => promiseBlob.includes(w))}」（章纲承诺）`,
        evidence: quoteAround(text, breath.find((w) => text.includes(w)) ?? ""),
      });
    }
  }
  for (const [term, unit] of caseLexicon.units ?? []) {
    const hit = sentencesOf(text).find((s) => s.includes(term) && s.includes(unit));
    if (!hit) continue;
    findings.push({
      code: "domain_unit_mismatch",
      severity: "warning",
      message: `专业细节可疑：「${term}」与「${unit}」同句出现，请核对单位与量级`,
      evidence: clip(hit, 60),
    });
  }
  const hooks = (caseLexicon.hooks ?? []).filter((k) => livedScene.includes(k));
  const livedMiss = hooks.filter((k) => !text.includes(k));
  if (hooks.length >= 2 && livedMiss.length === hooks.length) {
    findings.push({
      code: "lived_hooks_missing",
      severity: "warning",
      message: `livedScene 强调的器物/动作均未出现：${livedMiss.join("、")}`,
      promise: livedScene.slice(0, 100),
    });
  }
  return { findings, speechPromise, breathReveal };
}
/**
 * Audit body against outline promises.
 * ok=true when no warning/error findings (info-only still ok).
 * opts.lexicon 可传 per-work 质量词表（quality-lexicon.json 的 endingKeywords）覆盖默认题材词。
 * opts.caseLexicon 可传 per-work 题材词表（payoff-lexicon.json）；缺省时跳过题材敏感检查。
 */
export function auditPayoff(
  outline: Partial<import("./types.js").Outline>,
  body: string,
  opts: { premise?: string; lexicon?: string[]; caseLexicon?: PayoffCaseLexicon } = {},
) {
  const findings: PayoffFinding[] = [];
  const text = body;
  const promiseBlob = outlinePromiseText(outline, opts.premise);
  const endingText = (outline.ending ?? "").trim();
  const lexicon =
    Array.isArray(opts.lexicon) && opts.lexicon.length ? opts.lexicon : DEFAULT_ENDING_LEXICON;
  const sc = scoreEnding(endingText, text, { lexicon });
  const hasAnchors = sc.anchorTotal > 0;
  if (sc.score === null) {
    if (endingText) {
      findings.push({
        code: "ending_unchecked",
        severity: "warning",
        message:
          "章末 ending 提不出可核对的承诺词（时钟/关键词/具体名词），本次兑付审计未真正核对——require_payoff 不应被这种空审计满足",
        promise: endingText.slice(0, 120),
      });
    }
  } else if (!hasAnchors) {
    // 无锚点（时钟/词表/引号）的通用 ending：维持旧口径静默，只用弱分供展示；
    // 过短且 vague 的 ending 提示 unchecked。可用 per-work 词表解锁严格审计。
    if (endingText.replace(/[。，、；：！？\s]/g, "").length < 6) {
      findings.push({
        code: "ending_unchecked",
        severity: "warning",
        message:
          "章末 ending 过短且无可核对的承诺词，本次兑付审计未真正核对——require_payoff 不应被这种空审计满足",
        promise: endingText.slice(0, 120),
      });
    }
  } else if (sc.anchorHits === 0) {
    findings.push({
      code: "ending_missing",
      severity: "warning",
      message: "章末 ending 强承诺词（时钟/关键词/引语）均未在正文出现",
      promise: endingText.slice(0, 120),
      evidence: sc.misses.slice(0, 6).join("、"),
    });
  } else if (!sc.weak && sc.score < SCORE_UNDER) {
    findings.push({
      code: "ending_underdelivered",
      severity: "warning",
      message: `章末 ending 承诺兑付不足（加权命中 ${(sc.score ?? 0).toFixed(2)} < ${SCORE_UNDER}；缺：${sc.misses.slice(0, 6).join("、")}）`,
      promise: endingText.slice(0, 120),
      evidence: sc.misses.slice(0, 3).join("、"),
    });
  } else if (sc.score >= SCORE_OK) {
    findings.push({
      code: "ending_ok",
      severity: "info",
      message: `章末承诺词已兑付（加权命中 ${(sc.score ?? 0).toFixed(2)}）：${sc.hits.slice(0, 8).join("、")}`,
      promise: endingText.slice(0, 80),
    });
  }
  const {
    findings: caseResults,
    speechPromise,
    breathReveal,
  } = caseFindings(opts.caseLexicon ?? {}, outline.livedScene ?? "", promiseBlob, text);
  findings.push(...caseResults);
  const warningCount = findings.filter(
    (f) => f.severity === "warning" || f.severity === "error",
  ).length;
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
export function formatPayoffAudit(label: string, result: PayoffAuditResult) {
  const caseLine =
    result.checked.speechPromise === null
      ? "- 题材敏感检查：作品未配 payoff-lexicon.json 词表，跳过（可配 speech/breath/units/hooks 解锁）"
      : `- 说话类承诺：${result.checked.speechPromise ? "是" : "否"} · 呼吸兑付：${result.checked.breathReveal ? "是" : "否"}`;
  const head = [
    `兑付审计 · ${label}`,
    `- 结论：${result.ok ? "ok（无警告）" : `warnings=${result.warningCount}`}`,
    `- ending 命中：${result.checked.endingHits.join("、") || "（无）"}`,
    `- ending 未命中：${result.checked.endingMisses.join("、") || "（无）"}`,
    caseLine,
  ];
  if (result.findings.length === 0) {
    return [...head, "", "无发现。"].join("\n");
  }
  const lines = result.findings.map((f, i: number) => {
    const bits = [`${i + 1}. [${f.severity}/${f.code}] ${f.message}`];
    if (f.promise) bits.push(`   承诺：${f.promise}`);
    if (f.evidence) bits.push(`   证据：${f.evidence}`);
    return bits.join("\n");
  });
  return [...head, "", ...lines].join("\n");
}
