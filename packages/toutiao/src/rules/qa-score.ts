/**
 * 头条六维质检评分引擎（纯 TypeScript 实现，对齐 qa_check.py 4.0.0）。
 */
import {
  AI_WORDS,
  ALONG_CAP,
  ALONG_PEN,
  BILL_RE,
  BUZZ_WORDS,
  CONVERT_RE,
  DEFAULT_LINE,
  DRIVERS,
  EMPTY_END,
  HUMAN_MARKERS,
  IDENTITY_LEAK,
  INTERACT,
  LONG_BUDGET_SCALE,
  LOW_NUMBER_DRIVERS,
  MODE_ALIAS,
  NUM_RE,
  NUM_T,
  NUMBER_CREDIT_FLOOR,
  OPEN_TPL,
  PARTICLE_RE,
  PASS_LINE,
  PASS_SCORE,
  PRONOUN_STRIP,
  RULES_VERSION,
  SAMPLE_NAMES,
  STRUCTURE_BASE,
  T1_PATTERNS,
  T2_WORDS,
  TITLE_MAX,
  WEIGHTS,
} from "./constants.js";
import { evaluateCompliance } from "./qa-compliance.js";
import {
  clamp,
  cnLen,
  countMatches,
  countStr,
  punctIssues,
  splitSents,
  titleScore,
} from "./qa-parse.js";

export interface QaItem {
  key: string;
  score: number;
  status: "pass" | "warn" | "fail";
  note: string;
}

export interface QaReport {
  version: string;
  overall: number;
  passed: boolean;
  chars: number;
  mode: string;
  line: string;
  hard_gates: string[];
  extension: { start: string; main_chars: number; ext_chars: number; overlap: number } | null;
  budget: Record<string, unknown> | null;
  items: QaItem[];
  ai_traces: Array<[string, number]>;
  t1: string[];
  t2: string[];
  risk_flags: string[];
  hints: string[];
  verdict: string;
  title: string;
  title_len: number;
  homogeneity?: { samples: number; checks: Array<["warn" | "note", string]> };
  card_checks?: Array<["fail" | "warn", string]>;
}

const LOW_NUMBER_DRIVER_SET = new Set<string>(LOW_NUMBER_DRIVERS);

