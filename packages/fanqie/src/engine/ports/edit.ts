/**
 * EditPort — optional post-draft edit pass (去AI味/润色) before accept.
 * Guidance: fanqie_method_get ids=edit; A/B/C remains optional.
 * Never silent-accept: A requires confirm_accept_after_edit; unset → B safety default.
 * Depolish brief keeps breath/rough edges; forbids flattening for “去AI味”.
 */
import { REVIEW_GUIDANCE } from "../domain/creative-guidance.js";
import { allow, deny, info, warn } from "./types.js";
import { VERSION } from "../../../../core/src/version.js";
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
        lengthHint: "依阅读问题调整，不按比例改稿",
    },
    "polish-rhythm": {
        id: "polish-rhythm",
        title: "节奏提速",
        focus: "删重复；事件句短句；无新信息段合并",
        lengthHint: "删实际冗余，不预设压缩比例",
    },
    "polish-condense": {
        id: "polish-condense",
        title: "凝练缩写",
        focus: "删枝节、合并同类对话场景",
        lengthHint: "保留必要经历，不预设压缩比例",
    },
    "polish-expand": {
        id: "polish-expand",
        title: "血肉扩写",
        focus: "七维扩充：阻力动作、利益台词、五感；张力优先",
        lengthHint: "只补有依据的必要经历，不预设扩写倍数",
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
        focus: "只守情节/人设/世界观；其余可重组；按实际结构与场面问题重组",
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
    version: VERSION,
    defaultMode: "polish-depolish",
    skillDoc: "fanqie_method_get ids=edit",
    listModes() {
        return EDIT_MODE_IDS.map((id: string) => (MODE_INFO as Record<string, any>)[id]);
    },
    normalizeMode(raw: string) {
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
    modeInfo(mode: any) {
        const id = EditPort.normalizeMode(mode);
        if (id in MODE_INFO)
            return (MODE_INFO as Record<string, any>)[id];
        if (id.startsWith("polish-depolish-")) {
            const cat = id.slice("polish-depolish-".length);
            return {
                id,
                title: `分类专项·${cat}`,
                focus: `参考 ${cat} 类信号定位实际阅读问题；仍须保留呼吸起伏，禁止齐刷短句`,
                lengthHint: "依阅读问题调整，不按比例改稿",
            };
        }
        return MODE_INFO["polish-depolish"];
    },
    /**
     * Agent-facing edit brief — positive craft framing; hard ban-list stays short.
     * Applying an edit uses actual authorization; it does not declare review or final.
     * Depolish: keep breath & rough edges; forbid flattening for “去AI味”.
     */
    formatEditBrief(input: any = {}) {
        const info = EditPort.modeInfo(input.mode);
        return [
            `【编辑过稿 · ${info.title}】`, REVIEW_GUIDANCE,
            `本轮方向：${info.focus}。修改范围以作者实际授权为准；没有问题就保留，不按模式强制改字数。`,
            input.shouldLandLine ? `本章已约定内容：${input.shouldLandLine}` : "",
            input.situation ? `本章处境：${input.situation}` : "",
            "实际改稿仍交 candidate_edit_stage。A/B/C 是采用范围的兼容交互，不代表已定稿；已有明确授权不重复索取固定确认词。",
        ].filter(Boolean).join("\n");
    },
    /** Parse user/agent choice; null = unset (safety = B). */
    resolveChoice(raw: string) {
        const s = String(raw ?? "").trim().toUpperCase();
        if (!s)
            return null;
        if (s === "A" || s === "B" || s === "C") return s;
        return null;
    },
    choiceMenuLine() {
        return "按实际授权选择：采纳编辑工作稿，保留候选，或拒绝/换模式。兼容 A/B/C；已有授权不重复索取确认，采纳不代表定稿。";
    },
    /**
     * Soft hints after edit_stage — surface uniform_short_run etc. without blocking.
     */
    softHintLines(hits: any) {
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
    afterStageLines(opts: any) {
        const info = EditPort.modeInfo(opts.mode);
        return [
            `编辑候选已暂存：${opts.editCandId}`,
            `- 源写手候选：${opts.parentCandId}`,
            `- 模式：${info.title}（${EditPort.normalizeMode(opts.mode)}）`,
            `- 目标章：${opts.chapterId}`,
            `- 现行工作稿未改；采纳须在授权范围内`,
            ...EditPort.softHintLines(opts.softHits ?? []),
            EditPort.choiceMenuLine(),
            `A：fanqie_candidate_edit_decide(choice=A, confirm_accept_after_edit=true) — 采纳时自动扫描，已有过期扫描凭据须重扫`,
            `B：fanqie_candidate_edit_decide(choice=B) — 稍后 candidate_accept（内置扫描）`,
            `C：fanqie_candidate_edit_decide(choice=C) — 保留写手稿或换 mode 重跑 edit_brief`,
        ];
    },
    /**
     * Accept-path flags for A.
     * - acceptAfterEdit without confirm → hard deny (never silent A)
     * - acceptAfterEdit + confirm but candidate not an edit → deny
     * - no acceptAfterEdit → allow (normal / B accept)
     */
    evaluateAcceptFlags(input: any) {
        const wantA = input.acceptAfterEdit === true;
        const confirmed = input.confirmAcceptAfterEdit === true;
        const isEdit = input.candidateIsEdit === true;
        if (!wantA) {
            if (confirmed) {
                return allow([
                    warn("edit_confirm_ignored", "未声明 accept_after_edit；confirm 被忽略。若要走 A，请同时传 accept_after_edit=true 与 confirm_accept_after_edit=true。"),
                ]);
            }
            return allow([]);
        }
        if (!isEdit) {
            return deny("edit_accept_not_an_edit", "accept_after_edit 仅用于编辑产物（候选带 editOf）。请先 fanqie_candidate_edit_stage，或对普通候选去掉该旗标。");
        }
        if (!confirmed) {
            return deny("edit_accept_confirm_required", "路径 A 须一次显式确认：传 confirm_accept_after_edit=true（确认：采纳本章编辑稿为当前工作稿）。禁止静默验收。");
        }
        return allow([
            info("edit_accept_confirmed", "已确认：采纳编辑稿为当前工作稿（一次确认 = 应用编辑 + accept）"),
        ]);
    },
    /** Receipt extras when A succeeded. */
    acceptPathAReceiptLines() {
        return ["已应用编辑", "已采纳编辑工作稿（路径 A；审读与作者定稿另行核对）"];
    },
    decideChoiceLines(choice: any, opts: any) {
        if (choice === "A") {
            return [
                `路径 A 已就绪候选 ${opts.candId}：带 confirm_accept_after_edit=true 调用 edit_decide 或 candidate_accept(accept_after_edit=true)；采纳内置扫描。`,
            ];
        }
        if (choice === "B") {
            return [
                `路径 B：编辑稿 ${opts.candId} 仅作候选，现行工作稿未改。`,
                "需要采纳时调用 fanqie_candidate_accept（内置扫描）；审读与定稿另行核对。",
                EditPort.choiceMenuLine(),
            ];
        }
        return [
            `路径 C：已拒本次编辑候选 ${opts.candId}。现行工作稿与写手草稿关系不变。`,
            opts.parentId ? `- 写手候选仍可按授权采纳：${opts.parentId}` : "- 可回到写手候选",
            opts.mode
                ? `- 换模式：fanqie_candidate_edit_brief(mode=…) 后重新 edit_stage`
                : `- 换模式：fanqie_candidate_edit_brief 后重新 edit_stage`,
            "未采纳，未改变章节状态。",
        ];
    },
};
