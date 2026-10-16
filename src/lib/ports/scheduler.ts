/**
 * Scheduler — single source of truth for default route vs explicit bypasses.
 * ProductMap / SYSTEM_BRIEF / tool receipts must cite this, not invent parallel chains.
 */
export type RouteKind = "default" | "bypass";

export interface BypassRoute {
  id: string;
  title: string;
  /** When agent may enter this path. */
  when: string;
  /** Tools or flags involved. */
  via: string;
}

/** Canonical default loop — same semantics as CREATIVE_LOOP_LINE; keep in sync via ProductMap. */
export const SCHEDULER_DEFAULT_LINE =
  "书进库（craft|mind）→ library_combo_suggest（1 mind + N craft，可跨书）→ inspire 落根基/纲 → chapter_brief(lean，只吃 craft）→ candidate_stage → style_lint → candidate_accept";

/** Writing segment only (after foundation/outline ready). */
export const SCHEDULER_WRITE_LINE =
  "chapter_brief(lean) → 创作 → candidate_stage → style_lint → candidate_accept";

/** Library segment. */
export const SCHEDULER_LIBRARY_LINE =
  "library_import → dissect_brief → card_stage → card_accept → combo_suggest";

/** Inspiration segment. */
export const SCHEDULER_INSPIRE_LINE =
  "inspire_start(card_ids) → forge_brief → stage → accept(apply=true)";

export const SCHEDULER_BYPASSES: readonly BypassRoute[] = [
  {
    id: "diagnose.audit",
    title: "诊断 audit",
    when: "accept 回执有 soft warn，或作者要细看兑付/人味/书感",
    via: "payoff_audit / human_feel_audit / novel_sense_audit（仅诊断旁路）",
  },
  {
    id: "brief.full",
    title: "厚 brief",
    when: "需要卡全文 + 四方法包 + 节拍",
    via: "chapter_brief brief_mode=full",
  },
  {
    id: "save.direct",
    title: "直写章节",
    when: "作者显式旁路候选链（大正文）",
    via: "chapter_save + confirm_bypass",
  },
  {
    id: "inspire.craft_only",
    title: "仅技法灵感",
    when: "无 mind 卡仍要开 inspire",
    via: "inspire_start craft_only=true",
  },
  {
    id: "accept.flags",
    title: "采纳硬开关",
    when: "测试或作者显式收紧/跳过",
    via: "skip_brief / strict_lint / require_payoff / strict_human / strict_novel / force",
  },
  {
    id: "finalize.ship",
    title: "定稿与汇编",
    when: "章末或完书",
    via: "chapter_save status=final · review_ledger · assemble / export",
  },
] as const;

/** Next-step hints keyed by just-finished tool family (for receipts). */
const NEXT_HINTS: Record<string, string> = {
  library_import: "zhizhang_library_dissect_brief → card_stage → card_accept → combo_suggest",
  library_dissect: "zhizhang_library_card_stage(axis) → card_accept",
  library_card_accept: "zhizhang_library_combo_suggest → inspire_start 或 chapter_brief",
  library_combo: "zhizhang_inspire_start(card_ids) 规划，或 chapter_brief(card_ids) 开写",
  inspire_start: "zhizhang_inspire_forge_brief → stage → accept(apply=true)",
  inspire_stage: "zhizhang_inspire_accept(apply=true) → chapter_brief",
  inspire_accept_applied: SCHEDULER_WRITE_LINE,
  chapter_brief: "创作 → candidate_stage → style_lint → candidate_accept",
  candidate_stage: "zhizhang_style_lint(candidate=…) → candidate_accept",
  candidate_accept: "续章再 chapter_brief；定稿旁路见 finalize.ship；诊断旁路见 diagnose.audit",
  project_create:
    "有卡：combo → inspire → " +
    SCHEDULER_WRITE_LINE +
    "；无卡：outline_set → " +
    SCHEDULER_WRITE_LINE,
  work_status: SCHEDULER_WRITE_LINE + "；audit 仅诊断旁路；定稿用 finalize.ship",
};

export const Scheduler = {
  id: "port.scheduler" as const,
  version: "0.10.5",

  defaultLine(): string {
    return SCHEDULER_DEFAULT_LINE;
  },

  writeLine(): string {
    return SCHEDULER_WRITE_LINE;
  },

  libraryLine(): string {
    return SCHEDULER_LIBRARY_LINE;
  },

  inspireLine(): string {
    return SCHEDULER_INSPIRE_LINE;
  },

  bypasses(): readonly BypassRoute[] {
    return SCHEDULER_BYPASSES;
  },

  /** Receipt / status next-step; unknown keys fall back to write line. */
  nextHint(after: keyof typeof NEXT_HINTS | string): string {
    return NEXT_HINTS[after] ?? SCHEDULER_WRITE_LINE;
  },

  formatDiagram(): string {
    const lines = [
      "## 调度（默认 vs 旁路）",
      "",
      "### 默认 DEFAULT — 最短合格",
      Scheduler.defaultLine(),
      "",
      `- 库段：${SCHEDULER_LIBRARY_LINE}`,
      `- 灵感段：${SCHEDULER_INSPIRE_LINE}`,
      `- 写作段：${SCHEDULER_WRITE_LINE}`,
      "- Accept 内嵌软传感（人味/书感/兑付/AI腔）；三 audit 仅诊断旁路",
      "",
      "### 旁路 BYPASS — 显式进入",
    ];
    for (const b of SCHEDULER_BYPASSES) {
      lines.push(`- **${b.title}**（\`${b.id}\`）：何时=${b.when}；经由=${b.via}`);
    }
    return lines.join("\n");
  },

  formatForAgent(): string {
    return [
      `# 织章调度 · ${Scheduler.version}`,
      "",
      Scheduler.formatDiagram(),
      "",
      "分喂：mind→inspire 设定/纲；craft→lean brief 写法+状态。迷路先看本图或 zhizhang_product_map。",
    ].join("\n");
  },
};
