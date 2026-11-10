import { config } from "../runtime-config.js";
/**
 * Audit adapters — style / payoff / human-feel / novel-sense soft radars behind stable ports.
 * Sensors stay pure; this file is the only place tools should import them from
 * when wiring (gates/tests may still import sensors for unit isolation).
 */
import { lintStyle, scanStyle, scanWorkStyle, summarizeStyleLint } from "../style-linter.js";
import { auditPayoff, formatPayoffAudit } from "../payoff-audit.js";
import { auditHumanFeel, formatHumanFeelAudit } from "./human-feel-gate.js";
import { auditNovelSense, formatNovelSenseAudit } from "./novel-sense-gate.js";
export const StyleLinterPort = {
  lint(text: string) {
    return lintStyle(text);
  },
  scan(text: string, dir?: string) {
    return dir === undefined ? scanStyle(text, Infinity) : scanWorkStyle(dir, text);
  },
  format(label: string, scan: Awaited<ReturnType<typeof scanStyle>>) {
    const { hits, statistics } = scan,
      summary = summarizeStyleLint(hits);
    const head = [
      `语感雷达 · ${label}`,
      ...Object.entries(summary).map(([key, value]) => `- ${key}：${value}`),
      `- 合计：${hits.length}`,
    ];
    const details = hits.length
      ? hits
          .slice(0, 40)
          .map(
            (hit, index) =>
              `${index + 1}. [${hit.category}] 「${hit.match}」 @${hit.start}-${hit.end} · ${hit.hint}`,
          )
      : ["未发现命中（对白区已豁免）。"];
    const extra = [
      `### forge 正文体检（${statistics.overlong.length} 处，仅提示回看位置）`,
      `- ${statistics.cjkChars} 字 · ${statistics.paragraphs} 段 · 平均每段 ${statistics.average} 字`,
      ...statistics.overlong
        .slice(0, 8)
        .map(
          ([line, chars, preview]) =>
            `- 超长段（第 ${line} 行，${chars} 字，手机上难读）：${preview}`,
        ),
    ];
    if (statistics.dialogueHits)
      extra.push(`- 台词里另有 ${statistics.dialogueHits} 处套话（人物口吻，通常保留）`);
    if (!statistics.overlong.length) extra.push("- 没有超长段；套话位置见上方同次扫描结果");
    return [
      ...head,
      "",
      ...details,
      hits.length > 40 ? `…另有 ${hits.length - 40} 处` : "",
      "",
      ...extra,
    ]
      .filter(Boolean)
      .join("\n");
  },
};
export const PayoffAuditorPort = {
  audit(
    outline: Partial<import("../types.js").Outline>,
    body: string,
    opts: {
      premise?: string;
      lexicon?: string[];
      title?: string;
      caseLexicon?: import("../storage/payoff-lexicon.js").PayoffCaseLexicon;
    },
  ) {
    return auditPayoff(outline, body, {
      ...opts,
      ...(config.pursuit?.enabled === true && opts.lexicon === undefined
        ? { lexicon: [...(outline.newTerms ?? []), ...(outline.newCharacters ?? [])] }
        : {}),
    });
  },
  format(label: string, result: ReturnType<typeof auditPayoff>) {
    return formatPayoffAudit(label, result);
  },
};
export const HumanFeelAuditorPort = {
  /** Pass craftCue so stiffness_tidy matches Accept (shatter cues from craft cards). */
  audit(text: string, opts: { craftCue?: string }) {
    return auditHumanFeel(text, { ...opts, generalOnly: config.pursuit?.enabled === true });
  },
  format(label: string, result: ReturnType<typeof auditHumanFeel>) {
    return formatHumanFeelAudit(label, result);
  },
};
export const NovelSenseAuditorPort = {
  audit(text: string, opts: { prevBody?: string | null }) {
    return auditNovelSense(text, { ...opts, generalOnly: config.pursuit?.enabled === true });
  },
  format(label: string, result: ReturnType<typeof auditNovelSense>) {
    return formatNovelSenseAudit(label, result);
  },
};
