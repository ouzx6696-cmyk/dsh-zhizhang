/**
 * EditPort — optional post-draft edit pass (去AI味/润色) before accept.
 * Aligns with docs/skills/web-novel-master-optimizer.md §0.5 A/B/C.
 * Never silent-accept: A requires confirm_accept_after_edit; unset → B safety default.
 * 0.11.1+: depolish brief keeps breath/rough edges; forbids flattening for “去AI味”.
 */
import { allow, deny, info, warn } from "./types.js";
import { PLUGIN_VERSION } from "../version.js";
/** Canonical polish modes from the optimizer skill; default = polish-depolish. */
export const EDIT_MODE_IDS = [
    "polish-depolish",
    "polish-rhythm",
    "polish-condense",
    "polish-expand",
    "polish-style",
    "polish-literary",
    "proofread",
];
const MODE_INFO = {
    "polish-depolish": {
        id: "polish-depolish",
        title: "标准去AI味",
        focus: "清空转连接/万能动作/心理标签/段尾升华；保留呼吸起伏与局部毛边；禁止为去AI味把句长熨平、主语砍光",
        lengthHint: "原长 ±10%；长短交错，不求句句变短",
    },
    "polish-rhythm": {
        id: "polish-rhythm",
        title: "节奏提速",
        focus: "删重复；事件句短句；无新信息段合并",
        lengthHint: "压缩 20%–40%",
    },
    "polish-condense": {
        id: "polish-condense",
        title: "凝练缩写",
        focus: "删枝节、合并同类对话场景",
        lengthHint: "原长 60%–70%",
    },
    "polish-expand": {
        id: "polish-expand",
        title: "血肉扩写",
        focus: "七维扩充：阻力动作、利益台词、五感；张力优先",
        lengthHint: "原长 1.5–2 倍",
    },
    "polish-style": {
        id: "polish-style",
        title: "文风统一",
        focus: "统一视角时态口吻；错别字病句",
        lengthHint: "长度基本不变",
    },
    "polish-literary": {
        id: "polish-literary",
        title: "重构式深度润色",
        focus: "只守情节/人设/世界观；其余可重组；几乎每段可见重构",
        lengthHint: "依张力伸缩",
    },
    proofread: {
        id: "proofread",
        title: "校对",
        focus: "错别字、病句、标点；不抹口癖",
        lengthHint: "长度基本不变",
    },
};
export const EditPort = {
    id: "port.edit",
    version: PLUGIN_VERSION,
    defaultMode: "polish-depolish",
    skillDoc: "docs/skills/web-novel-master-optimizer.md",
    listModes() {
        return EDIT_MODE_IDS.map((id) => MODE_INFO[id]);
    },
    normalizeMode(raw) {
        const s = String(raw ?? "").trim();
        if (!s)
            return EditPort.defaultMode;
        if (EDIT_MODE_IDS.includes(s))
            return s;
        if (/^polish-depolish-[a-z]+$/i.test(s))
            return s.toLowerCase();
        // fuzzy aliases
        const lower = s.toLowerCase();
        if (lower.includes("节奏") || lower === "rhythm")
            return "polish-rhythm";
        if (lower.includes("缩") || lower === "condense")
            return "polish-condense";
        if (lower.includes("扩") || lower === "expand")
            return "polish-expand";
        if (lower.includes("重构") || lower === "literary")
            return "polish-literary";
        if (lower.includes("校对") || lower === "proofread")
            return "proofread";
        if (lower.includes("文风") || lower === "style")
            return "polish-style";
        if (lower.includes("去") || lower.includes("depolish") || lower === "标准") {
            return "polish-depolish";
        }
        return EditPort.defaultMode;
    },
    modeInfo(mode) {
        const id = EditPort.normalizeMode(mode);
        if (id in MODE_INFO)
            return MODE_INFO[id];
        if (id.startsWith("polish-depolish-")) {
            const cat = id.slice("polish-depolish-".length);
            return {
                id,
                title: `分类专项·${cat}`,
                focus: `只盯 ${cat} 类 AI 腔密度；仍须保留呼吸起伏，禁止齐刷短句`,
                lengthHint: "原长 ±10%；长短交错，不求句句变短",
            };
        }
        return MODE_INFO["polish-depolish"];
    },
    /**
     * Agent-facing edit brief — positive craft framing; hard ban-list stays short.
     * Model must NOT claim已定稿; user picks A/B/C after rewrite.
     * Depolish: keep breath & rough edges; forbid flattening for “去AI味”.
     */
    formatEditBrief(input = {}) {
        const mode = EditPort.normalizeMode(input.mode);
        const info = EditPort.modeInfo(mode);
        const land = String(input.shouldLandLine ?? "").trim();
        const sit = String(input.situation ?? "").trim();
        const isDepolish = mode === "polish-depolish" || mode.startsWith("polish-depolish-");
        const lines = [
            `【编辑过稿 · ${info.title}（${mode}）】`,
            `侧重：${info.focus}`,
            `长度：${info.lengthHint}`,
            "改完后不要自称已定稿；由用户选 A 编辑+验收 / B 仅候选 / C 拒编辑或换模式。",
            "",
            "【要写成什么样】",
            "1. 处境驱动：视线与行为紧扣当下利益；景物只作生路/破绽/财物信息。",
            "2. 实景推进：关键处用带阻力的动作、博弈台词、五感；过程可读，不跳步通报。",
            "3. 呼吸自然：长短句交错，可留半截念头与局部毛边；事件句可以干脆，但不要整段齐刷短句；结尾落具体残局/物品/威胁，不升华。",
            "4. 打碎僵硬（正向）：信息不急着讲漂亮、过程可留毛边；卖点节拍与压力链不散，避免散文化。",
            "5. 人还在场：口癖与合理宣泄可留；系统面板与必要概括可留；主语不必为『干净』而砍光。",
        ];
        if (isDepolish) {
            lines.push("", "【去AI味 ≠ 磨成范文齐句】", "- 要去的是：空转连接词、万能动作套话、心理标签、辩证「不是A而是B」、段尾升华。", "- 要留的是：长短呼吸、口癖、半截念头与局部毛边；只动真正出戏的地方。", "- 读来齐刷短句时，优先退回写手稿或换 polish-rhythm，而不是继续往短压。");
        }
        if (land) {
            lines.push("", `【本场应落纸】${land}`);
        }
        if (sit) {
            lines.push("", `【本章处境/冲突】${sit}`);
        }
        lines.push("", "【硬边界】", "- 保留故事事实、胜负因果与核心设定；禁止新增无关情节。", "- 禁止引入连接词空转、万能动作套话、心理标签、辩证「不是A而是B」、段尾哲理金句。", "- 禁止为去AI味而齐刷短句或把主语砍光成匀速吐字。", "- 只输出重塑后的正文，无说明报告。", "", "下一步：把正文交给 zhizhang_candidate_edit_stage；再请用户选 A/B/C（未表态按 B）。");
        return lines.join("\n");
    },
    /** Parse user/agent choice; null = unset (safety = B). */
    resolveChoice(raw) {
        const s = String(raw ?? "").trim().toUpperCase();
        if (!s)
            return null;
        if (s === "A" || s.startsWith("A)") || s.includes("直接验收") || s.includes("编辑后验收") || s.includes("编辑完就")) {
            return "A";
        }
        if (s === "B" || s.startsWith("B)") || s.includes("仅候选") || s.includes("再验收") || s.includes("先用编辑")) {
            return "B";
        }
        if (s === "C" || s.startsWith("C)") || s.includes("拒") || s.includes("不用") || s.includes("换模式")) {
            return "C";
        }
        return null;
    },
    choiceMenuLine() {
        return "请用户选：A 采纳编辑稿并一次确认验收 · B 编辑稿仅候选仍须另验 · C 拒编辑/换模式。未表态按 B，禁止静默验收。";
    },
    /**
     * Soft hints after edit_stage — surface uniform_short_run etc. without blocking.
     */
    softHintLines(hits) {
        if (!hits.length)
            return [];
        const lines = ["【编辑软提示·不阻断】"];
        for (const h of hits) {
            lines.push(`- ${h.code}：${h.text}`);
            if (h.code === "uniform_short_run") {
                lines.push("  → 建议：选 C 退回写手稿，或换 polish-rhythm；不要在齐刷短句上再压短。");
            }
        }
        return lines;
    },
    /** Receipt lines right after edit_stage (never accept here). */
    afterStageLines(opts) {
        const info = EditPort.modeInfo(opts.mode);
        return [
            `编辑候选已暂存：${opts.editCandId}`,
            `- 源写手候选：${opts.parentCandId}`,
            `- 模式：${info.title}（${EditPort.normalizeMode(opts.mode)}）`,
            `- 目标章：${opts.chapterId}`,
            `- 正式章未改；禁止静默验收`,
            ...EditPort.softHintLines(opts.softHits ?? []),
            EditPort.choiceMenuLine(),
            `A：zhizhang_candidate_edit_decide(choice=A, confirm_accept_after_edit=true) — 须先对本编辑候选 style_lint`,
            `B：zhizhang_candidate_edit_decide(choice=B) — 稍后 lint → candidate_accept`,
            `C：zhizhang_candidate_edit_decide(choice=C) — 保留写手稿或换 mode 重跑 edit_brief`,
        ];
    },
    /**
     * Accept-path flags for A.
     * - acceptAfterEdit without confirm → hard deny (never silent A)
     * - acceptAfterEdit + confirm but candidate not an edit → deny
     * - no acceptAfterEdit → allow (normal / B accept)
     */
    evaluateAcceptFlags(input) {
        const wantA = Boolean(input.acceptAfterEdit);
        const confirmed = Boolean(input.confirmAcceptAfterEdit);
        const isEdit = Boolean(input.candidateIsEdit);
        if (!wantA) {
            if (confirmed) {
                return allow([
                    warn("edit_confirm_ignored", "未声明 accept_after_edit；confirm 被忽略。若要走 A，请同时传 accept_after_edit=true 与 confirm_accept_after_edit=true。"),
                ]);
            }
            return allow([]);
        }
        if (!isEdit) {
            return deny("edit_accept_not_an_edit", "accept_after_edit 仅用于编辑产物（候选带 editOf）。请先 zhizhang_candidate_edit_stage，或对普通候选去掉该旗标。");
        }
        if (!confirmed) {
            return deny("edit_accept_confirm_required", "路径 A 须一次显式确认：传 confirm_accept_after_edit=true（确认：采纳本章编辑稿并验收为正式章）。禁止静默验收。");
        }
        return allow([
            info("edit_accept_confirmed", "已确认：采纳编辑稿并验收为正式章（一次确认 = 应用编辑 + accept）"),
        ]);
    },
    /** Receipt extras when A succeeded. */
    acceptPathAReceiptLines() {
        return ["已应用编辑", "已验收（编辑后直接验收 · 路径 A）"];
    },
    decideChoiceLines(choice, opts) {
        if (choice === "A") {
            return [
                `路径 A 已就绪候选 ${opts.candId}：请确保已 style_lint，再带 confirm_accept_after_edit=true 调用 edit_decide 或 candidate_accept(accept_after_edit)。`,
            ];
        }
        if (choice === "B") {
            return [
                `路径 B：编辑稿 ${opts.candId} 仅作候选，正式章未改。`,
                "下一步：zhizhang_style_lint(candidate=…) → zhizhang_candidate_accept（勿称已验收）。",
                EditPort.choiceMenuLine(),
            ];
        }
        return [
            `路径 C：已拒本次编辑候选 ${opts.candId}。正式章与写手草稿关系不变。`,
            opts.parentId ? `- 写手候选仍可验收：${opts.parentId}` : "- 可回到写手候选验收",
            opts.mode
                ? `- 换模式：zhizhang_candidate_edit_brief(mode=…) 后重新 edit_stage`
                : `- 换模式：zhizhang_candidate_edit_brief 后重新 edit_stage`,
            "未验收。",
        ];
    },
};
