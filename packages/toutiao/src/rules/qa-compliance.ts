/**
 * 头条合规、字数档位与长图文延伸节重查评分模块（从 qa-score.ts 拆分以保持单文件简洁）。
 */
import {
  BANDS,
  COMPLIANCE,
  EXT_OVERLAP_FAIL,
  EXT_OVERLAP_WARN,
  LONG_SPLIT,
  MODE_NAME,
  STORY_FACT_RE,
  TITLE_MAX,
} from "./constants.js";
import { clamp, extOverlap, splitExt } from "./qa-parse.js";

export interface ExtensionMetrics {
  start: string;
  main_chars: number;
  ext_chars: number;
  overlap: number;
}

export interface ComplianceScoreResult {
  score: number;
  risk: string[];
  extension: ExtensionMetrics | null;
  extGate: boolean;
}

export function evaluateCompliance(input: {
  scan: string;
  title: string;
  paras: string[];
  chars: number;
  mode?: string;
  micro: boolean;
  story: boolean;
  extStart?: string;
  hpos?: Array<[string, number]>;
  hasInteract: boolean;
  unfilled: string[];
  leak: number;
  leakHits: Array<[string, number]>;
  nearDup: number;
  dup: number;
  pronounMix: number;
  endHasNum: boolean;
  driver?: string;
  budget: Record<string, unknown> | null;
  driverPen: number;
  titleTooLong: boolean;
}): ComplianceScoreResult {
  const risk: string[] = [];
  let cp = 100;
  for (const [rawPat, why] of COMPLIANCE) {
    const pat = input.story && why === "未经证实信息" ? "内幕|独家爆料|知情人透露" : rawPat;
    const m = new RegExp(pat).exec(input.scan);
    if (m) {
      cp -= 11;
      risk.push(`“${m[0]}”命中${why}`);
    }
  }
  if (input.story) {
    const m = new RegExp(STORY_FACT_RE).exec(input.scan);
    if (m) {
      cp -= 8;
      risk.push(`“${m[0]}”：把神话写成了史实。没有本次打开的出处就删掉，有出处就改成转述`);
    }
  }
  if (!input.micro) {
    if (input.chars < 900) {
      cp -= 8;
      risk.push("全文不足900字，信息流权重会掉");
    }
    const cap = input.mode === "long" ? BANDS["long"][1] : 2600;
    if (input.chars > cap) {
      cp -= 5;
      risk.push(`超过${cap}字，完读率风险上升`);
    }
  }
  const band = input.mode ? BANDS[input.mode] : undefined;
  const modeLabel = input.mode ? (MODE_NAME[input.mode] ?? input.mode) : "";
  if (band && !(input.chars >= band[0] && input.chars <= band[1])) {
    cp -= 4;
    risk.push(`${modeLabel}应为 ${band[0]}~${band[1]} 字，现 ${input.chars} 字`);
  }

  let extInfo: ExtensionMetrics | null = null;
  let extGate = false;
  if (input.mode === "long") {
    const sp = splitExt(input.paras, input.hpos ?? [], input.extStart);
    if (!input.extStart) {
      risk.push("长图文没标延伸节从哪开始（--ext 或立项卡“延伸.起始小标题”），没法分查主稿和延伸");
    } else if (!sp) {
      cp -= 6;
      risk.push(`找不到延伸节起始小标题“${input.extStart}”`);
    } else {
      const [mp, ep] = sp;
      const mc = mp.join("").replace(/\s/g, "").length;
      const ec = ep.join("").replace(/\s/g, "").length;
      const ov = extOverlap(mp, ep);
      extInfo = {
        start: input.extStart,
        main_chars: mc,
        ext_chars: ec,
        overlap: Number(ov.toFixed(2)),
      };
      const [mlo, mhi] = LONG_SPLIT.main;
      if (!(mc >= mlo && mc <= mhi)) {
        cp -= 4;
        risk.push(`主稿应为 ${mlo}~${mhi} 字，现 ${mc} 字`);
      }
      const [elo, ehi] = LONG_SPLIT.ext;
      if (!(ec >= elo && ec <= ehi)) {
        cp -= 4;
        risk.push(`延伸节应为 ${elo}~${ehi} 字，现 ${ec} 字`);
      }
      if (ov >= EXT_OVERLAP_FAIL) {
        extGate = true;
        risk.push(
          `延伸节有 ${Math.round(ov * 100)}% 的片段和主稿重合：在重复主稿，不是延伸（平台判“事件重复描述”）`,
        );
      } else if (ov >= EXT_OVERLAP_WARN) {
        cp -= 6;
        risk.push(`延伸节有 ${Math.round(ov * 100)}% 的片段和主稿重合，删掉复述，只留新东西`);
      }
    }
  }

  if (!input.hasInteract) {
    cp -= 5;
    risk.push("缺互动引导，评论率上不来");
  }
  if (input.unfilled.length) {
    cp -= 30;
    risk.push(`存在未替换占位符 ${JSON.stringify(input.unfilled)}，严禁发出`);
  }
  if (input.leak) {
    cp -= 40;
    risk.push(`AI 身份泄漏 ${input.leakHits.map(([w]) => w).join("、")}，严禁发出`);
  }
  if (input.nearDup) {
    cp -= 6;
    risk.push(`有 ${input.nearDup} 组近似重复句（前12字相同）`);
  }
  if (input.dup) {
    cp -= 6;
    risk.push(`有${input.dup}句在文中重复出现`);
  }
  if (input.pronounMix) risk.push(`${input.pronounMix}段同时出现“他”和“她”，人工核对指代是否错位`);
  if (input.endHasNum) risk.push("最后一段出现了数字：结尾要落在人、动作或一句话上");
  if (input.budget && input.driverPen) {
    risk.push(
      `超出${input.driver}数字预算：数字${String(input.budget["numbers"])}/${String(input.budget["numbers_max"])}、` +
        `换算${String(input.budget["convert"])}/${String(input.budget["convert_max"])}、堆数段${String(input.budget["dense_paras"])}/${String(input.budget["dense_max"])}`,
    );
  }
  if (input.titleTooLong) {
    cp -= 11;
    risk.push(`标题 ${input.title.length} 字，超过平台 ${TITLE_MAX} 字硬上限，严禁发出`);
  }

  return { score: clamp(cp), risk, extension: extInfo, extGate };
}
