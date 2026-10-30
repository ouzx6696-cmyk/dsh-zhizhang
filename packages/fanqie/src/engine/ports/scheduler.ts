/**
 * Scheduler — single source of truth for default route vs explicit bypasses.
 * ProductMap / SYSTEM_BRIEF / tool receipts must cite this, not invent parallel chains.
 */
import { VERSION } from "../../../../core/src/version.js";
/** Canonical default loop — same semantics as CREATIVE_LOOP_LINE; keep in sync via ProductMap. */
export const SCHEDULER_DEFAULT_LINE = "按最终产物进入：片段分析（可不入库）｜规划（参考可选）｜正文写作或修订；已有依据直接复用，不自动跨阶段";
/** Writing segment only (after foundation/outline ready). */
export const SCHEDULER_WRITE_LINE = "chapter_brief(lean) → 创作与回读 → candidate_stage → candidate_accept（内置扫描，编辑可选；采纳不等于定稿）";
/** Library segment. */
export const SCHEDULER_LIBRARY_LINE = "library_import → library_plan（auto 10% / full 须同意）→ dissect_brief(batch) → facts_stage（白描）→ structure_stage（剧情/节奏/人物）→ card_stage（v2 模块）→ card_accept → report → combo_suggest";
/** Inspiration segment. */
export const SCHEDULER_INSPIRE_LINE = "inspire_start(goal，card_ids 可选) → forge_brief → stage → accept(apply=true)";
export const SCHEDULER_BYPASSES = [
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
        when: "可选标注仅技法用途，不再是缺 mind 的必经旁路",
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
        when: "config.multiDraftEnabled 或 WRITER_NOVEL_MULTI_DRAFT=1；同章≥2 待采纳要对齐口气",
        via: "candidate_stage(draft_label)×N → chapter_drafts → unify_brief → 整理 → unify_stage → accept（内置扫描）（默认链不进）",
    },
    {
        id: "finalize.ship",
        title: "定稿与汇编",
        when: "章末或完书",
        via: "chapter_save status=reviewed + expected_revision → status=final · assemble",
    },
];
/** Next-step hints keyed by just-finished tool family (for receipts). */
const NEXT_HINTS = {
    library_import: "fanqie_library_plan（auto 默认 10%；full 须作者同意）→ dissect_brief(batch) → facts_stage → structure_stage → card_stage → card_accept → report → combo_suggest",
    library_plan: "fanqie_library_dissect_brief(source, batch=0) → facts_stage → structure_stage",
    library_dissect: "fanqie_library_facts_stage（逐章白描）→ structure_stage",
    library_card_accept: "fanqie_library_report → fanqie_library_combo_suggest（library_audit 为诊断旁路，勿例行）",
    library_combo: "fanqie_inspire_start(card_ids) 规划，或 chapter_brief(card_ids) 开写",
    library_audit: "fanqie_library_combo_suggest；或逐卡人读按五条判（机械面通过≠合格）",
    inspire_start: "fanqie_inspire_forge_brief → stage → accept(apply=true)",
    inspire_stage: "fanqie_inspire_accept(apply=true) → chapter_brief",
    inspire_accept_applied: SCHEDULER_WRITE_LINE,
    chapter_brief: "创作与回读 → candidate_stage → candidate_accept；定稿另核审读与授权",
    candidate_stage: "回读候选后 candidate_accept（内置扫描）；需要诊断可提前 style_lint，深度编辑可选",
    style_lint: "可选 fanqie_candidate_edit_brief → edit_stage；或直接 candidate_accept。编辑采纳按实际授权；A/B/C 可选，采纳不等于定稿",
    candidate_edit_stage: "按授权采纳编辑工作稿，或保留候选；A/B/C 兼容交互不要求重复确认",
    candidate_edit_decide_b: "fanqie_candidate_accept（内置扫描；提前 style_lint 可选）",
    candidate_edit_decide_c: "保留写手候选；或换 mode 重跑 edit_brief → edit_stage",
    candidate_accept: "续章再 chapter_brief；定稿旁路见 finalize.ship；诊断旁路见 diagnose.audit",
    candidate_unify_brief: "整理合并正文 → fanqie_candidate_unify_stage(candidate_ids=…, content=…) → candidate_accept（内置扫描）",
    candidate_unify_stage: "fanqie_candidate_accept（内置扫描）",
    project_create: "有卡：combo → inspire → " +
        SCHEDULER_WRITE_LINE +
        "；无卡：inspire_start(goal) 规划，或 outline_set → " +
        SCHEDULER_WRITE_LINE,
    work_status: SCHEDULER_WRITE_LINE + "；audit 仅诊断旁路；定稿用 finalize.ship",
};
export const Scheduler = {
    id: "port.scheduler",
    version: VERSION,
    defaultLine() {
        return SCHEDULER_DEFAULT_LINE;
    },
    writeLine() {
        return SCHEDULER_WRITE_LINE;
    },
    libraryLine() {
        return SCHEDULER_LIBRARY_LINE;
    },
    inspireLine() {
        return SCHEDULER_INSPIRE_LINE;
    },
    bypasses() {
        return SCHEDULER_BYPASSES;
    },
    /** Receipt / status next-step; unknown keys fall back to write line. */
    nextHint(after: string) {
        return (NEXT_HINTS as Record<string, string>)[after] ?? SCHEDULER_WRITE_LINE;
    },
    /** Panel / status default-route lines — single source; audits never listed as default. */
    panelRouteHints() {
        return [
            `创作路径：${SCHEDULER_WRITE_LINE}`,
            `accept 后：${NEXT_HINTS.candidate_accept}`,
        ];
    },
    formatDiagram() {
        const lines = [
            "## 调度（默认 vs 旁路）",
            "",
            "### 默认 DEFAULT — 最短合格",
            Scheduler.defaultLine(),
            "",
            `- 库段：${SCHEDULER_LIBRARY_LINE}`,
            `- 灵感段：${SCHEDULER_INSPIRE_LINE}`,
            `- 写作段：${SCHEDULER_WRITE_LINE}`,
            "- 编辑按需：edit_brief → 改写 → edit_stage；按真实授权采纳工作稿，或保留候选。A/B/C 为兼容交互，采纳不代表审读或定稿",
            "- 可选·多草稿（默认关）：同章多 stage → unify_brief → unify_stage → candidate_accept（内置扫描）；见旁路 multi.draft",
            "- Accept 内嵌软传感（人味/书感/兑付/AI腔）；三 audit 仅诊断旁路",
            "",
            "### 旁路 BYPASS — 显式进入",
        ];
        for (const b of SCHEDULER_BYPASSES) {
            lines.push(`- **${b.title}**（\`${b.id}\`）：何时=${b.when}；经由=${b.via}`);
        }
        return lines.join("\n");
    },
    formatForAgent() {
        return [
            `# 长篇调度 · ${Scheduler.version}`,
            "",
            Scheduler.formatDiagram(),
            "",
            "分喂：mind→inspire 设定/纲；craft→lean brief 写法+状态。迷路先看本图或 fanqie_product_map。",
        ].join("\n");
    },
    /**
     * 启用回执用的紧凑定向（约 0.5K 字符）。全图留在 fanqie_product_map
     * 工具与常驻 SYSTEM_BRIEF 里——启用瞬间不再整页复述调度文本。
     */
    formatEnableSummary() {
        return [
            `- 全链：${SCHEDULER_DEFAULT_LINE}`,
            `- 旁路（显式才走）：${SCHEDULER_BYPASSES.map((b) => b.id).join(" / ")}`,
            "- 迷路先调 fanqie_product_map（调度全图）；硬规则全文 fanqie_system_brief",
        ].join("\n");
    },
};
