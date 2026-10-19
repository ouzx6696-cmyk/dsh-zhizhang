/**
 * Scheduler — single source of truth for default route vs explicit bypasses.
 * ProductMap / SYSTEM_BRIEF / tool receipts must cite this, not invent parallel chains.
 */
import { PLUGIN_VERSION } from "../version.js";

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
  "书进库（craft|mind）→ library_combo_suggest（1 mind + N craft，可跨书）→ inspire 落根基/纲 → chapter_brief(lean，只吃 craft）→ candidate_stage → style_lint →（可选 edit）→ candidate_accept";

/** Writing segment only (after foundation/outline ready). */
export const SCHEDULER_WRITE_LINE =
  "chapter_brief(lean) → 创作 → candidate_stage → style_lint →（可选 edit）→ candidate_accept";

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
    via: "skip_brief / strict_lint / require_payoff / strict_human / strict_novel / force / accept_after_edit+confirm",
  },
  {
    id: "multi.draft",
    title: "多草稿统一整理",
    when: "config.multiDraftEnabled 或 DSH_ZHIZHANG_MULTI_DRAFT=1；同章≥2 待采纳要对齐口气",
    via: "candidate_stage(draft_label)×N → chapter_drafts → unify_brief → 整理 → unify_stage → style_lint → accept（默认链不进）",
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
  chapter_brief: "创作 → candidate_stage → style_lint →（可选 edit）→ candidate_accept",
  candidate_stage: "zhizhang_style_lint(candidate=…) →（可选 edit）→ candidate_accept",
  style_lint:
    "可选 zhizhang_candidate_edit_brief → edit_stage；或直接 candidate_accept。编辑后须用户选 A/B/C，禁止静默验收",
  candidate_edit_stage:
    "请用户选 A 编辑+一次确认验收 / B 仅候选再验 / C 拒编辑或换模式；未表态按 B",
  candidate_edit_decide_b: "zhizhang_style_lint(candidate=编辑候选) → candidate_accept",
  candidate_edit_decide_c: "保留写手候选；或换 mode 重跑 edit_brief → edit_stage",
  candidate_accept: "续章再 chapter_brief；定稿旁路见 finalize.ship；诊断旁路见 diagnose.audit",
  candidate_unify_brief:
    "整理合并正文 → zhizhang_candidate_unify_stage(candidate_ids=…, content=…) → style_lint → accept",
  candidate_unify_stage: "zhizhang_style_lint(candidate=整理稿) → candidate_accept",
  project_create:
    "有卡：combo → inspire → " +
    SCHEDULER_WRITE_LINE +
    "；无卡：outline_set → " +
    SCHEDULER_WRITE_LINE,
  work_status: SCHEDULER_WRITE_LINE + "；audit 仅诊断旁路；定稿用 finalize.ship",
};

export const Scheduler = {
  id: "port.scheduler" as const,
  version: PLUGIN_VERSION,

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

  /** Panel / status default-route lines — single source; audits never listed as default. */
  panelRouteHints(): string[] {
    return [
      `创作路径：${SCHEDULER_WRITE_LINE}`,
      `accept 后：${NEXT_HINTS.candidate_accept}`,
    ];
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
      "- 可选 edit（去空转留毛边）：lint 后 edit_brief→改写→edit_stage；用户选 A（确认=编辑+accept）/ B（仅候选）/ C（拒/换模式）；未表态按 B；禁止静默验收",
      "- 可选·多草稿（默认关）：同章多 stage → unify_brief → unify_stage → lint → accept；见旁路 multi.draft",
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
