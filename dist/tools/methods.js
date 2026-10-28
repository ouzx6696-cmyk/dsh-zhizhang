/** Shared MethodRegistry tools + chapter_brief (writing entry that injects craft packs). */
import { contextBasis } from "../lib/domain/lifecycle.js";
import { buildPanelHints, readChapter, readWorkMeta, recordBriefBreadcrumb, } from "../lib/store.js";
import { resolvePrevChapter } from "../lib/services/chapter-context.js";
import { formatPlanningBrief } from "../lib/domain/planning.js";
import { InspirationPort, METHOD_ASSET_IDS, MethodRegistry, Scheduler, } from "../lib/ports/index.js";
import { asString, asStringArray, boolArg, fail, openWork } from "./context.js";
import { renderOutline, renderOutlineLean } from "./render.js";
import { B, E, S, WORK_OPT, WORKING_DIR } from "./schema.js";
import { defineTool } from "./types.js";
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
            description: "按 id 拉取创作方法资产全文（Contract 4.0），注入当前上下文。ids 可为逗号分隔或字符串数组；未知 id 会列出但不中断已命中项。",
            properties: {
                ids: { type: "string", description: `资产 id，逗号分隔（也可传字符串数组）。可选：${METHOD_ASSET_IDS.join("、")}` },
                id: S("单个资产 id（与 ids 二选一或并用）"),
            },
            required: [],
            async execute(args) {
                // ids 兼容「逗号分隔字符串」与「字符串数组」两种形态；
                // 此前同时按两种类型硬校验，任何一种传法都会被另一种的校验拒绝。
                const raw = [];
                const idsArg = args?.ids;
                if (typeof idsArg === "string") {
                    raw.push(...idsArg.split(/[,，\s]+/));
                }
                else if (Array.isArray(idsArg)) {
                    raw.push(...idsArg.map((x) => String(x)));
                }
                else if (idsArg !== undefined && idsArg !== null) {
                    fail("参数 ids 必须是字符串（逗号分隔）或字符串数组");
                }
                const idArg = asString(args, "id");
                if (idArg)
                    raw.push(idArg);
                const cleaned = raw.map((s) => s.trim()).filter(Boolean);
                if (cleaned.length === 0) {
                    fail(`请传 ids 或 id。可用：${METHOD_ASSET_IDS.join("、")}。先 zhizhang_method_list 查看说明。`);
                }
                const { found, missing } = MethodRegistry.getMany(cleaned);
                if (found.length === 0) {
                    fail(`未知方法资产：${missing.join("、")}。可用：${METHOD_ASSET_IDS.join("、")}`);
                }
                const parts = found.map((a) => MethodRegistry.formatForAgent(a));
                if (missing.length > 0) {
                    parts.push(`\n（未找到：${missing.join("、")}；已返回其余 ${found.length} 项）`);
                }
                return parts.join("\n\n---\n\n");
            },
        }),
        defineTool({
            name: "zhizhang_chapter_brief",
            description: "【闭环·写作】开写简报。默认 lean：只吃 craft（写法+状态）+ 幕 + 上一章正文（n≥2 全文）+ 毒点 + style_contract；保留关键经历和转向节点，不灌 mind/卡全文。card_ids 可来自 combo。下一步：创作 → candidate_stage → candidate_accept（内置扫描）。",
            properties: {
                chapter: S("章节 id，如 c001（必填）"),
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                brief_mode: E(["lean", "full"], "lean（默认）| full（卡全文+四方法包+节拍）"),
                include_body: B("是否附本章已存正文（默认 false）"),
                extra_assets: S("额外方法资产 id，逗号分隔（lean 默认仅 style_contract）"),
                card_ids: {
                    type: "array",
                    description: "可选：已采纳技法卡 id（可来自 combo_suggest）。省略则用本作品最近 inspire_accept(apply) 绑定的卡；不做按题材猜卡。",
                    items: { type: "string" },
                },
                skip_cards: B("跳过技法卡注入（仅方法包；默认 false）"),
            },
            required: ["chapter"],
            async execute(args, exec) {
                const chapterId = asString(args, "chapter", { required: true });
                const modeRaw = (asString(args, "brief_mode") || "lean").trim().toLowerCase();
                if (modeRaw !== "lean" && modeRaw !== "full")
                    fail("brief_mode 只支持 lean | full", "bad_args");
                const lean = modeRaw !== "full";
                const { paths, dir, key } = await openWork(exec, args);
                const meta = await readWorkMeta(dir);
                let chapter;
                try {
                    chapter = await readChapter(dir, chapterId);
                }
                catch (err) {
                    if (err?.code !== "ENOENT")
                        throw err;
                    fail(`章节不存在：${chapterId}`, "not_found");
                }
                const extraRaw = asString(args, "extra_assets") ?? "";
                const extraIds = extraRaw
                    .split(/[,，\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                const { found, missing } = MethodRegistry.resolveBriefAssets(extraIds, lean ? "lean" : "full");
                const skipCards = boolArg(args, "skip_cards") ?? false;
                let cardSection = "";
                let cardIdsForCrumb = [];
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
                    cardIdsForCrumb = resolved.cardIds.map((id) => `card:${id}`);
                }
                else {
                    cardSection = [
                        lean ? "## 技法卡（lean · 写法+状态）" : "## 拆书库技法卡（写法+状态 · 书感）",
                        "（已 skip_cards=true，本 brief 不注入技法卡）",
                    ].join("\n");
                }
                const f = meta.foundation;
                const o = chapter.outline;
                const includeBody = boolArg(args, "include_body") ?? false;
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
                    if (prev.missing) {
                        contractWarnings.push(`前章 ${prev.meta.id} 已登记但正文文件缺失；请先恢复或核对，不可当作开篇。`);
                    }
                    else if (!previousForContract.ending.trim() && !body) {
                        contractWarnings.push("前章既无 ending 也无正文 — 续写缺少可承接的场面；请先补前章 ending 或正文。");
                    }
                    else if (!previousForContract.ending.trim()) {
                        contractWarnings.push("前章 ending 为空 — 已注入前章正文；可补 outline.ending 作索引。");
                    }
                    else if (!body) {
                        contractWarnings.push("前章正文为空 — 仅有 ending 索引；续写接着该落点换压力往下推。");
                    }
                }
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
                });
                // Assembly order: lean puts craft+state cards early (after contract continuity).
                const lines = [
                    `# 章简报 · ${meta.title} · ${chapter.id} ${chapter.title}`,
                    `- 模式：${lean ? "lean" : "full"} · 状态：${chapter.status} · 已存约 ${chapter.wordCount} 字 · 目标 ${o.targetWords || "（未设）"}`,
                    `- 本书节奏：${meta.pace || "未指定；按作者目标确定"}`,
                    continuation
                        ? "- 续写：通读前章正文后接着往下推，相邻换压力"
                        : "- 开篇：先尝一场小卖点立合同；设定嵌进动作，篇幅跟当场压力走",
                    "",
                ];
                if (Array.isArray(meta.revisionImpacts) && meta.revisionImpacts.length) {
                    const impacts = meta.revisionImpacts.filter((v) => v.chapterId === chapterId || v.nextChapterId === chapterId || v.dependents?.includes(chapterId));
                    if (impacts.length)
                        lines.push("## 修订接续提示", ...impacts.map((v) => `- ${v.chapterId} 正文已修改；请以最新正文核对旧状态、后稿与章纲，系统没有自动改写它们。`), "");
                }
                if (f.style?.trim())
                    lines.push("## 本书有效讲法", f.style.trim(), "");
                if (f.characters?.trim())
                    lines.push("## 作者人物依据", f.characters.trim(), "");
                if (f.readerKnowledge?.trim())
                    lines.push("## 作者记录的读者揭示（不等于人物获知）", f.readerKnowledge.trim(), "");
                const planning = formatPlanningBrief(meta, chapter.id);
                if (planning)
                    lines.push(planning, "");
                if (lean) {
                    // 1) Continuity bone: contract (ending + prev) + poison
                    lines.push(readerContract, "");
                    // 2) Craft+state cards (high leverage) — before outline fat
                    lines.push(cardSection, "");
                    // 3) Situation without beats
                    lines.push("## 本章处境（lean · 必要经历与知识边界）", renderOutlineLean(o), "");
                    // 4) Locks one-liner —— 处境区已含 outline.locks；根基锁只在与章锁不同且非空时补，避免同文双写。
                    if (f.locks?.trim() && f.locks.trim() !== String(o.locks ?? "").trim()) {
                        lines.push("## 锁定（根基）", `- ${f.locks.trim()}`, "");
                    }
                    // 5) Slim method pack
                    lines.push("# 方法（lean · 仅 style_contract；其它用 method_get）");
                    for (const a of found) {
                        lines.push("", MethodRegistry.formatForAgent(a));
                    }
                    lines.push("", `- 默认交稿：${Scheduler.writeLine()}（Accept 内嵌软传感；audit 为旁路）`, `- lean 意向预算 ~${LEAN_BRIEF_BUDGET} 字（不含前章正文）；前章正文另附全文；节拍/卡全文用 outline_get / library_card_get`);
                }
                else {
                    // 简报只读取作品提示，不构建面板视图。
                    const snap = await buildPanelHints(dir);
                    lines.push(readerContract, "");
                    lines.push("## 根基（锁定 / 文风）", `- 锁定：${f.locks || "（空）"}`, `- 文风根基：${f.style || "（空）"}`, "", "## 本章章纲与处境", renderOutline(o), "", "## 下一步提示", `- 默认：${Scheduler.nextHint("chapter_brief")}`, ...snap.nextHints.map((h) => `- ${h}`), "", "## 工程提醒", `- 默认交稿：${Scheduler.writeLine()}`, "- brief.full 为本模式；*_audit / assemble 为旁路", "- lintPassToken 只证明已扫过，不是质量过关");
                    if (includeBody && chapter.body.trim()) {
                        lines.push("", "## 已存正文（只读）", chapter.body.trim());
                    }
                    else if (includeBody) {
                        lines.push("", "## 已存正文", "（空）");
                    }
                    lines.push("", cardSection);
                    lines.push("", "# 创作方法资产（流程纪律；≠ 拆书库人味卡）");
                    for (const a of found) {
                        lines.push("", MethodRegistry.formatForAgent(a));
                    }
                }
                if (lean && includeBody) {
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
                if (prev && !prev.missing)
                    lines.push("", `前稿依据：${prev.meta.id} · ${prev.meta.status === "final" ? "定稿" : "条件工作稿，尚非定稿事实"} · revision=${prev.revision}`);
                if (meta.continuity) {
                    const preceding = [...meta.chapters].filter((c) => c.position < chapter.position).sort((a, b) => a.position - b.position).slice(-3);
                    const selectedIds = new Set([chapterId, ...preceding.map((c) => c.id), ...(chapter.dependencies ?? []).map((d) => d.chapterId)]);
                    const select = (entries) => entries.filter(v => selectedIds.has(v.chapterId));
                    const finalized = select(meta.continuity.finalized), working = select(meta.continuity.working);
                    lines.push("", "## 相关接续索引", `已定稿来源：${JSON.stringify(finalized)}`, `条件工作来源：${JSON.stringify(working)}`, `其余 ${meta.continuity.finalized.length + meta.continuity.working.length - finalized.length - working.length} 条索引未注入；相关早先事实按章纲与实际出处定点补读。`, "索引仅含来源与末尾摘录，不是全书事实台账；旧章没有索引不代表未定稿。人物说法不自动等于客观事实。");
                }
                const basis = contextBasis(meta, chapter, prev && !prev.missing ? { chapterId: prev.meta.id, revision: prev.revision, kind: prev.meta.status === "final" ? "final" : "working" } : undefined);
                const usedIds = [...found.map((a) => a.id), ...cardIdsForCrumb];
                await recordBriefBreadcrumb(dir, { chapterId, assetIds: usedIds, basis });
                lines.push("", `（已留痕 brief-crumbs：${chapterId} · ${usedIds.join(",") || "(none)"} · mode=${lean ? "lean" : "full"}）`);
                return lines.join("\n");
            },
        }),
    ];
}
