/** 拆书分析层工具：事实 / 聚合 / 报告 / 删卡。 */
import { LibraryPort } from "../lib/ports/library.js";
import { ZhizhangError } from "../lib/errors.js";
import { analysisPaths, buildReport, chapterText, computeCoverage, ensureAnalysis, ensureSurvey, planLabel, planMembership, planProgress, quoteOk, readAnalysisBundle, readPlan, textStats, toCardView, upsertChapter, upsertPlot, upsertCharacter, writePlan, writeRhythm, } from "../lib/ports/analysis.js";
import { atomicWrite } from "../lib/store.js";
import { REPORT_SECTION_COUNT } from "../lib/domain/report-sections.js";
import { stepPrefix } from "../lib/domain/workflow.js";
import { asArray, asString } from "./context.js";
import { openLibrary } from "./library.js";
import { S, B, WORKING_DIR } from "./schema.js";
import { defineTool } from "./types.js";
/** 引文通过率：逐条回到该章正文核对，而不是「非空即通过」。 */
function quoteStatsOf(facts, text, index) {
    let total = 0;
    let ok = 0;
    for (const f of facts) {
        const body = chapterText(text, index, f.n);
        for (const ev of f.events ?? []) {
            total += 1;
            if (body && quoteOk(ev?.quote, body))
                ok += 1;
        }
    }
    return { total, ok };
}
export function analysisTools() {
    return [
        defineTool({
            name: "zhizhang_library_facts_stage",
            description: `${stepPrefix("library", 4, "事实层")}提交逐章白描事实（谁做了什么、结果；没写的动机进 unknowns）。校验：引文可回溯、desc 无心理/评价词。下一步：structure_stage 聚合。`,
            properties: {
                source: S("sourceId"),
                facts: { type: "object", description: "单章事实：{n,title,events:[{loc,desc,quote}],functions,hook,value,unknowns}" },
                items: { type: "array", items: { type: "object" }, description: "可选：一批单章事实（与 facts 二选一）" },
                working_dir: WORKING_DIR,
            },
            required: ["source"],
            async execute(args, exec) {
                const sourceId = asString(args, "source", { required: true });
                const paths = await openLibrary(exec, args);
                const { text, index: idx } = await LibraryPort.getSourceIndexed(paths, sourceId);
                const itemsArg = asArray(args, "items");
                const raw = itemsArg ?? (args.facts ? [args.facts] : []);
                if (!raw.length)
                    throw new ZhizhangError("bad_args", "传 facts（单章）或 items（多章）");
                const receipts = [];
                for (const f of raw) {
                    const r = await upsertChapter(paths, sourceId, f, text, idx);
                    receipts.push({ n: Number(f.n), warnings: r.warnings, total: r.count });
                }
                const bundle = await readAnalysisBundle(paths, sourceId);
                const coverage = computeCoverage(bundle.meta, bundle.chapters, [], quoteStatsOf(bundle.chapters, text, idx));
                const plan = await readPlan(paths, sourceId);
                let planLine = "";
                let nextLine = "下一步：继续取下一批（dissect_brief mode=chapters）或 zhizhang_library_structure_stage 聚合剧情条/节奏/人物。";
                let coverageLine = "覆盖：" + coverage.facts + "/" + (coverage.scope || bundle.meta?.totalChapters || "?") + " 章";
                if (plan) {
                    const warns = [];
                    for (const r of receipts) {
                        const mem = planMembership(plan, r.n);
                        if (!mem.inPlan)
                            warns.push(mem.reason);
                    }
                    const prog = planProgress(plan, bundle.chapters);
                    if (prog.cursor !== plan.cursor) {
                        plan.cursor = prog.cursor;
                        await writePlan(paths, plan);
                    }
                    coverageLine = "覆盖：" + prog.done + "/" + prog.total + " 章（" + planLabel(plan) + "）";
                    planLine = "计划：事实 " + prog.done + "/" + prog.total + " 章 · 游标 " + prog.cursor + "/" + prog.batches +
                        (warns.length ? "\n- " + warns.join("\n- ") : "");
                    nextLine = prog.nextBatch
                        ? "下一步：zhizhang_library_dissect_brief(source, batch=" + prog.cursor + ") 取下一批；不要跨批跳读。"
                        : "计划已全部取完：zhizhang_library_structure_stage 聚合剧情条/节奏/人物。";
                }
                const lines = [
                    "已记录 " + receipts.length + " 章事实（累计 " + bundle.chapters.length + " 章）",
                    ...receipts.map((r) => "- 第" + r.n + "章：" + (r.warnings.length ? r.warnings.join("；") : "通过")),
                    "",
                    coverageLine,
                    planLine,
                    "",
                    nextLine,
                ];
                return lines.join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_library_structure_stage",
            description: `${stepPrefix("library", 5, "聚合层")}提交剧情条 / 节奏表 / 人物弧光。kind=plot|rhythm|character。剧情条六项齐；节奏含铺垫/释放/反应/衔接。`,
            properties: {
                source: S("sourceId"),
                kind: { type: "string", enum: ["plot", "rhythm", "character"], description: "聚合类型" },
                payload: { type: "object", description: "对应结构的 JSON（plot/rhythm/character）" },
                working_dir: WORKING_DIR,
            },
            required: ["source", "kind", "payload"],
            async execute(args, exec) {
                const sourceId = asString(args, "source", { required: true });
                const kind = asString(args, "kind", { required: true });
                const payload = args.payload ?? {};
                const paths = await openLibrary(exec, args);
                await ensureAnalysis(paths, sourceId, (await LibraryPort.getSource(paths, sourceId)).text);
                if (kind === "plot") {
                    const r = await upsertPlot(paths, sourceId, payload);
                    return `已记录剧情条（共 ${r.count} 条）\n下一步：继续 plot，或 kind=rhythm 记节奏。`;
                }
                if (kind === "rhythm") {
                    const r = await writeRhythm(paths, sourceId, payload);
                    return `已记录节奏表：${r.loops} 条爽点循环${r.warnings.length ? `\n- 提醒：${r.warnings.join("；")}` : ""}\n下一步：kind=character，或 library_report 出报告。`;
                }
                if (kind === "character") {
                    const r = await upsertCharacter(paths, sourceId, payload);
                    return `已记录人物（共 ${r.count} 个）\n下一步：继续 character，或 library_report。`;
                }
                throw new ZhizhangError("bad_args", `kind 必须是 plot|rhythm|character：${kind}`);
            },
        }),
        defineTool({
            name: "zhizhang_library_report",
            description: `${stepPrefix("library", 8, "报告")}把事实/剧情条/节奏/人物/模块确定性拼成 report.md（固定 ${REPORT_SECTION_COUNT} 节），并自动附 L0 量化底座（分卷/高频词/热力/锚点/爽点密度）。不代写分析；覆盖率低会标早期观察。`,
            properties: {
                source: S("sourceId"),
                benchmark: S("可选：对标结论（要求 5 本同站同题材；不填则报告提示未填）"),
                notes: S("可选：备注"),
                working_dir: WORKING_DIR,
            },
            required: ["source"],
            async execute(args, exec) {
                const sourceId = asString(args, "source", { required: true });
                const paths = await openLibrary(exec, args);
                const { meta: srcMeta, text, index: idx } = await LibraryPort.getSourceIndexed(paths, sourceId);
                await ensureAnalysis(paths, sourceId, text);
                const bundle = await readAnalysisBundle(paths, sourceId);
                const rows = await LibraryPort.listCards(paths, { sourceId });
                const modules = [];
                for (const row of rows) {
                    try {
                        modules.push(toCardView(await LibraryPort.getCard(paths, row.id)));
                    }
                    catch {
                        /* skip unreadable card */
                    }
                }
                const v2Count = modules.filter((m) => !m.legacy).length;
                const stats = bundle.chapters
                    .map((f) => {
                    const t = chapterText(text, idx, f.n);
                    return t ? { n: f.n, ...textStats(t) } : null;
                })
                    .filter(Boolean);
                const plan = await readPlan(paths, sourceId);
                const survey = await ensureSurvey(paths, sourceId, text, bundle.chapters, idx);
                const coverage = computeCoverage(bundle.meta, bundle.chapters, modules.filter((m) => !m.legacy), quoteStatsOf(bundle.chapters, text, idx), {
                    survey,
                    plots: bundle.plots,
                    rhythms: bundle.rhythms,
                    characters: bundle.characters,
                    autoCap: plan?.mode === "auto" && plan.planChapters < (bundle.meta?.totalChapters ?? 0),
                });
                const md = buildReport({
                    sourceTitle: srcMeta.title,
                    plan,
                    meta: bundle.meta,
                    facts: bundle.chapters,
                    plots: bundle.plots,
                    rhythms: bundle.rhythms,
                    characters: bundle.characters,
                    modules,
                    coverage,
                    stats,
                    benchmark: asString(args, "benchmark"),
                    notes: asString(args, "notes"),
                    survey,
                });
                const p = analysisPaths(paths, sourceId);
                await atomicWrite(p.report, md);
                // 报告由已提交数据确定性拼装并已落盘；回执只给 12 行结构预览确认，不再整页复述。
                const preview = md.split("\n").slice(0, 12).join("\n");
                return [
                    `报告已写入：library/analyses/${sourceId}/report.md`,
                    `- ${plan ? planLabel(plan) + " · " : ""}事实 ${bundle.chapters.length} 章 · 剧情条 ${bundle.plots.length} · 模块 ${modules.length}（v2 ${v2Count} / v1 ${modules.length - v2Count}）· 置信度 ${coverage.confidence}${coverage.needsReview ? "（needs_review）" : ""}`,
                    "",
                    "预览：",
                    preview,
                    "",
                    "下一步：补足覆盖或模块后重跑；写作用 chapter_brief 注入 craft 模块，灵感用 inspire_start 注入 mind 模块。",
                ].join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_library_card_discard",
            description: "【库·清理】按 id 删卡（文件 + 索引）。confirm=true 才执行。用于撤掉不合格旧卡。",
            properties: {
                card: S("cardId（card-…）"),
                confirm: B("必须 true：确认删除"),
                working_dir: WORKING_DIR,
            },
            required: ["card"],
            async execute(args, exec) {
                const cardId = asString(args, "card", { required: true });
                if (args.confirm !== true)
                    throw new ZhizhangError("confirm_required", "删卡须 confirm=true");
                const paths = await openLibrary(exec, args);
                const r = await LibraryPort.discardCard(paths, cardId);
                return `已删除「${r.title}」（${r.cardId}），剩余 ${r.remaining} 张卡。`;
            },
        }),
    ];
}
