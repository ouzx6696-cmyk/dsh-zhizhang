import type { Segment } from "./types.js";

type Semantic = NonNullable<Segment["semantic"]>;
export const SEMANTIC_PATTERNS: ReadonlyArray<{
  semantic: Semantic;
  pattern: RegExp;
  level: 1 | 2 | 3;
}> = [
  {
    semantic: "volume",
    pattern:
      /^(第[一二三四五六七八九十百零〇\d]+[卷部篇集]|[卷部篇][一二三四五六七八九十\d]+|Volume\s*\d+)/iu,
    level: 1,
  },
  {
    semantic: "act",
    pattern:
      /^(第[一二三四五六七八九十百零〇\d]+幕|单元[一二三四五六七八九十\d]+|第[一二三四五六七八九十\d]+阶段)/u,
    level: 2,
  },
  {
    semantic: "chapter",
    pattern: /^(第[一二三四五六七八九十百千零〇\d]+[章节回]|\d{1,4}[.、．]\s*\S)/u,
    level: 3,
  },
];
export const NUMBERED =
  /^([一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d+(\.\d+)*[.、]|[①-⑳])/u;
export const BRACKETED = /^[【〔「].{1,30}[】〕」]$/u;
export const SEPARATOR = /^(?:[-=*_—─]\s*){3,}$/u;
export const HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/人物|角色/u, "setting-character"],
  [/势力|宗门|门派/u, "setting-faction"],
  [/地图|地点|城/u, "setting-place"],
  [/境界|功法|修炼体系/u, "setting-power"],
  [/法宝|物品|道具/u, "setting-item"],
  [/规则|设定|世界观/u, "setting-rule"],
  [/时间线|大事记|年表/u, "timeline"],
  [/卷/u, "outline-volume"],
  [/幕/u, "outline-act"],
  [/章/u, "outline-chapter"],
];

export function hintOf(text: string, semantic?: Semantic): string {
  return (
    HINTS.find(([pattern]) => pattern.test(text))?.[1] ??
    (semantic ? `outline-${semantic}` : "unknown")
  );
}
