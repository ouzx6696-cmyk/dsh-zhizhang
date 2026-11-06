/**
 * per-work 题材词表（case lexicon）装载。
 *
 * payoff 审计的题材敏感检查（说话/呼吸漂移、单位错配、livedScene 器物）此前
 * 硬编码单一题材正则：换题材的书既误报也永远不触发。词表移到作品级小文件
 * `<作品目录>/payoff-lexicon.json`（与 quality-lexicon.json 同一惯例）：
 *
 *   {
 *     "speech": ["人声", "说话", "说出口"],
 *     "breath": ["呼吸", "呼吸声"],
 *     "units": [["混响", "毫米"]],
 *     "hooks": ["回放", "侧窗", "时间戳"]
 *   }
 *
 * 文件缺失或四段全空返回 undefined——调用方跳过对应检查，默认路径只保留
 * 通用 ending 兑付评分；文件存在但字段损坏照常报错，不静默当没配。
 */
import path from "node:path";
import { NovelError } from "../errors.js";
import { readJsonCached } from "../file-cache.js";
import { asObject, asStringArray } from "../parse.js";
import { isMissingFileError } from "./primitives.js";

/** auditPayoff 题材敏感检查的注入词表（作品级，见 loadPayoffCaseLexicon）。 */
export interface PayoffCaseLexicon {
  speech?: string[];
  breath?: string[];
  /** [术语, 可疑单位] 对：正文同句出现即报（如 混响+毫米）。 */
  units?: [string, string][];
  /** livedScene 强调的器物/动作名词（软核对在场）。 */
  hooks?: string[];
}

function asUnitPairs(value: unknown, label: string): [string, string][] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new NovelError("bad_args", `${label} 必须是 [术语, 单位] 二元组数组`);
  const out: [string, string][] = [];
  for (const item of value) {
    if (
      !Array.isArray(item) ||
      item.length !== 2 ||
      item.some((part) => typeof part !== "string" || !part.trim())
    )
      throw new NovelError("bad_args", `${label} 每项须为 [术语, 单位] 两个非空字符串`);
    out.push([item[0].trim(), item[1].trim()]);
  }
  return out;
}

/** 读作品级题材词表；缺文件返回 undefined，四段全空也视为未配置。 */
export async function loadPayoffCaseLexicon(dir: string): Promise<PayoffCaseLexicon | undefined> {
  let raw: unknown;
  try {
    raw = await readJsonCached<unknown>(path.join(dir, "payoff-lexicon.json"));
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
  const obj = asObject(raw, "payoff-lexicon");
  const lexicon: PayoffCaseLexicon = {
    speech: asStringArray(obj, "speech"),
    breath: asStringArray(obj, "breath"),
    units: asUnitPairs(obj.units, "payoff-lexicon units"),
    hooks: asStringArray(obj, "hooks"),
  };
  const empty =
    !lexicon.speech?.length &&
    !lexicon.breath?.length &&
    !lexicon.units?.length &&
    !lexicon.hooks?.length;
  return empty ? undefined : lexicon;
}