export function analyzeManuscript(input: {
  title: string;
  headings: string[];
  paras: string[];
  images: number;
  mode?: string;
  driver?: string;
  extStart?: string;
  hpos?: Array<[string, number]>;
  line?: string;
  names?: readonly string[];
  bold?: number;
}): QaReport {
  const mode = input.mode ? (MODE_ALIAS[input.mode] ?? input.mode) : undefined;
  const micro = mode === "micro";
  const story = input.driver === "故事型" || input.line === "故事线";
  const { title, headings, paras, images } = input;
  const text = paras.join("\n");
  const scan = [title, ...headings, text].join("\n");
  const chars = text.replace(/\s/g, "").length;
  const sents = splitSents(text);
  const lens = sents.map(cnLen);
  const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const variance = lens.length
    ? Math.sqrt(lens.reduce((sum, x) => sum + (x - avg) ** 2, 0) / lens.length)
    : 0;

  const unfilled = [...scan.matchAll(/\{[^{}\n]{1,10}\}/g)].map((m) => m[0]).slice(0, 5);
  const pronounMix = paras.filter((p) => {
    const cleaned = p.replace(PRONOUN_STRIP, "");
    return cleaned.includes("他") && cleaned.includes("她");
  }).length;
  const longSents = sents.filter((s) => cnLen(s) >= 6);
  const seen = new Map<string, number>();
  for (const s of longSents) seen.set(s, (seen.get(s) ?? 0) + 1);
  const dup = [...seen.values()].filter((v) => v > 1).length;
  const near = new Map<string, number>();
  for (const s of longSents) {
    const k = s.replace(/[^\u4e00-\u9fa5]/g, "").slice(0, 12);
    if (k.length >= 8) near.set(k, (near.get(k) ?? 0) + 1);
  }
  const nearDup = [...near.values()].reduce((acc, v) => acc + (v > 1 ? v - 1 : 0), 0);
  const first2 = paras.map((p) => p.slice(0, 2));
  let opener = 0;
  for (let i = 1; i < first2.length; i += 1) if (first2[i] === first2[i - 1]) opener += 1;
  const leakHits = IDENTITY_LEAK.map((w): [string, number] => [w, countStr(scan, w)]).filter(
    ([, c]) => c > 0,
  );
  const leak = leakHits.reduce((s, [, c]) => s + c, 0);
  const buzz = BUZZ_WORDS.reduce((s, w) => s + countStr(scan, w), 0);
  const openTpl = countMatches(scan, OPEN_TPL);
  const emptyEnd = countMatches(scan, EMPTY_END);
  const ladder = countMatches(text, "不仅[^。，\\n]{2,20}，而且");
  const seesaw = countMatches(text, "一方面[\\s\\S]{0,40}另一方面");
  const nAlong = countStr(scan, "随着");
  const along = Math.min(ALONG_CAP, nAlong * ALONG_PEN);
  const plenRaw = paras.map((p) => p.length).filter((n) => n > 12);
  let uniformPen = 0;
  if (plenRaw.length >= 3) {
    const pmean = plenRaw.reduce((a, b) => a + b, 0) / plenRaw.length;
    const pcv = pmean
      ? Math.sqrt(plenRaw.reduce((s, x) => s + (x - pmean) ** 2, 0) / plenRaw.length) / pmean
      : 0;
    uniformPen = Math.max(0, Math.round((0.35 - Math.min(pcv, 0.35)) * 60));
  }
  const hookLen = paras[0]?.length ?? 0;
  const longPara = paras.filter((p) => p.length > 150).length;

  // 1. AI 味
  const traces = AI_WORDS.map((w): [string, number] => [w, countStr(scan, w)])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);
  const hits = traces.reduce((s, [, c]) => s + c, 0);
  let parallel = 0;
  for (let i = 0; i < sents.length - 2; i += 1) {
    const a = sents[i].slice(0, 2);
    if (a && a === sents[i + 1].slice(0, 2) && a === sents[i + 2].slice(0, 2)) parallel += 1;
  }
  const listing = /(^|[。\n])(第[一二三四][，、]|一是|首先)/.test(text) ? 1 : 0;
  const markers =
    HUMAN_MARKERS.reduce((s, m) => s + countStr(text, m), 0) + countMatches(text, PARTICLE_RE);
  const t1Found: string[] = [];
  let t1Pen = 0;
  for (const [pat, label] of T1_PATTERNS) {
    const n = countMatches(text, pat);
    if (n > 0) {
      t1Found.push(`${label}×${n}`);
      t1Pen += n * 3;
    }
  }
  t1Pen = Math.min(12, t1Pen);
  const t2Found: string[] = [];
  let t2Pen = 0;
  for (const w of T2_WORDS) {
    const cluster = paras.filter((p) => countStr(p, w) >= 2).length;
    if (cluster > 0) {
      t2Found.push(`${w}×${cluster}段`);
      t2Pen += cluster * 4;
    }
  }
  let ai =
    78 -
    hits * 7 -
    parallel * 9 -
    pronounMix * 3 -
    dup * 6 -
    listing * 6 -
    t1Pen -
    t2Pen -
    leak * 25 -
    (buzz * 4 + openTpl * 8 + emptyEnd * 7 + ladder * 3 + seesaw * 6 + uniformPen + along);
  if (hookLen > 100) ai -= 5;
  if (longPara) ai -= 5;
  ai += Math.min(11, variance) + Math.min(9, markers * 0.5);
  if (unfilled.length) ai -= 45;
  ai = clamp(ai);

  // 2. 可读性
  const plens = paras.map((p) => splitSents(p).length);
  const good = plens.filter((n) => n >= 1 && n <= 6).length / Math.max(1, plens.length);
  const breaths = countMatches(text, /—{1,2}|…{1,2}/g);
  const rd = clamp(
    58 +
      (avg >= 16 && avg <= 32 ? 22 : avg < 16 ? 8 : -6) +
      good * 12 +
      Math.min(6, breaths * 1.5) -
      opener * 5,
  );

  // 3. 标题力
  const hookLine = paras[0] ? (splitSents(paras[0])[0] ?? "") : "";
  const effectiveTitle = micro ? hookLine : title;
  const hl = titleScore(effectiveTitle, micro, input.names ?? []);
  const titleTooLong = !micro && title.length > TITLE_MAX;

  // 4. 细节密度
  const digits = countMatches(text, "\\d+(?:\\.\\d+)?");
  const cnNums = countMatches(
    text,
    "[一两二三四五六七八九十百千万亿]+(?=[块元趟次年月天岁张条])|[三四五六七八九]十[几多]?",
  );
  const quotes = countMatches(text, "[““‘]");
  const per1k = (digits + cnNums) / Math.max(0.3, chars / 1000);
  const denseParas = paras.filter((p) => countMatches(p, NUM_RE) >= 4).length;
  const billPer1k = countMatches(text, BILL_RE) / Math.max(0.3, chars / 1000);
  const billPen = Math.round(
    Math.min(18, Math.max(0, per1k - 15) * 1.2) +
      Math.min(12, Math.max(0, denseParas - 2) * 4) +
      Math.min(12, Math.max(0, billPer1k - 4) * 3),
  );
  const nNumbers = digits + cnNums;
  const nConvert = countMatches(text, CONVERT_RE);
  let budget: Record<string, unknown> | null = null;
  let driverPen = 0;
  if (input.driver && Object.hasOwn(DRIVERS, input.driver)) {
    const b = DRIVERS[input.driver];
    const nMax = mode === "long" ? Math.round(b.numbers * LONG_BUDGET_SCALE) : b.numbers;
    const overN = Math.max(0, nNumbers - nMax);
    const overC = Math.max(0, nConvert - b.convert);
    const overD = Math.max(0, denseParas - b.dense);
    driverPen = Math.min(12, overN * 3) + overC * 4 + overD * 3;
    budget = {
      driver: input.driver,
      numbers: nNumbers,
      numbers_max: nMax,
      convert: nConvert,
      convert_max: b.convert,
      dense_paras: denseParas,
      dense_max: b.dense,
      penalty: driverPen,
    };
  }
  let numCredit = Math.min(18, per1k * 3);
  if (input.driver && LOW_NUMBER_DRIVER_SET.has(input.driver)) {
    numCredit = Math.max(numCredit, NUMBER_CREDIT_FLOOR);
  }
  const dt = clamp(
    50 +
      numCredit +
      Math.min(14, quotes * 2.8) -
      billPen -
      driverPen -
      dup * 9 -
      nearDup * 5 -
      (unfilled.length ? 40 : 0),
  );

  // 5. 结构
  const lastSents = paras.length ? splitSents(paras[paras.length - 1]).length : 9;
  const hasInteract = new RegExp(INTERACT).test(text);
  let st = micro
    ? 40 +
      Math.min(12, images * 4) +
      (hasInteract ? 6 : 0) +
      (lastSents >= 1 && lastSents <= 3 ? 6 : 0) +
      (quotes >= 1 ? 4 : 0) +
      (paras.length >= 4 ? 14 : 0) +
      (chars >= 300 && chars <= 1000 ? 18 : chars >= 150 && chars <= 1500 ? 8 : -10)
    : STRUCTURE_BASE +
      Math.min(24, headings.length * 8) +
      Math.min(12, images * 3) +
      (hasInteract ? 6 : 0) +
      (lastSents >= 1 && lastSents <= 3 ? 6 : 0) +
      (quotes >= 3 ? 4 : 0) +
      (chars >= 1400 ? 14 : chars >= 1100 ? 12 : chars >= 900 ? 3 : -14);
  const endHasNum = paras.length > 0 && new RegExp(NUM_RE).test(paras[paras.length - 1]);
  if (endHasNum) st -= 4;
  if (unfilled.length) st -= 30;
  st = clamp(st);

  // 6. 合规
  const complianceRes = evaluateCompliance({
    scan,
    title,
    paras,
    chars,
    mode,
    micro,
    story,
    extStart: input.extStart,
    hpos: input.hpos,
    hasInteract,
    unfilled,
    leak,
    leakHits,
    nearDup,
    dup,
    pronounMix,
    endHasNum,
    driver: input.driver,
    budget,
    driverPen,
    titleTooLong,
  });
  const cp = complianceRes.score;
  const risk = complianceRes.risk;
  const extInfo = complianceRes.extension;
  const extGate = complianceRes.extGate;

  const hints: string[] = [];
  const usedSamples = SAMPLE_NAMES.filter((n) => scan.includes(n));
  if (usedSamples.length) {
    hints.push(
      `沿用了技能示例人名“${usedSamples.slice(0, 3).join("、")}”：同账号篇篇同名会撞脸，建议给本篇的人另起名字`,
    );
  }
  if (t1Found.length) hints.push(`句式信号只是线索，读着顺就留：${t1Found.join("、")}`);

  const scores: Record<string, number> = {
    ai,
    read: rd,
    title: hl,
    detail: dt,
    structure: st,
    compliance: cp,
  };
  const overall = clamp(Object.keys(WEIGHTS).reduce((acc, k) => acc + scores[k] * WEIGHTS[k], 0));
  const mk = (key: string, note: string): QaItem => {
    const score = scores[key];
    const passLine = PASS_LINE[key];
    const status = score >= passLine ? "pass" : score >= passLine - 10 ? "warn" : "fail";
    return { key, score, status, note };
  };
  const items: QaItem[] = [
    mk(
      "ai",
      `机器腔${hits}处（${
        traces
          .slice(0, 3)
          .map(([w]) => w)
          .join("、") || "零命中"
      }）` +
        (t1Found.length ? ` · 句式信号[${t1Found.slice(0, 3).join("、")}]` : "") +
        (t2Found.length ? ` · 聚集[${t2Found.slice(0, 3).join("、")}]` : "") +
        ` · 句长方差${variance.toFixed(1)} · 口语标记${markers}处` +
        (pronounMix ? ` · 人称错位${pronounMix}段` : "") +
        (leak ? ` · 身份泄漏${leak}处` : "") +
        (buzz ? ` · 黑话${buzz}处` : "") +
        (openTpl ? ` · 万能开头${openTpl}处` : "") +
        (emptyEnd ? ` · 空洞收尾${emptyEnd}处` : "") +
        (nAlong ? ` · 裸“随着”${nAlong}处(中性词,仅提示)` : "") +
        (uniformPen ? ` · 段长均匀(机器排版)${uniformPen}` : "") +
        (hookLen > 100 ? ` · 首段${hookLen}字` : "") +
        (longPara ? ` · 超长段${longPara}个` : ""),
    ),
    mk("read", `平均句长${avg.toFixed(1)}字 · 段首重复${opener}处 · 破折号/省略号${breaths}处`),
    mk(
      "title",
      (micro ? `首句${effectiveTitle.length}字` : `${effectiveTitle.length}字`) +
        (new RegExp(NUM_T).test(effectiveTitle) ? "" : "，无数字（非必需）") +
        (titleTooLong ? `，超 ${TITLE_MAX} 字硬上限` : ""),
    ),
    mk(
      "detail",
      `每千字${per1k.toFixed(1)}个具体数值 · 直接引语${quotes}处` +
        (billPen
          ? ` · 账单味-${billPen}（数字堆段${denseParas}段 · 算账词每千字${billPer1k.toFixed(1)}）`
          : "") +
        (driverPen ? ` · ${input.driver}预算-${driverPen}` : "") +
        (unfilled.length ? ` · 占位符残留${unfilled.length}` : ""),
    ),
    mk(
      "structure",
      (micro ? `${paras.length}段 · ${images}图` : `${headings.length}个小节`) +
        ` · 全文${chars}字`,
    ),
    mk("compliance", risk.length ? risk.slice(0, 2).join("；") : "未命中违禁词与绝对化用语"),
  ];

  const titleNums = micro ? [] : [...title.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
  const missingNums = titleNums.filter((n) => !text.includes(n));
  const first5 = paras.slice(0, 5).join("\n");
  const lateNums = titleNums.filter((n) => text.includes(n) && !first5.includes(n));
  if (missingNums.length) risk.push(`标题里的数字 ${missingNums.join("、")} 正文没有出现`);
  if (lateNums.length)
    hints.push(`标题数字 ${lateNums.join("、")} 到第 5 段以后才出现，读者点进来要尽快接住`);

  const punct = punctIssues([title, ...headings, ...paras]);
  if (input.bold) {
    punct.push([
      "Markdown 加粗",
      "头条编辑器不认 **，粘进去会原样露出；要强调就在编辑器里加粗",
      `${input.bold}处 **…**`,
    ]);
  }
  for (const [label, fix, sample] of punct.slice(0, 6)) {
    risk.push(`非规范标点·${label}：在“${sample}”处（${fix}）`);
  }

  const hardGates: string[] = [];
  if (punct.length) hardGates.push("非规范标点");
  if (missingNums.length) hardGates.push("标题数字正文没接住");
  if (unfilled.length) hardGates.push("未替换占位符");
  if (titleTooLong) hardGates.push(`标题超${TITLE_MAX}字`);
  if (leak) hardGates.push("AI身份泄漏");
  if (extGate) hardGates.push("延伸节重复主稿");

  const passed =
    overall >= PASS_SCORE && !items.some((i) => i.status === "fail") && hardGates.length === 0;
  const bad = items
    .filter((i) => i.status !== "pass")
    .map((i) => `${i.key}${i.score}分`)
    .join("；");
  const verdict = passed
    ? `综合${overall}分，过线，转人工验收。${hits ? `还有${hits}处机器腔，建议再顺一遍。` : ""}`
    : `综合${overall}分，打回。${hardGates.length ? `触发硬闸：${hardGates.join("、")}。` : ""}${bad ? `${bad}。` : ""}回 S5 改具体句子和节奏，不要只换词、不要堆数字凑分。`;

  return {
    version: RULES_VERSION,
    overall,
    passed,
    chars,
    mode: mode ?? "auto",
    line: input.line ?? (input.driver === "故事型" ? "故事线" : DEFAULT_LINE),
    hard_gates: hardGates,
    extension: extInfo,
    budget,
    items,
    ai_traces: traces.slice(0, 8),
    t1: t1Found,
    t2: t2Found,
    risk_flags: risk,
    hints,
    verdict,
    title: effectiveTitle,
    title_len: effectiveTitle.length,
  };
}
