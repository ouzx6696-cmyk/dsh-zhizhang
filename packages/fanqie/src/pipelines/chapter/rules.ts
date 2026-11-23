import { AppError } from "@zhizhang/core/errors";
import { parseJson } from "@zhizhang/core/schema";
import type { PreviousTextMode } from "../../context/builder.js";
import { DraftJsonSchema, type DraftOutput, type GateReport, type ReviewIssue } from "./schemas.js";

const PLACEHOLDER_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "TODO", pattern: /\bTODO\b/i },
  { label: "TBD", pattern: /\bTBD\b/i },
  { label: "XXX", pattern: /\bXXX\b/ },
  { label: "待补占位", pattern: /【待[^】]{0,20}】|\[待[^\]]{0,20}\]/ },
  { label: "待续占位", pattern: /（待补|待写|待完善|略写）/ },
];

const FORBIDDEN_HIT_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "终止符泄漏", pattern: /<<<END>>>/ },
  { label: "AI自述", pattern: /作为(?:一个)?(?:AI|人工智能|语言模型)/ },
  { label: "元提示泄漏", pattern: /^(?:以下是(?:修改后的)?正文|好的，为您)/m },
  { label: "未命名章号", pattern: /^第[X\?]+章/m },
];

export function draftCountForGrade(
  grade: "economy" | "standard" | "premium",
  golden: boolean,
): number {
  if (grade === "economy") return 1;
  if (grade === "standard") return golden ? 5 : 2;
  return golden ? 8 : 3;
}

/**
 * 按档位与作品设置解析前文截断策略（D6）：
 * - full：全文上限 6000 字
 * - tail：末尾 1800 字
 * - auto：经济档末尾 1500 字（配交接卡）；标准/精品档全文上限 4000 字
 */
export function resolvePreviousTextMode(
  setting: "auto" | "full" | "tail",
  grade: "economy" | "standard" | "premium",
): PreviousTextMode {
  if (setting === "full") return { kind: "full", maxChars: 6000 };
  if (setting === "tail") return { kind: "tail", chars: 1800 };
  return grade === "economy" ? { kind: "tail", chars: 1500 } : { kind: "full", maxChars: 4000 };
}

export function countChineseWords(text: string): number {
  return text.replace(/\s+/g, "").length;
}

export function parsePlainDraft(raw: string): DraftOutput {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      return parseJson(trimmed, DraftJsonSchema, "draft");
    } catch {
      // Fall through to plain text parsing
    }
  }
  const endIdx = raw.indexOf("<<<END>>>");
  if (endIdx === -1) {
    throw new AppError("model.output_invalid", "起稿输出缺少 <<<END>>> 终止符");
  }
  const content = raw.slice(0, endIdx).trim();
  const lines = content.split(/\r?\n/);
  const first = lines[0]?.trim() ?? "";
  if (!first.startsWith("#")) {
    throw new AppError("model.output_invalid", "起稿输出首行缺少 # 章名");
  }
  const title = first.replace(/^#+\s*/, "").trim();
  const body = lines.slice(1).join("\n").trim();
  if (!title || !body) {
    throw new AppError("model.output_invalid", "起稿输出标题或正文为空");
  }
  return { title, body };
}

export function gateDraft(
  draft: DraftOutput,
  opts: { targetWords?: number; minRatio?: number; maxRatio?: number } = {},
): GateReport {
  const target = opts.targetWords ?? 3000;
  const minWords = Math.floor(target * (opts.minRatio ?? 0.5));
  const maxWords = Math.ceil(target * (opts.maxRatio ?? 1.8));
  const wordCount = countChineseWords(draft.body);
  const reasons: string[] = [];
  const hits: string[] = [];

  if (wordCount < minWords) {
    reasons.push(`篇幅不足：当前 ${wordCount} 字，低于下限 ${minWords} 字`);
  } else if (wordCount > maxWords) {
    reasons.push(`篇幅过长：当前 ${wordCount} 字，高于上限 ${maxWords} 字`);
  }

  for (const rule of PLACEHOLDER_PATTERNS) {
    if (rule.pattern.test(draft.body) || rule.pattern.test(draft.title)) {
      hits.push(`占位符:${rule.label}`);
      reasons.push(`存在未替换占位符（${rule.label}）`);
    }
  }

  for (const rule of FORBIDDEN_HIT_PATTERNS) {
    if (rule.pattern.test(draft.body)) {
      hits.push(`命中项:${rule.label}`);
      reasons.push(`命中禁区词条（${rule.label}）`);
    }
  }

  return {
    passed: reasons.length === 0,
    wordCount,
    reasons,
    hits,
  };
}

export function filterLocatedIssues(
  issues: ReviewIssue[],
  body: string,
): { value: ReviewIssue[]; notes: string[] } {
  if (issues.length === 0) return { value: [], notes: [] };
  const kept: ReviewIssue[] = [];
  const notes: string[] = [];
  for (const item of issues) {
    if (item.quote && body.includes(item.quote)) {
      kept.push(item);
    } else {
      notes.push(`已剔除不可定位引文：${item.quote || "(空)"}`);
    }
  }
  if (kept.length === 0 && notes.length > 0) {
    throw new AppError("model.output_invalid", "审读引文全部不可定位，触发内容重试");
  }
  return { value: kept, notes };
}
