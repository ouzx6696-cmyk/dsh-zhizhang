import { assertNoPendingCard } from "../storage/card-journal.js";
import { withResourceLock } from "../storage/process-lock.js";
/** Library pillar — import / dissect / stage / accept / search technique cards. */
import path from "node:path";
import { NovelError } from "../errors.js";
import { inspectPendingCard, resumePendingCard } from "../storage/card-journal.js";
import { hasPendingSource, inspectPendingSource, resumePendingSource } from "../storage/source-journal.js";
import { hasPendingDiscard, inspectPendingDiscard, resumePendingDiscard } from "../storage/discard-journal.js";
import { hasPendingAnalysis, inspectPendingAnalysis, resumePendingAnalysis } from "../storage/analysis-journal.js";
import { hasPendingPlan, inspectPendingPlan, resumePendingPlan } from "../storage/plan-journal.js";
import { stat } from "node:fs/promises";
import {
    LibraryPort,
    coerceAxis,
    formatHumanFeelBlock,
    formatBookCraftBlock,
    formatMindBlock,
    formatHandoffBlock,
    formatModuleBlockV2,
} from "../ports/index.js";
import {
    readAnalysisBundle,
    readSurvey,
    computeCoverage,
    listAnalyses,
    WHITE_DESC_HARD_RE,
    buildPlan,
    estimatePlan,
    planLabel,
    writePlan,
    readPlan,
    makeConfirmToken,
    writePendingConfirm,
    assertFullConsent,
    planProgress,
    chapterText,
    chapterTitle,
    PLAN_RATIO_DEFAULT,
    PLAN_BATCH_DEFAULT,
    PLAN_BATCH_MIN,
    PLAN_BATCH_MAX,
} from "../ports/analysis.js";
import { ensureStorage, listLocalBooks, sessionCwd } from "../store.js";
import { AUTO_SAMPLE_HEAD, AUTO_SAMPLE_RATIO, AUTO_SAMPLE_TAIL } from "../domain/workflow.js";
import { asArray, asString, asStringArray, config, fail } from "./context.js";
import { S, B, E, WORKING_DIR } from "./schema.js";
import { defineTool } from "./types.js";
import type { ExecContext } from "./types.js";
import type { StoragePaths } from "../types.js";
export async function openLibrary(exec: ExecContext, args: any) {
    const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
    await LibraryPort.ensureLibrary(paths);
    return paths;
}
/**
 * Resolve a book file: absolute as-is, relative against the session cwd first,
 * then against the configured local shelf (sourceRoot). Unresolved names fall
 * through so importSource reports its normal file_read_failed.
 */
