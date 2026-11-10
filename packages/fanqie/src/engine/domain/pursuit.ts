import { asObject, asString, asStringArray } from "../parse.js";
import { NovelError } from "../errors.js";

export const PURSUIT_CHOICES = {
  function: ["铺垫", "冲突", "兑现", "揭秘", "转场", "缓冲"],
  hookType: ["悬念", "危机", "反转", "揭示", "情绪", "预告"],
  payoffType: ["击杀", "打脸", "升级", "解谜", "结算", "情感"],
} as const;
export const PURSUIT_LISTS = ["newTerms", "newCharacters", "threadsOpen", "threadsClose"] as const;
export const PURSUIT_OUTLINE_SHAPE =
  "另为每章提供 function（铺垫/冲突/兑现/揭秘/转场/缓冲）、unit（单元ID）、unitPos（单元内从1起的章序）、hookType（悬念/危机/反转/揭示/情绪/预告）、pressure（连续受压章数，未受压为0）、newTerms/newCharacters/threadsOpen/threadsClose（短文本数组，无则空数组）；有兑现时提供 payoffType（击杀/打脸/升级/解谜/结算/情感）。这些是规划意图，不是已经发生的事实。";
export interface PursuitOutline {
  function?: string;
  unit?: string;
  unitPos?: number;
  hookType?: string;
  payoffType?: string;
  newTerms?: string[];
  newCharacters?: string[];
  threadsOpen?: string[];
  threadsClose?: string[];
  pressure?: number;
}
export interface UnitPlan {
  id: string;
  title: string;
  from: number;
  to: number;
  question: string;
  payoffs: string[];
  settlement: string;
  next: string;
}
export function parseUnitPlans(value: unknown): UnitPlan[] {
  if (!Array.isArray(value) || value.length !== 2)
    throw new NovelError("bad_args", "应给出当前及下一单元");
  const units = value.map((raw) => {
    const row = asObject(raw);
    const from = row.from,
      to = row.to;
    if (
      typeof from !== "number" ||
      !Number.isSafeInteger(from) ||
      from < 1 ||
      typeof to !== "number" ||
      !Number.isSafeInteger(to) ||
      to < from
    )
      throw new NovelError("bad_args", "单元章范围无效");
    const field = (key: string, max: number) => {
      const text = asString(row, key, { required: true });
      if (!text.trim() || text.length > max)
        throw new NovelError("bad_args", `单元 ${key} 长度无效`);
      return text;
    };
    const payoffs = asStringArray(row, "payoffs", { required: true, trim: false });
    if (payoffs.length > 10 || payoffs.some((text) => !text.trim() || text.length > 200))
      throw new NovelError("bad_args", "单元兑现清单无效");
    return {
      id: field("id", 64),
      title: field("title", 100),
      from,
      to,
      question: field("question", 1000),
      payoffs,
      settlement: field("settlement", 1000),
      next: field("next", 1000),
    };
  });
  if (units[0].id === units[1].id || units[1].from !== units[0].to + 1)
    throw new NovelError("bad_args", "单元标识须唯一，章范围须连续");
  return units;
}
/** Missing fields remain unknown in old works; absence never means a planned zero. */
export function parsePursuitOutline(raw: Record<string, unknown>): PursuitOutline {
  const out: PursuitOutline = {};
  for (const key of Object.keys(PURSUIT_CHOICES) as (keyof typeof PURSUIT_CHOICES)[]) {
    if (raw[key] === undefined) continue;
    const value = asString(raw, key, { required: true });
    if (!(PURSUIT_CHOICES[key] as readonly string[]).includes(value))
      throw new NovelError("bad_args", `章纲 ${key} 取值无效`);
    out[key] = value;
  }
  if (raw.unit !== undefined) {
    out.unit = asString(raw, "unit", { required: true });
    if (out.unit.length > 64) throw new NovelError("bad_args", "单元ID不能超过64字");
  }
  for (const key of PURSUIT_LISTS) {
    if (raw[key] === undefined) continue;
    const values = asStringArray(raw, key, { required: true, trim: false });
    if (values.length > 30 || values.some((value) => !value.trim() || value.length > 200))
      throw new NovelError("bad_args", `章纲 ${key} 须为不超过30项的短文本数组`);
    out[key] = [...new Set(values)];
  }
  for (const key of ["unitPos", "pressure"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < (key === "unitPos" ? 1 : 0)
    )
      throw new NovelError("bad_args", `章纲 ${key} 须为有效整数`);
    out[key] = value;
  }
  return out;
}
