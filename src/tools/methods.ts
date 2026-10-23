/** Shared MethodRegistry tools + chapter_brief (writing entry that injects craft packs). */
import { buildPanelSnapshot, readChapter, readWorkMeta, recordBriefBreadcrumb, } from "../lib/store.js";
import { resolvePrevChapter } from "../lib/services/chapter-context.js";
import { InspirationPort, METHOD_ASSET_IDS, MethodRegistry, Scheduler, } from "../lib/ports/index.js";
import { asString, asStringArray, fail, openWork } from "./context.js";
import { renderOutline, renderOutlineLean } from "./render.js";
import { B, S, WORK_OPT, WORKING_DIR } from "./schema.js";
import { defineTool } from "./types.js";
import type { ExecContext } from "./types.js";
/** Soft budget hint for lean brief (chars); not a hard truncate of model context. */
const LEAN_BRIEF_BUDGET = 2500;
export function methodsTools() {
    return [
        defineTool({
            name: "zhizhang_method_list",
            description: "列出可按需加载的创作方法资产 id 与一句话适用场景（不含全文）。写 plan/draft/review/revise 前用 method_get 或 chapter_brief 拉取正文。",
            properties: {},
            required: [],
            async execute() {
                const rows = MethodRegistry.list();
                const lines = [
                    `# 织章方法资产（AI Contract 4.0 · 按需注入）`,
                    `共 ${rows.length} 项。完整正文用 zhizhang_method_get；开写某章用 zhizhang_chapter_brief（默认 lean）。`,
                    "",
                ];
                for (const r of rows) {
                    lines.push(`- \`${r.id}\` · ${r.title} — ${r.whenToUse}`);
                }
                return lines.join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_method_get",
            description: "按 id 拉取创作方法资产全文（Contract 4.0），注入当前上下文。ids 可为逗号分隔或多次传入；未知 id 会列出但不中断已命中项。",
            properties: {
                ids: S(`资产 id，逗号分隔。可选：${METHOD_ASSET_IDS.join("、")}`),
                id: S("单个资产 id（与 ids 二选一或并用）"),
            },
            required: [],
            async execute(args: any) {
                const raw = [];
                const idsArg = asString(args, "ids");
                const idArg = asString(args, "id");
                if (idsArg)
                    raw.push(...idsArg.split(/[,，\s]+/));
                if (idArg)
                    raw.push(idArg);
                for (const x of asStringArray(args, "ids") ?? [])
                    raw.push(x);
                const cleaned = raw.map((s: string) => s.trim()).filter(Boolean);
                if (cleaned.length === 0) {
                    fail(`请传 ids 或 id。可用：${METHOD_ASSET_IDS.join("、")}。先 zhizhang_method_list 查看说明。`);
                }
                const { found, missing } = MethodRegistry.getMany(cleaned);
                if (found.length === 0) {
                    fail(`未知方法资产：${missing.join("、")}。可用：${METHOD_ASSET_IDS.join("、")}`);
                }
                const parts = found.map((a: any) => MethodRegistry.formatForAgent(a));
                if (missing.length > 0) {
                    parts.push(`\n（未找到：${missing.join("、")}；已返回其余 ${found.length} 项）`);
                }
                return parts.join("\n\n---\n\n");
            },
        }),
        defineTool({
            name: "zhizhang_chapter_brief",
            description: "【闭环·写作】开写简报。默认 lean：只吃 craft（写法+状态）+ 幕 + 上一章正文（n≥2 全文）+ 毒点 + style_contract；不灌 mind/节拍/卡全文。card_ids 可来自 combo。下一步：创作 → candidate_stage → style_lint → candidate_accept。",
            properties: {
                chapter: S("章节 id，如 c001（必填）"),
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                brief_mode: S("lean（默认）| full（卡全文+四方法包+节拍）"),
                include_body: B("是否附本章已存正文（默认 false）"),
                include_prev_tail: B("兼容保留：n≥2 已默认注入前章全文；传 true 无额外效果"),
                extra_assets: S("额外方法资产 id，逗号分隔（lean 默认仅 style_contract）"),
                card_ids: {
                    type: "array",
                    description: "可选：已采纳技法卡 id。省略则尝试本作品最近 inspire_accept(apply) 绑定卡；再按题材检索。",
                    items: { type: "string" },
                },
                skip_cards: B("跳过技法卡注入（仅方法包；默认 false）"),
            },
            required: ["chapter"],
            async execute(args: any, exec: ExecContext) {
                const chapterId = asString(args, "chapter", { required: true });
                const modeRaw = (asString(args, "brief_mode") || "lean").trim().toLowerCase();
                const lean = modeRaw !== "full";
                const { paths, dir, key } = await openWork(exec, args);
                const meta = await readWorkMeta(dir);
                let chapter: any;
                try {
                    chapter = await readChapter(dir, chapterId);
                }
                catch {
                    fail(`章节不存在：${chapterId}`, "not_found");
                }
                const extraRaw = asString(args, "extra_assets") ?? "";
                const extraIds = extraRaw
                    .split(/[,，\s]+/)
                    .map((s: string) => s.trim())
                    .filter(Boolean);
                const { found, missing } = MethodRegistry.resolveBriefAssets(extraIds, lean ? "lean" : "full");
                const skipCards = Boolean(args.skip_cards);
                let cardSection = "";
                let cardIdsForCrumb: string[] = [];
                if (!skipCards) {
                    const explicitIds = asStringArray(args, "card_ids") ?? [];
                    const resolved = await InspirationPort.resolveCardsForBrief(paths, {
                        cardIds: explicitIds,
                        workKey: key,
                        limit: lean ? 3 : 5,
                    });
                    cardSection = InspirationPort.formatCardsSection(resolved.cards, {
                        source: resolved.source,
                        note: resolved.note,
                        lean,
                    });
                    cardIdsForCrumb = resolved.cardIds.map((id: string) => `card:${id}`);
                }
                else {
                    cardSection = [
                        lean ? "## 技法卡（lean · 写法+状态）" : "## 拆书库技法卡（写法+状态 · 书感）",
                        "（已 skip_cards=true，本 brief 不注入技法卡）",
                    ].join("\n");
                }
                const f = meta.foundation;
                const o = chapter.outline;
                let previousForContract = null;
                let continuation = false;
                const contractWarnings = [];
                const prev = await resolvePrevChapter(dir, chapter.id);
                if (prev && prev.meta.id !== chapter.id) {
                    continuation = true;
                    const body = (prev.body || "").trim();
                    const prevOutline = prev.outline ?? {};
                    const summaryParts = [
                        prevOutline.situationLens?.trim()
                            ? `处境=${prevOutline.situationLens.trim()}`
                            : "",
                        prevOutline.livedScene?.trim()
                            ? `亲历=${prevOutline.livedScene.trim()}`
                            : "",
                    ].filter(Boolean);
                    previousForContract = {
                        id: prev.meta.id,
                        title: prev.meta.title ?? prev.meta.id,
                        ending: prevOutline.ending || "",
                        summary: lean
                            ? undefined
                            : summaryParts.length
                                ? summaryParts.join("；")
                                : undefined,
                        // n≥2: inject previous chapter body in full (soft-cap inside formatReaderContract)
                        body: body.length > 0 ? body : undefined,
                    };
                    if (!previousForContract.ending.trim() && !body) {
                        contractWarnings.push("前章既无 ending 也无正文 — 续写缺少可承接的场面；请先补前章 ending 或正文。");
                    }
                    else if (!previousForContract.ending.trim()) {
                        contractWarnings.push("前章 ending 为空 — 已注入前章正文；可补 outline.ending 作索引。");
                    }
                    else if (!body) {
                        contractWarnings.push("前章正文为空 — 仅有 ending 索引；续写接着该落点换压力往下推。");
                    }
                }
                const includePrevTail = Boolean(args.include_prev_tail);
                const readerContract = MethodRegistry.formatReaderContract({
                    premise: meta.premise || "",
                    planned: f.planned || "",
                    threads: f.threads || "",
                    happened: f.happened || "",
                    chapterEnding: o.ending || "",
                    previous: previousForContract,
                    continuation,
                    warnings: contractWarnings,
                    lean,
                    includePrevTail,
                });
                // Assembly order: lean puts craft+state cards early (after contract continuity).
                const lines = [
                    `# 章简报 · ${meta.title} · ${chapter.id} ${chapter.title}`,
                    `- 模式：${lean ? "lean" : "full"} · 状态：${chapter.status} · 已存约 ${chapter.wordCount} 字 · 目标 ${o.targetWords || "（未设）"}`,
                    continuation
                        ? "- 续写：通读前章正文后接着往下推，相邻换压力"
                        : "- 开篇：先尝一场小卖点立合同；设定嵌进动作，篇幅跟当场压力走",
                    "",
                ];
                if (lean) {
                    // 1) Continuity bone: contract (ending + prev) + poison
                    lines.push(readerContract, "");
                    // 2) Craft+state cards (high leverage) — before outline fat
                    lines.push(cardSection, "");
                    // 3) Situation without beats
                    lines.push("## 本章处境（lean · 无节拍分镜）", renderOutlineLean(o), "");
                    // 4) Locks one-liner
                    if (f.locks?.trim()) {
                        lines.push("## 锁定", `- ${f.locks.trim()}`, "");
                    }
                    // 5) Slim method pack
                    lines.push("# 方法（lean · 仅 style_contract；其它用 method_get）");
                    for (const a of found) {
                        lines.push("", MethodRegistry.formatForAgent(a));
                    }
                    lines.push("", `- 默认交稿：${Scheduler.writeLine()}（Accept 内嵌软传感；audit 为旁路）`, `- lean 意向预算 ~${LEAN_BRIEF_BUDGET} 字（不含前章正文）；前章正文另附全文；节拍/卡全文用 outline_get / library_card_get`);
                }
                else {
                    const snap = await buildPanelSnapshot(dir, paths);
                    lines.push(readerContract, "");
                    lines.push("## 根基（锁定 / 文风）", `- 锁定：${f.locks || "（空）"}`, `- 文风根基：${f.style || "（空）"}`, "", "## 本章章纲与处境", renderOutline(o), "", "## 下一步提示", `- 默认：${Scheduler.nextHint("chapter_brief")}`, ...snap.nextHints.map((h: any) => `- ${h}`), "", "## 工程提醒", `- 默认交稿：${Scheduler.writeLine()}`, "- brief.full 为本模式；*_audit / assemble 为旁路", "- lintPassToken 只证明已扫过，不是质量过关");
                    if (Boolean(args.include_body) && chapter.body.trim()) {
                        lines.push("", "## 已存正文（只读）", chapter.body.trim());
                    }
                    else if (Boolean(args.include_body)) {
                        lines.push("", "## 已存正文", "（空）");
                    }
                    lines.push("", cardSection);
                    lines.push("", "# 创作方法资产（流程纪律；≠ 拆书库人味卡）");
                    for (const a of found) {
                        lines.push("", MethodRegistry.formatForAgent(a));
                    }
                }
                if (lean && Boolean(args.include_body)) {
                    if (chapter.body.trim()) {
                        lines.push("", "## 已存正文（只读）", chapter.body.trim());
                    }
                    else {
                        lines.push("", "## 已存正文", "（空）");
                    }
                }
                if (missing.length > 0) {
                    lines.push("", `（额外资产未找到：${missing.join("、")}）`);
                }
                const usedIds = [...found.map((a: any) => a.id), ...cardIdsForCrumb];
                await recordBriefBreadcrumb(dir, { chapterId, assetIds: usedIds });
                lines.push("", `（已留痕 brief-crumbs：${chapterId} · ${usedIds.join(",") || "(none)"} · mode=${lean ? "lean" : "full"}）`);
                return lines.join("\n");
            },
        }),
    ];
}