async function resolveBookFile(paths: StoragePaths, exec: ExecContext, raw: string) {
    if (!raw || path.isAbsolute(raw))
        return raw;
    const cwd = sessionCwd(exec);
    const candidates = [path.resolve(cwd, raw)];
    if (paths.sourceRoot)
        candidates.push(path.resolve(paths.sourceRoot, raw));
    for (const cand of candidates) {
        try {
            if ((await stat(cand)).isFile())
                return cand;
        }
        catch {
            /* try next */
        }
    }
    return raw;
}
export function libraryTools() {
    return [
        defineTool({
            name: "fanqie_library_import",
            description: "【闭环·库 1/9 交书】导入小说原文到拆书库。传 text 或 file（file 可写本地书源目录里的文件名）。不拆书、不写卡。下一步 2/9：library_plan（Auto 10% / Full 须同意）。",
            properties: {
                title: S("书名（必填）"),
                author: S("可选作者"),
                text: S("原文全文（与 file 二选一）"),
                file: S("原文文件路径（相对 cwd / 本地书源 / 绝对路径；与 text 二选一）"),
                reading_range: S("可选：实际阅读范围说明"),
                working_dir: WORKING_DIR,
            },
            required: ["title"],
            async execute(args: any, exec: ExecContext) {
                const title = asString(args, "title", { required: true });
                const paths = await openLibrary(exec, args);
                const fileResolved = await resolveBookFile(paths, exec, asString(args, "file"));
                const result = await LibraryPort.importSource(paths, {
                    title,
                    author: asString(args, "author"),
                    text: asString(args, "text", { trim: false }),
                    file: fileResolved,
                    readingRange: asString(args, "reading_range"),
                    exec,
                });
                return [
                    `已导入「${title}」→ sourceId=${result.sourceId}`,
                    `- 字数：${result.charCount}`,
                    `- 正文：library/sources/${result.excerptPath}`,
                    `- 编码：${result.encoding ?? "utf-8"}${result.converted ? "（已转换）" : ""}`,
                    ...(result.warning ? [`- 注意：${result.warning}`] : []),
                    "",
                    `下一步 2/9：fanqie_library_plan(mode=auto|full) 建抽样计划；Auto 默认 ${Math.round(AUTO_SAMPLE_RATIO * 100)}%`,
                ].join("\n");
            },
        }),
        defineTool({
            name: "fanqie_library_plan",
            description: `【闭环·库 2/9 抽样计划】Auto 默认按字数 ${Math.round(AUTO_SAMPLE_RATIO * 100)}% 分层抽样（前 ${AUTO_SAMPLE_HEAD} 章 + 后 ${AUTO_SAMPLE_TAIL} 章 + 等距）；Full 全量须先看成本回执，再由作者明确同意（confirm_full + confirm_token）。写 analyses/<id>/plan.json + plan.md。`,
            properties: {
                source: S("sourceId（library_import 返回）"),
                mode: { type: "string", enum: ["auto", "full"], description: `auto=${Math.round(AUTO_SAMPLE_RATIO * 100)}% 分层（默认）；full=全量（须作者明确同意）` },
                ratio: { type: "number", description: "Auto 比例（默认 0.1，范围 0.05–1）" },
                batch_chars: { type: "integer", description: "每批字数上限（默认 30000，范围 4000–100000）" },
                confirm_full: B("Full 专用：作者明确同意后才传 true"),
                confirm_token: S("Full 专用：library_plan(mode=full) 回执里的 confirm_token"),
                reset: B("已有计划时重做（覆盖 plan.json）"),
                note: S("Full 同意备注（作者原话/时间）"),
                working_dir: WORKING_DIR,
            },
            required: ["source"],
            async execute(args: any, exec: ExecContext) {
                const sourceId = asString(args, "source", { required: true });
                const paths = await openLibrary(exec, args);
                return withResourceLock(paths.library, async () => {
                await assertNoPendingCard(paths.library);
                const mode = asString(args, "mode") || "auto";
                if (mode !== "auto" && mode !== "full")
                    fail(`mode 只支持 auto | full（收到 ${mode}）`, "bad_args");
                const ratio = typeof args.ratio === "number" ? args.ratio : PLAN_RATIO_DEFAULT;
                // batch_chars 必须是有穷数：Number.NaN 也能通过 typeof === "number"，
                // 夹紧后会得到 NaN，分批比较恒为 false（全书挤成一批）。
                const rawBatch = Number.isFinite(args.batch_chars) ? Number(args.batch_chars) : PLAN_BATCH_DEFAULT;
                const batchChars = Math.max(PLAN_BATCH_MIN, Math.min(PLAN_BATCH_MAX, rawBatch));
                // Keep the current plan until a replacement has actually been confirmed and saved.
                const existing = await readPlan(paths, sourceId);
                if (existing && args.reset !== true && !(mode === "full" && args.confirm_full === true)) {
                    const prog = planProgress(existing, (await readAnalysisBundle(paths, sourceId)).chapters);
                    return [
                        "已有计划：" + planLabel(existing),
                        "- 进度：事实 " + prog.done + "/" + prog.total + " 章 · 游标 " + prog.cursor + "/" + prog.batches,
                        "- 计划文件：library/analyses/" + sourceId + "/plan.md",
                        "要重做或切换档位（Auto↔Full）传 reset=true（会覆盖 plan.json，不删已交事实）。",
                        prog.nextBatch ? "下一步：library_dissect_brief(source, batch=" + prog.cursor + ")" : "计划内章节均已有事实记录；请核对阅读情况后再 structure_stage 聚合。",
                    ].join("\n");
                }
                const src = await LibraryPort.getSourceIndexed(paths, sourceId);
                const idx = src.index;
                const plan = buildPlan({ sourceId, title: src.meta?.title ?? "", index: idx, mode, ratio, batchChars });
                const est = estimatePlan(plan);
                if (plan.mode === "full" && args.confirm_full !== true) {
                    const token = makeConfirmToken();
                    await writePendingConfirm(paths, sourceId, token, est, {
                        batchChars,
                        totalChapters: plan.totalChapters,
                        planChapters: est.chapters,
                    });
                    return [
                        "## Full 成本回执（尚未写入计划）",
                        "- 全书：" + plan.totalChapters + " 章 / " + plan.totalChars + " 字",
                        "- 全量：" + est.chapters + " 章 / " + est.chars + " 字",
                        "- 分批：" + est.batches + " 批（每批 ≤ " + batchChars + " 字）",
                        "- 估算：约 " + est.tokens + " tokens · 顺序约 " + est.hours + " 小时",
                        "- confirm_token：" + token + "（30 分钟有效）",
                        "",
                        "Full 须作者明确同意：请作者回复“确认全量”，再由 Agent 调用",
                        "library_plan(source=\"" + sourceId + "\", mode=\"full\", confirm_full=true, confirm_token=\"" + token + "\", note=\"作者原话…\")",
                        "已保存临时确认凭据；未确认不会替换现有计划或开始全量阅读。",
                    ].join("\n");
                }
                if (plan.mode === "full") {
                    await assertFullConsent(paths, sourceId, asString(args, "confirm_token"), {
                        batchChars,
                        totalChapters: plan.totalChapters,
                        planChapters: est.chapters,
                    });
                    (plan as any).consent = { at: new Date().toISOString(), note: asString(args, "note") || "作者明确要求全量" };
                }
                await writePlan(paths, plan, { clearConfirm: plan.mode === "full", confirmToken: asString(args, "confirm_token") });
                const lines = [
                    "已生成抽样计划：" + planLabel(plan),
                    "- 全书：" + plan.totalChapters + " 章 / " + plan.totalChars + " 字",
                    "- 计划：" + plan.planChapters + " 章 / " + plan.planChars + " 字（" + Math.round((plan.planChars / plan.totalChars) * 100) + "%）",
                    "- 分批：" + est.batches + " 批（每批 ≤ " + batchChars + " 字）",
                    "- 估算：约 " + est.tokens + " tokens · 顺序约 " + est.hours + " 小时",
                    "- 首批：第 " + (plan.batches[0]?.chapters.join("、") ?? "—") + " 章",
                    "- 计划文件：library/analyses/" + sourceId + "/plan.md",
                    "",
                    "下一步 3/9：fanqie_library_dissect_brief(source, batch=0) 取第 0 批；一批一提交，不要跨批跳读。",
                ];
                if (plan.mode === "auto")
                    lines.push("Auto 是抽样：报告里的全书结论会标「抽样观察」；要全书骨架请由作者明确要求 Full。");
                return lines.join("\n");
                });
            },
        }),
        defineTool({
            name: "fanqie_library_dissect_brief",
            description: "【闭环·库 3/9 取批次】有 plan 时按 batch 取本批原文；无 plan 时按 from/count 取。不代写。下一步 4/9：facts_stage 逐章白描。",
            properties: {
                source: S("sourceId（library_import 返回）"),
                mode: { type: "string", enum: ["opening", "chapters", "sample", "full"], description: "批次模式：opening 开篇3章 / chapters 指定起章 / sample 10-30-60-85% / full 从 from 起 3 章" },
                from: { type: "integer", description: "起始章（mode=chapters/full）" },
                count: { type: "integer", description: "本批章数（默认 3，最多 5；无 plan 时用）" },
                batch: { type: "integer", description: "有 plan 时：批号（从 0 起）" },
                max_chars: { type: "integer", description: "摘录/批次上限（默认 12000/15000）" },
                working_dir: WORKING_DIR,
            },
            required: ["source"],
            async execute(args: any, exec: ExecContext) {
                const sourceId = asString(args, "source", { required: true });
                const paths = await openLibrary(exec, args);
                return withResourceLock(paths.library, async () => {
                await assertNoPendingCard(paths.library);
                const plan = await readPlan(paths, sourceId);
                const batchNo = typeof args.batch === "number" ? args.batch : undefined;
                if (plan && batchNo !== undefined) {
                    const b = plan.batches[batchNo];
                    if (!b)
                        fail(`批号越界：0–${plan.batches.length - 1}（${planLabel(plan)}）`, "bad_args");
                    const src = await LibraryPort.getSourceIndexed(paths, sourceId);
                    const idx = src.index;
                    const requestedBudget = typeof args.max_chars === "number" && Number.isFinite(args.max_chars)
                        ? Math.max(1, Math.floor(args.max_chars)) : plan.batchChars;
                    const budget = Math.min(requestedBudget, plan.batchChars);
                    const facts = (await readAnalysisBundle(paths, sourceId)).chapters;
                    const done = new Set(facts.map((f: any) => Number(f.n)));
                    const unfinished = b.chapters.filter((n: number) => !done.has(n));
                    // 重取已完成批次仍可复读；部分完成时优先返回未提交的章节，避免预算较小时反复卡在第一章。
                    const requested = unfinished.length ? unfinished : b.chapters;
                    const parts: string[] = [];
                    const delivered: number[] = [];
                    let used = 0;
                    for (const n of requested) {
                        const t = chapterText(src.text, idx, n);
                        if (!t) throw new NovelError("bad_source", `计划中的第 ${n} 章无法读取；请核对书源和章节索引。`);
                        if (used + t.length > budget && parts.length) break;
                        parts.push("### 第" + n + "章 " + chapterTitle(idx, n), "<<<SOURCE", t, ">>>");
                        delivered.push(n);
                        used += t.length;
                    }
                    const remaining = requested.filter((n: number) => !delivered.includes(n));
                    const prog = planProgress(plan, facts);
                    return [
                        "# 拆书批次 · " + (plan.title || sourceId),
                        "- " + planLabel(plan),
                        "- 本批 " + (batchNo + 1) + "/" + plan.batches.length + " · 计划章节：" + b.chapters.join("、") + " · 约 " + b.chars + " 字",
                        "- 本次实际提供原文：" + (delivered.join("、") || "无") + " · " + used + " 字（提供原文不等于已读或已深读）",
                        ...(remaining.length ? ["- 本批尚未提供：" + remaining.join("、") + "；提交本次事实后可再次取同一批。"] : []),
                        ...(used > budget ? ["- 单章超过本次预算，已完整提供该章以免截断。"] : []),
                        "- 进度：事实 " + prog.done + "/" + prog.total + " 章 · 游标 " + prog.cursor + "/" + prog.batches,
                        "",
                        "【纪律】只记白描：谁做了什么、结果怎样；原文没写的动机/身份/后果写进 unknowns，禁止补。",
                        "【禁】desc 里出现 心里/觉得/认为/希望/害怕/后悔/其实/精彩/感人/震撼 等心理评价词会被拒。",
                        "",
                        ...parts,
                        "",
                        "下一步 4/9：阅读本次提供的原文，再用 fanqie_library_facts_stage 提交已读章节事实；不要替未提供章节补写。",
                    ].join("\n");
                }
                if (plan && batchNo === undefined) {
                    const prog = planProgress(plan, (await readAnalysisBundle(paths, sourceId)).chapters);
                    // 有计划时 mode=full 不生效（全量 scope 只来自 library_plan 的作者同意）——
                    // 但不能静默无视：明确告知 Agent 升级全量的正路，避免它以为在读全量。
                    const fullAsk = asString(args, "mode") === "full";
                    return [
                        "已有计划：" + planLabel(plan),
                        "- 进度：事实 " + prog.done + "/" + prog.total + " 章 · 游标 " + prog.cursor + "/" + prog.batches,
                        "- 下一批：library_dissect_brief(source, batch=" + prog.cursor + ")",
                        prog.nextBatch ? "- 该批章号：" + prog.nextBatch.chapters.join("、") : "- 计划已全部取完",
                        ...(fullAsk
                            ? [
                                "- 注意：当前计划非 Full，mode=full 不会在这里生效；要全量须 library_plan(source, mode=\"full\", reset=true) 生成成本回执并取得作者同意。",
                            ]
                            : []),
                    ].join("\n");
                }
                const maxChars = typeof args.max_chars === "number" ? args.max_chars : undefined;
                const mode = asString(args, "mode");
                const from = typeof args.from === "number" ? args.from : undefined;
                const count = typeof args.count === "number" ? args.count : undefined;
                const brief = await LibraryPort.dissectBrief(paths, sourceId, { maxChars, mode, from, count });
                const next = mode
                    ? "下一步 4/9：按批调用 fanqie_library_facts_stage（每章一条）。白描只写动作与结果；没写的动机进 unknowns。"
                    : "下一步 4/9：fanqie_library_facts_stage。逐章白描（谁做了什么、结果）；没写的动机进 unknowns，禁补。";
                const out = [brief, "", next];
                return out.join(String.fromCharCode(10));
                });
            },
        }),
        defineTool({
            name: "fanqie_library_card_stage",
            description: "【闭环·库 6/9 出卡】暂存卡。v2 模块须 layer+dimension+readerWant/emotionArc/dramaticUnit/replaceables/mustNotCopy/transfer/failWhen+evidence；可选 steps（三步公式）/bannedDiction（反AI腔词表）。旧卡仍走 axis+mechanisms+body。下一步：读软警告 → card_accept。",
            properties: {
                title: S("技法卡标题"),
                source: S("来源 sourceId"),
                body: S("分析正文（markdown）"),
                reading_range: S("实际阅读范围"),
                steps: { type: "array", items: S("一步操作"), description: "可选：三步操作公式（第一步/第二步/第三步），供 brief 直接照做" },
                bannedDiction: { type: "array", items: S("禁用词句"), description: "可选：反AI腔词表（如 恐怖如斯/空气仿佛凝固）" },
                mechanisms: {
                    type: "array",
                    description: "机制数组：[{name,experience,rebuild,discard,failWhen}]",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            name: S("机制名"),
                            experience: S("原文体验/证据"),
                            rebuild: S("如何重建到新作"),
                            discard: S("什么可弃"),
                            failWhen: S("失败边界"),
                        },
                        required: ["name", "failWhen"],
                    },
                },
                human_feel: {
                    type: "object",
                    description: "craft 轴活人证据：{writerCraft, craftRange, characterState, stateOnPage, allowedEdges, failAsTemplate}；旧 voice/realness 可读迁；禁人设墙",
                    additionalProperties: false,
                    properties: {
                        writerCraft: S("作家写法：叙述口吻/场面取舍/信息怎么漏/节奏或小物"),
                        craftRange: S("写法证据出处/阅读范围"),
                        characterState: S("这一刻角色状态（慌/赖皮/在算账…），非声纹"),
                        stateOnPage: S("状态落纸手法（身体/偏题/半截话等），非台词范本"),
                        allowedEdges: S("重造时允许的毛边"),
                        failAsTemplate: S("写成齐整范文腔即失败"),
                        // legacy aliases accepted by normalizeHumanFeel (also listed for discoverability)
                        voice: S("【旧】迁为 stateOnPage；落纸手法证据"),
                        voiceRange: S("【旧】迁为 craftRange"),
                        realness: S("【旧】迁为 writerCraft"),
                    },
                },
                book_craft: {
                    type: "object",
                    description: "craft 续写面（方案A）：{continueWhy, adjacentChange, failAsShortStory}；≠完整创作思维",
                    additionalProperties: false,
                    properties: {
                        continueWhy: S("收束后为何还想翻（过程证据）"),
                        adjacentChange: S("相邻单元变了什么"),
                        failAsShortStory: S("写成独立短篇闭环即失败"),
                    },
                },
                axis: S("硬轴：craft（写作技法→正文）| mind（创作思维→设定/纲）；缺则兼容推断"),
                mind: {
                    type: "object",
                    description: "创作思维（axis=mind 必填）：{sellIntoCost, infoStaging, pressureMachine, debtAndSwap, readerContract, failAsEncyclopedia}",
                    additionalProperties: false,
                    properties: {
                        sellIntoCost: S("卖点如何进能力与代价"),
                        infoStaging: S("信息如何分期交付"),
                        pressureMachine: S("人物关系如何当压力机"),
                        debtAndSwap: S("长线债与换压（章/卷）"),
                        readerContract: S("读者合同如何立"),
                        failAsEncyclopedia: S("写成百科/设定表/梗概即失败"),
                    },
                },
                handoff: {
                    type: "object",
                    description: "可选交接四项：{purpose, experience, rebuild, discard}",
                    additionalProperties: false,
                    properties: {
                        purpose: S("本卡用途"),
                        experience: S("原文体验证据"),
                        rebuild: S("如何迁到新作"),
                        discard: S("必须丢弃的原作剧情/人名"),
                    },
                },
                kind: S("次标签：craft|scene|book（≠axis；axis=mind 才进创作思维轨）"),
                layer: { type: "string", enum: ["book", "arc", "unit", "chapter", "scene", "line"], description: "v2 模块层：book/arc/unit→mind；scene/chapter/line→craft" },
                dimension: { type: "string", enum: ["structure", "character", "rhythm", "hook", "prose", "commercial"], description: "v2 模块维度" },
                readerWant: S("v2：读者想看什么（具体期待/情绪缺口）"),
                emotionArc: S("v2：情绪走向（建立-延迟-触发-兑现-余波）"),
                dramaticUnit: S("v2：戏剧单元（拿掉专名后的功能）"),
                replaceables: { type: "array", items: { type: "string" }, description: "v2：可替换项（身份/场景/道具/目标）" },
                mustNotCopy: { type: "array", items: { type: "string" }, description: "v2：不可照搬（原句/专名/独特事件链）" },
                transfer: S("v2：怎么迁到新作"),
                failWhen: S("v2：失败边界"),
                evidence: { type: "array", items: { type: "object", additionalProperties: false, properties: { quote: S("原文引文"), chapter: S("章号") }, required: ["quote", "chapter"] }, description: "v2：证据 [{quote,chapter}]，accept 前逐条回溯" },
                tags: {
                    type: "array",
                    description: "可选标签",
                    items: { type: "string" },
                },
                working_dir: WORKING_DIR,
            },
            required: ["title", "source", "body", "mechanisms"],
            async execute(args: any, exec: ExecContext) {
                const title = asString(args, "title", { required: true });
                const sourceId = asString(args, "source", { required: true });
                const body = asString(args, "body", { required: true, trim: false });
                asArray(args, "mechanisms", { required: true });
                const tags = asStringArray(args, "tags");
                const humanFeel = args.human_feel && typeof args.human_feel === "object"
                    ? args.human_feel
                    : undefined;
                const bookCraft = args.book_craft && typeof args.book_craft === "object"
                    ? args.book_craft
                    : undefined;
                const handoff = args.handoff && typeof args.handoff === "object"
                    ? args.handoff
                    : undefined;
                const mind = args.mind && typeof args.mind === "object"
                    ? args.mind
                    : undefined;
                const paths = await openLibrary(exec, args);
                const { candId, warnings } = await LibraryPort.stageCard(paths, {
                    title,
                    sourceId,
                    body,
                    readingRange: asString(args, "reading_range"),
                    axis: asString(args, "axis"),
                    mechanisms: args.mechanisms,
                    humanFeel,
                    bookCraft,
                    mind,
                    handoff,
                    kind: asString(args, "kind"),
                    layer: asString(args, "layer"),
                    dimension: asString(args, "dimension"),
                    readerWant: asString(args, "readerWant"),
                    emotionArc: asString(args, "emotionArc"),
                    dramaticUnit: asString(args, "dramaticUnit"),
                    replaceables: asStringArray(args, "replaceables"),
                    mustNotCopy: asStringArray(args, "mustNotCopy"),
                    transfer: asString(args, "transfer"),
                    failWhen: asString(args, "failWhen"),
                    evidence: asArray(args, "evidence"),
                    steps: asStringArray(args, "steps"),
                    bannedDiction: asStringArray(args, "bannedDiction"),
                    tags,
                });
                const lines = [
                    `卡候选已暂存：${candId}`,
                    `- 标题：${title}`,
                    `- 来源：${sourceId}`,
                    `- axis：${asString(args, "axis") || "（推断）"}`,
                    `- 尚未入库；确认后 fanqie_library_card_accept`,
                ];
                if (warnings.length) {
                    lines.push("", "【软警告】");
                    for (const w of warnings)
                        lines.push(`- ${w}`);
                }
                lines.push("", "下一步 7/9：逐条处理上面软警告（「没读」类不能忽略）→ fanqie_library_card_accept(candidate)");
                return lines.join("\n");
            },
        }),
        defineTool({
            name: "fanqie_library_card_accept",
            description: "【闭环·库 7/9 采纳】显式采纳卡入库（v2 校验 5 项 + 证据回溯）。未 accept 不得当已入库。下一步 8/9：library_report → 9/9 combo（audit 为诊断旁路）。",
            properties: {
                candidate: S("候选 id（lcand-…）"),
                working_dir: WORKING_DIR,
            },
            required: ["candidate"],
            async execute(args: any, exec: ExecContext) {
                const candId = asString(args, "candidate", { required: true });
                const paths = await openLibrary(exec, args);
                const { cardId, title, warnings, judgment } = await LibraryPort.acceptCard(paths, candId);
                return [
                    `已采纳技法卡「${title}」→ cardId=${cardId}`,
                    `- 状态：accepted`,
                    `- 可检索：fanqie_library_search / library_card_get`,
                    ...(warnings && warnings.length ? ["", "【入库审计提示】", ...warnings.map((w: any) => `- ${w}`)] : []),
                    ...(judgment && judgment.length ? ["", "【判断面（脚本核不了）】", ...judgment.map((j: any) => `- ${j}`)] : []),
                    "",
                    "下一步 8/9：fanqie_library_report → 9/9 fanqie_library_combo_suggest（library_audit 为诊断旁路：机械面通过≠卡能用，勿例行）",
                ].join("\n");
            },
        }),
        defineTool({
            name: "fanqie_library_list",
            description: "【闭环·库·辅助】列出源与已采纳卡；可按书/轴过滤。主链见 product_map 工作流。",
            properties: {
                what: S("sources | cards | all（默认 all）"),
                source: S("按单本 sourceId 过滤卡"),
                source_ids: {
                    type: "array",
                    description: "按多本 sourceId 过滤卡",
                    items: { type: "string" },
                },
                source_title: S("按书名/作者子串过滤卡"),
                axis: S("craft | mind"),
                recovery: E(["inspect", "resume"], "书源导入、拆书分析、卡采纳或删卡中断时检查或恢复原操作"),
                working_dir: WORKING_DIR,
            },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const recovery = asString(args, "recovery");
                if (recovery) {
                    if (recovery !== "inspect" && recovery !== "resume") fail("recovery 只支持 inspect 或 resume");
                    const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
                    if (await hasPendingSource(paths.library)) {
                        if (recovery === "inspect") {
                            const r = await inspectPendingSource(paths.library);
                            return [`书源导入恢复记录：${r.id}`, `- 书源 ${r.sourceId} · ${r.createdAt}`,
                                ...r.writes.map(w => `- ${w.file}：${w.state}`),
                                ...r.guards.map(g => `- ${g.file}：${g.state}`),
                                r.conflict ? "发现冲突，请保留文件并人工核对。" : "无文件冲突；确认原操作结束或原进程停止后可用 recovery=resume。"].join("\n");
                        }
                        const r = await resumePendingSource(paths.library);
                        return `已恢复书源 ${r.sourceId} 的导入；原文、元数据和索引已对齐，请勿重复导入。`;
                    }
                    if (await hasPendingDiscard(paths.library)) {
                        if (recovery === "inspect") {
                            const r = await inspectPendingDiscard(paths.library);
                            return [`删卡恢复记录：${r.id}`, `- 卡 ${r.cardId} · ${r.createdAt}`,
                                ...r.writes.map(w => `- ${w.file}：${w.state}`),
                                r.conflict ? "发现冲突，请保留文件并人工核对。" : "无文件冲突；确认原操作结束或原进程停止后可用 recovery=resume。"].join("\n");
                        }
                        const r = await resumePendingDiscard(paths.library);
                        return `已恢复卡 ${r.cardId} 的删除，索引与卡文件已对齐。`;
                    }
                    if (await hasPendingAnalysis(paths.library)) {
                        if (recovery === "inspect") {
                            const r = await inspectPendingAnalysis(paths.library);
                            return [`拆书分析恢复记录：${r.id}`, `- 书源 ${r.sourceId} · ${r.dataFile} · ${r.createdAt}`,
                                ...r.writes.map(w => `- ${w.file}：${w.state}`),
                                r.conflict ? "发现冲突，请保留文件并人工核对。" : "无文件冲突；确认原操作结束或原进程停止后可用 recovery=resume。"].join("\n");
                        }
                        const r = await resumePendingAnalysis(paths.library);
                        return `已恢复书源 ${r.sourceId} 的分析更新（${r.dataFile}），分析内容与进度元数据已对齐。`;
                    }
                    if (await hasPendingPlan(paths.library)) {
                        if (recovery === "inspect") {
                            const r = await inspectPendingPlan(paths.library);
                            return [`拆书计划恢复记录：${r.id}`, `- 书源 ${r.sourceId} · ${r.createdAt}`,
                                ...r.writes.map(w => `- ${w.file}：${w.state}`),
                                r.conflict ? "发现冲突，请保留文件并人工核对。" : "无文件冲突；确认原操作结束或原进程停止后可用 recovery=resume。"].join("\n");
                        }
                        const r = await resumePendingPlan(paths.library);
                        return `已恢复书源 ${r.sourceId} 的拆书计划与进度元数据。`;
                    }
                    if (recovery === "inspect") {
                        const r = await inspectPendingCard(paths.library);
                        return [
                            `卡采纳恢复记录：${r.id}`,
                            `- 候选 ${r.candidateId} → 卡 ${r.cardId} · ${r.createdAt}`,
                            ...r.writes.map((w) => `- ${w.file}：${w.state}`),
                            ...r.guards.map((g) => `- ${g.file}：${g.state}`),
                            r.conflict ? "发现冲突；不会自动覆盖，请保留文件并人工核对。" : "无文件冲突；同一进程操作结束后或原进程停止后，可传 recovery=resume 完成原操作。",
                        ].join("\n");
                    }
                    const r = await resumePendingCard(paths.library);
                    return `已恢复原卡采纳：候选 ${r.candidateId} → ${r.cardId}。卡、索引和候选状态已对齐；请阅读卡片并人工判断其可迁移性。不要重复采纳。`;
                }
                const what = (asString(args, "what") ?? "all").toLowerCase();
                const paths = await openLibrary(exec, args);
                const sourceIds = asStringArray(args, "source_ids");
                const axisRaw = asString(args, "axis");
                const axis = axisRaw === "craft" ? "craft" : axisRaw === "mind" ? "mind" : undefined;
                const filter = {
                    status: "accepted",
                    sourceId: asString(args, "source"),
                    sourceIds,
                    sourceTitle: asString(args, "source_title"),
                    axis,
                };
                const lines = ["# 拆书库"];
                if (what === "sources" || what === "all") {
                    const sources = await LibraryPort.listSources(paths);
                    lines.push("## 来源");
                    if (sources.length === 0)
                        lines.push("（空）");
                    else {
                        for (const s of sources) {
                            lines.push(`- ${s.title}${s.author ? ` · ${s.author}` : ""}（${s.id}）`);
                        }
                    }
                }
                if (what === "cards" || what === "all") {
                    const cards = await LibraryPort.listCards(paths, filter);
                    lines.push("## 已采纳卡");
                    if (cards.length === 0)
                        lines.push("（空）");
                    else {
                        for (const c of cards) {
                            lines.push(`- ${c.title}（${c.id}）· axis=${c.axis ?? "?"} · tags=${c.tags.join(",") || "—"} · src=${c.sourceId}`);
                        }
                    }
                }
                const analyses = await listAnalyses(paths);
                if (analyses.length) {
                    lines.push("## 拆书进度");
                    for (const a of analyses) {
                        const p = await readPlan(paths, a.sourceId);
                        const prog = p ? planProgress(p, (await readAnalysisBundle(paths, a.sourceId)).chapters) : null;
                        lines.push(`- ${a.sourceId} · stage=${a.stage} · 事实 ${a.facts}/${a.totalChapters} · 剧情条 ${a.plots}` +
                            (p && prog ? ` · ${planLabel(p)} · 计划进度 ${prog.done}/${prog.total}` : ""));
                    }
                }
                if (paths.sourceRoot) {
                    lines.push(`## 本地书源（${paths.sourceRoot}）`);
                    const local = await listLocalBooks(paths.sourceRoot, { limit: 50 });
                    if (local.length === 0) {
                        lines.push("（目录里没有 .txt / .md 文件）");
                    }
                    else {
                        const all = await LibraryPort.listSources(paths);
                        const titles = new Set(all.map((x: any) => x.title));
                        for (const b of local) {
                            const kb = Math.max(1, Math.round(b.bytes / 1024));
                            lines.push(`- ${b.name} · ${kb} KB · ${titles.has(b.title) ? "已导入" : "未导入"}`);
                        }
                        lines.push('导入：fanqie_library_import { title, file: "<文件名>" }');
                    }
                }
                return lines.join("\n");
            },
        }),
        defineTool({
            name: "fanqie_library_search",
            description: "【闭环·库·辅助】检索已采纳卡（可按书/轴/标签；query 多词=同时满足）。组包走 9/9 combo_suggest。",
            properties: {
                query: S("检索词（与过滤二选一或并用；仅过滤时可空）"),
                source: S("按单本 sourceId"),
                source_ids: {
                    type: "array",
                    description: "按多本 sourceId",
                    items: { type: "string" },
                },
                source_title: S("按书名/作者子串"),
                axis: S("craft | mind"),
                tag: S("按标签精确过滤（如 战斗 / 都市高武 / 信息投放）"),
                working_dir: WORKING_DIR,
            },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const query = asString(args, "query") ?? "";
                const paths = await openLibrary(exec, args);
                const sourceIds = asStringArray(args, "source_ids");
                const axisRaw = asString(args, "axis");
                const axis = axisRaw === "craft" ? "craft" : axisRaw === "mind" ? "mind" : undefined;
                const hits = await LibraryPort.searchCards(paths, query, {
                    sourceId: asString(args, "source"),
                    sourceIds,
                    sourceTitle: asString(args, "source_title"),
                    axis,
                    tag: asString(args, "tag"),
                });
                const tagArg = asString(args, "tag");
                const label = query || (tagArg ? `tag=${tagArg}` : "(仅过滤)");
                if (hits.length === 0)
                    return `无命中：「${label}」`;
                return [
                    `检索「${label}」· ${hits.length} 条：`,
                    ...hits.map((c: any, i: number) => `${i + 1}. ${c.title}（${c.id}）· axis=${c.axis ?? "?"} · src=${c.sourceId} · tags=${c.tags.join(",") || "—"}`),
                ].join("\n");
            },
        }),
        defineTool({
            name: "fanqie_library_audit",
            description: "【闭环·库 8/9 机械面审计】审计已入库卡：证据引文能否在原文核对、正文「声称原文」的引文能否回溯、证据章号是否对得上、readingRange 是否占位、mind 是否疑似设定复述。只诊断，不改卡；机械面通过≠卡能用，判断面须真读。",
            properties: {
                card: S("可选：只审计一张卡（cardId）"),
                source: S("可选：只审计一本书的卡（sourceId）"),
                axis: S("可选：craft | mind"),
                working_dir: WORKING_DIR,
            },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const paths = await openLibrary(exec, args);
                const axisRaw = asString(args, "axis");
                const axis = axisRaw === "craft" ? "craft" : axisRaw === "mind" ? "mind" : undefined;
                const rows = await LibraryPort.auditCards(paths, {
                    cardId: asString(args, "card"),
                    sourceId: asString(args, "source"),
                    axis,
                });
                const cardArg = asString(args, "card");
                if (!rows.length)
                    return cardArg ? `找不到卡：${cardArg}（须为已采纳卡 id）` : "审计范围为空：没有匹配的已采纳卡。";
                const analysisLines = [];
                const srcId = asString(args, "source");
                if (srcId) {
                    const bundle = await readAnalysisBundle(paths, srcId);
                    if (bundle.meta) {
                        const qTotal = rows.reduce((n: number, r: any) => n + (r.evidenceQuotes || 0), 0);
                        const qOk = rows.reduce((n: number, r: any) => n + (r.evidenceVerified || 0), 0);
                        const plan = await readPlan(paths, srcId);
                        const survey = await readSurvey(paths, srcId);
                        const planned = plan ? new Set(plan.chapters.map((c: any) => Number(c.n))) : null;
                        const scopedFacts = planned ? bundle.chapters.filter((f: any) => planned.has(Number(f.n))) : bundle.chapters;
                        const coverage = computeCoverage(bundle.meta, scopedFacts, rows, { total: qTotal, ok: qOk }, {
                            survey,
                            plots: bundle.plots,
                            rhythms: bundle.rhythms,
                            characters: bundle.characters,
                            autoCap: plan?.mode === "auto" && plan.planChapters < (bundle.meta?.totalChapters ?? 0),
                        });
                        let white = 0;
                        for (const f of bundle.chapters) {
                            for (const ev of f.events ?? []) {
                                if (WHITE_DESC_HARD_RE.test(String(ev.desc ?? "")))
                                    white += 1;
                            }
                        }
                        analysisLines.push("", "## 分析层（事实/聚合）");
                        analysisLines.push(`- 事实：${bundle.chapters.length} 章 · 剧情条 ${bundle.plots.length} · 人物 ${bundle.characters.length}`);
                        analysisLines.push(`- 白描违规：${white} 条${white ? "（desc 含心理/评价词，需改写为动作）" : ""}`);
                        analysisLines.push(`- 覆盖：${coverage.facts}/${coverage.scope} · 材料完备度 ${coverage.confidence}（机械指标，非阅读或质量证明）${coverage.needsReview ? " · needs_review" : ""}`);
                        if (plan)
                            analysisLines.push(`- 计划：${planLabel(plan)} · 抽样表见 analyses/${srcId}/plan.md`);
                    }
                }
                const hardBad = rows.filter((r: any) => r.unverifiable.length || r.chapterOk === false || (r.bodyUnverifiable?.length ?? 0) > 0);
                const soft = rows.filter((r: any) => r.warnings.length && !hardBad.includes(r));
                const evOk = rows.filter((r: any) => r.evidenceQuotes > 0 && r.unverifiable.length === 0).length;
                const bodyCards = rows.filter((r: any) => (r.bodyQuotes ?? 0) > 0);
                const bodyOk = bodyCards.filter((r: any) => (r.bodyUnverifiable?.length ?? 0) === 0).length;
                const bodyTotal = bodyCards.reduce((n: number, r: any) => n + r.bodyQuotes, 0);
                const skippedTotal = rows.reduce((a: any, r: any) => a + (r.skippedShort?.length ?? 0), 0);
                const lines = [
                    `拆书库审计 · ${rows.length} 张卡（机械面）`,
                    `- 证据全部可回溯：${evOk}/${rows.length}`,
                    bodyCards.length
                        ? `- 正文引文可回溯：${bodyOk}/${bodyCards.length} 张（共 ${bodyTotal} 条声称引文）`
                        : "- 正文引文：未发现声称原文的正文引文（示例引语不核对）",
                    `- 硬问题：${hardBad.length} · 软警告：${soft.length}`,
                    ...(skippedTotal ? [`- 过短未核对：${skippedTotal} 条（${rows.filter((r: any) => r.skippedShort?.length).length} 张卡）`] : []),
                    ...analysisLines,
                ];
                lines.push("", "判断面（脚本核不了）：机制成不成立 / rebuild 能不能迁移 / mind 是否设定复述——必须真读原文按五条判。");
                if (!hardBad.length && !soft.length) {
                    lines.push("", "机械面通过 ≠ 卡能用。请按每张卡的「检验方法」读一遍原文。");
                    return lines.join("\n");
                }
                for (const r of hardBad) {
                    lines.push("", `· 硬问题：${r.title}（${r.id}）· axis=${r.axis}`);
                    if (r.evidenceQuotes)
                        lines.push(`  证据 ${r.evidenceVerified}/${r.evidenceQuotes} 可核对` + (r.skippedShort?.length ? `（过短跳过 ${r.skippedShort.length} 条）` : ""));
                    for (const q of r.unverifiable.slice(0, 3))
                        lines.push(`  - 未命中：「${q.slice(0, 60)}」`);
                    if ((r.bodyQuotes ?? 0) > 0)
                        lines.push(`  正文引文 ${r.bodyVerified}/${r.bodyQuotes} 可核对` + ((r.bodySkipped ?? 0) > 0 ? `（另 ${r.bodySkipped} 条为示例引语，不核对）` : ""));
                    for (const q of (r.bodyUnverifiable ?? []).slice(0, 3))
                        lines.push(`  - 正文未命中：「${q.slice(0, 60)}」`);
                    for (const w of r.warnings)
                        lines.push(`  - ${w}`);
                }
                for (const r of soft) {
                    lines.push("", `· 软警告：${r.title}（${r.id}）· axis=${r.axis}`);
                    for (const w of r.warnings)
                        lines.push(`  - ${w}`);
                }
                lines.push("", "机械面硬项见上；软警告不阻断，但要在判断面解释清楚。");
                return lines.join("\n");
            },
        }),
        defineTool({
            name: "fanqie_library_combo_suggest",
            description: "【闭环·库 9/9 组包】推荐 1 book + N scene（可跨书）card_ids。下一步：inspire_start(card_ids) 或 chapter_brief(card_ids)。",
            properties: {
                source_ids: {
                    type: "array",
                    description: "限制候选池到来源（可多本；空=全库）",
                    items: { type: "string" },
                },
                source_title: S("书名/作者子串限制候选池"),
                craft_count: {
                    type: "integer",
                    description: "技法张数 N（默认 2，1–8）",
                },
                query: S("主题检索，给 mind/craft 排序"),
                prefer_mind_source: S("优先从该 sourceId 抽 mind"),
                working_dir: WORKING_DIR,
            },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const paths = await openLibrary(exec, args);
                const sourceIds = asStringArray(args, "source_ids");
                const prefer = asString(args, "prefer_mind_source");
                const craftCount = typeof args.craft_count === "number" ? args.craft_count : undefined;
                const queryText = asString(args, "query");
                const result = await LibraryPort.suggestCombo(paths, {
                    sourceIds,
                    sourceTitle: asString(args, "source_title"),
                    craftCount,
                    query: asString(args, "query"),
                    preferMindSourceIds: prefer ? [prefer] : undefined,
                });
                if (!result.ok) {
                    return [
                        "当前没有可用参考卡",
                        `- 原因：${result.emptyReason ?? "未知"}`,
                        "",
                        "可放宽来源过滤，或直接按作者目标规划；不要求先补参考卡",
                    ].join("\n");
                }
                const lines = [
                    "参考组合（优先 mind + craft，缺一轴不阻断）",
                    `- card_ids：${result.cardIds.join(", ")}`,
                    result.mind ? `- mind：${result.mind.title}（${result.mind.id}）· src=${result.mind.sourceId}` : "- mind：无；可按作者材料规划，不强制补卡",
                    ...(queryText ? [`- 主题排序：${queryText}`] : []),
                    `- craft ×${result.crafts.length}：`,
                    ...result.crafts.map((c: any, i: number) => `  ${i + 1}. ${c.title}（${c.id}）· src=${c.sourceId}`),
                    "",
                    "用法：fanqie_inspire_start(card_ids=[...]) 或 fanqie_chapter_brief(card_ids=[...])",
                    "说明：inspire/forge 吃全包（mind 主粮）；lean chapter_brief 只吃其中 craft。",
                ];
                if (result.warnings.length) {
                    lines.push("", "【提示】");
                    for (const w of result.warnings)
                        lines.push(`- ${w}`);
                }
                return lines.join("\n");
            },
        }),
        defineTool({
            name: "fanqie_library_card_get",
            description: "【闭环·库·辅助】读已采纳卡全文（axis + craft/mind 证据）。确认后可 combo 或直接注入 brief。",
            properties: {
                card: S("cardId"),
                working_dir: WORKING_DIR,
            },
            required: ["card"],
            async execute(args: any, exec: ExecContext) {
                const cardId = asString(args, "card", { required: true });
                const paths = await openLibrary(exec, args);
                const card = await LibraryPort.getCard(paths, cardId);
                const axis = coerceAxis(card);
                const mech = card.mechanisms
                    .map((m: any, i: number) => `${i + 1}. ${m.name}\n   体验：${m.experience}\n   重建：${m.rebuild}\n   可弃：${m.discard}\n   失败：${m.failWhen}`)
                    .join("\n");
                const lines = [
                    `# ${card.title}（${card.id}）`,
                    `- axis：${axis}`,
                    `- sourceId：${card.sourceId}`,
                    `- status：${card.status}`,
                    `- kind（次标签）：${card.kind ?? "（未标）"}`,
                    `- tags：${card.tags.join("、") || "（无）"}`,
                    `- readingRange：${card.readingRange}`,
                    "",
                ];
                if (card.schemaVersion === 2 || card.layer) {
                    lines.push("## 模块（v2）", formatModuleBlockV2(card), "");
                }
                const isV2 = card.schemaVersion === 2 || Boolean(card.layer);
                if (!isV2 && axis === "mind") {
                    lines.push("## 创作思维（mind）", formatMindBlock(card.mind), "");
                }
                else if (!isV2) {
                    lines.push("## 活人证据（humanFeel · 写法+状态）", formatHumanFeelBlock(card.humanFeel), "", "## 续写面（bookCraft）", formatBookCraftBlock(card.bookCraft), "");
                }
                lines.push("## handoff", formatHandoffBlock(card.handoff), "");
                lines.push("## 机制", mech || "（无）", "", "## 正文", card.body);
                return lines.join("\n");
            },
        }),
    ];
}
