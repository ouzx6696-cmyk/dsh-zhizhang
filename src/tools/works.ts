/** Writing pillar — works, foundation, outline, chapters. */
import { appendLedger, countWords, createWork, ensureStorage, listChapters, listWorks, readChapter, readWorkMeta, resolveWorkDir, setFoundation, setOutline, updateChapter, } from "../lib/store.js";
import { inspectPendingAccept, resumePendingAccept } from "../lib/storage/accept-journal.js";
import { hasPendingChapterSave, inspectPendingChapterSave, resumePendingChapterSave } from "../lib/storage/chapter-journal.js";
import { assertNoInspirationMarker } from "../lib/storage/inspiration-journal.js";
import { firstDenyCode, firstDenyText, FoundationPort, SAVE_BYPASS_WORD_THRESHOLD, SaveBypassGate, Scheduler, } from "../lib/ports/index.js";
import { CHAPTER_STATUSES, } from "../lib/types.js";
import { asString, boolArg, config, fail, openWork, rememberWork } from "./context.js";
import { renderOutline, renderStatus } from "./render.js";
import { B, E, I, OUTLINE_PROPS, S, WORK_OPT, WORKING_DIR } from "./schema.js";
import { defineTool } from "./types.js";
import type { ExecContext } from "./types.js";
export function worksTools() {
    return [
        defineTool({
            name: "zhizhang_project_create",
            description: "创建织章作品目录。默认写作链：chapter_brief(lean)→stage→lint→accept。不生成正文。",
            properties: {
                title: S("作品标题（必填）"),
                genre: S("可选类型"),
                premise: S("可选一句话前提"),
                key: S("可选目录名 slug；默认由标题生成"),
                working_dir: WORKING_DIR,
            },
            required: ["title"],
            async execute(args: any, exec: ExecContext) {
                const title = asString(args, "title", { required: true });
                const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
                const { meta, dir } = await createWork(paths, {
                    title,
                    genre: asString(args, "genre"),
                    premise: asString(args, "premise"),
                    key: asString(args, "key"),
                });
                rememberWork(exec, meta.key);
                return [
                    `已创建作品「${meta.title}」（key=${meta.key}）`,
                    `- 目录：${dir}`,
                    `- 根基/章纲/正文均落本地；AI 不得自动写库`,
                    "",
                    `默认下一步：${Scheduler.nextHint("project_create")}`,
                    "旁路（非默认）：diagnose.audit · finalize.ship · save.direct — 见 zhizhang_product_map",
                ].join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_project_open",
            description: "打开一部作品并记住为本会话当前作品，返回状态摘要。",
            properties: { work: WORK_OPT, working_dir: WORKING_DIR },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const { dir, key, paths } = await openWork(exec, { ...args, work: args.work ?? args.project });
                const meta = await readWorkMeta(dir);
                rememberWork(exec, key);
                return renderStatus(meta, dir, paths);
            },
        }),
        defineTool({
            name: "zhizhang_project_list",
            description: "列出存储根下全部织章作品（key、标题、章节数、字数、更新时间）。",
            properties: { working_dir: WORKING_DIR },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
                const rows = await listWorks(paths);
                if (rows.length === 0)
                    return "还没有作品。用 zhizhang_project_create 创建第一部。";
                return [
                    "作品列表（最近更新在前）：",
                    ...rows.map((w: any, i: number) => {
                        if (w.recoveryPending)
                            return `${i + 1}. ${w.title}（${w.key}）· 操作待恢复；章节与字数暂不可确认。${w.recoveryHint || "请检查恢复记录。"}`;
                        const words = w.chapters.reduce((s: string, c: any) => s + c.wordCount, 0);
                        return `${i + 1}. ${w.title}（${w.key}）· ${w.chapters.length} 章 · 约 ${words} 字 · ${w.updatedAt}`;
                    }),
                ].join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_status",
            description: "查看当前作品状态：根基摘要、章节进度与字数、下一步建议。上下文压缩后先调它恢复现场。",
            properties: { work: WORK_OPT, working_dir: WORKING_DIR, recovery: E(["inspect", "resume"], "采纳中断时：inspect 检查；resume 在校验无冲突后完成原操作（须指定 work）") },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const recovery = asString(args, "recovery");
                if (recovery) {
                    if (recovery !== "inspect" && recovery !== "resume") fail("recovery 只支持 inspect 或 resume");
                    const work = asString(args, "work", { required: true });
                    const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
                    const dir = await resolveWorkDir(paths, work);
                    await assertNoInspirationMarker(dir);
                    if (await hasPendingChapterSave(dir)) {
                        if (recovery === "inspect") {
                            const r = await inspectPendingChapterSave(dir);
                            const label = r.kind === "brief" ? "简报留痕" : r.kind === "payoff" ? "兑付留痕" : r.kind === "lint" ? "扫描留痕" : r.kind === "stage" ? "候选暂存" : "章节保存";
                            return [`${label}恢复记录：${r.id}`, `- 章节 ${r.chapterId || "未指定"}${r.candidateId ? ` · 候选 ${r.candidateId}` : ""} · ${r.createdAt}`,
                                ...r.writes.map(w => `- ${w.file}：${w.state}`),
                                r.conflict ? "发现冲突，请保留文件并人工核对。" : "无文件冲突，可在原操作结束或原进程停止后用 recovery=resume 恢复。"].join("\n");
                        }
                        const r = await resumePendingChapterSave(dir);
                        if (r.kind === "stage") return `已恢复候选 ${r.candidateId} 的暂存；候选正文与元数据已对齐。`;
                        if (r.kind === "lint") return `已恢复候选 ${r.candidateId} 的扫描留痕；凭据与审校账本已对齐。若候选正文已变，请重新扫描。`;
                        return r.kind ? `已恢复${r.kind === "brief" ? "简报" : "兑付"}留痕；记录与审校账本已对齐。` : `已恢复章节 ${r.chapterId} 的保存；正文和作品目录已对齐。`;
                    }
                    if (recovery === "inspect") {
                        const r = await inspectPendingAccept(dir);
                        return [
                            `采纳恢复记录：${r.id}`,
                            `- 章节 ${r.chapterId} · 候选 ${r.candidateId} · 模式 ${r.mode} · ${r.createdAt}`,
                            ...r.writes.map((w) => `- ${w.file}：${w.state}`),
                            ...r.guards.map((g) => `- ${g.file}：${g.state}`),
                            r.conflict ? "发现冲突；不会自动覆盖，请保留文件并人工核对。" : "无文件冲突；同一进程操作结束后或原进程停止后，可传 recovery=resume 完成原操作。",
                        ].join("\n");
                    }
                    const r = await resumePendingAccept(dir);
                    return `已恢复原采纳：候选 ${r.candidateId} → 章节 ${r.chapterId}（${r.mode}）。正文、作品目录、候选标记及留痕已对齐；已有的手写状态未被覆盖，请按需核对。不要重复采纳。`;
                }
                let opened;
                try {
                    opened = await openWork(exec, args);
                }
                catch (err) {
                    // 起步有两条路（先拆书 / 先建作品）——status 是仪表盘，不该在空库时裸报错。
                    if (err instanceof Error && err.message.includes("还没有作品")) {
                        return [
                            "## 尚无作品（起步两条路）",
                            "- 有参考书（推荐）：zhizhang_library_import → library_plan → 拆书 9 步 → combo_suggest → inspire_accept(apply=true) 长出根基/章纲",
                            "- 直接开写：zhizhang_project_create → foundation_set → outline_set → chapter_brief(lean)",
                            "",
                            `下一步（默认）：${Scheduler.nextHint("work_status")}`,
                        ].join("\n");
                    }
                    throw err;
                }
                return renderStatus(await readWorkMeta(opened.dir), opened.dir, opened.paths);
            },
        }),
        defineTool({
            name: "zhizhang_foundation_get",
            description: "读取作品根基（锁定/已发生/人物/读者知情/计划/未结伏笔/文风）。",
            properties: { work: WORK_OPT, working_dir: WORKING_DIR },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const { dir } = await openWork(exec, args);
                const meta = await readWorkMeta(dir);
                const f = meta.foundation;
                return [
                    "## 根基",
                    `- 节奏：${meta.pace || "未指定"}`,
                    `- locks：${f.locks || "（空）"}`,
                    `- happened：${f.happened || "（空）"}`,
                    `- characters：${f.characters || "（空）"}`,
                    `- readerKnowledge：${f.readerKnowledge || "（空）"}`,
                    `- planned：${f.planned || "（空）"}`,
                    `- threads：${f.threads || "（空）"}`,
                    `- style：${f.style || "（空）"}`,
                ].join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_foundation_set",
            description: "部分更新作品根基字段。只改传入的键。定稿后可用它追加 happened / threads。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                locks: S("作者锁定"),
                happened: S("已发生事实"),
                characters: S("人物卡摘要"),
                readerKnowledge: S("读者已知"),
                planned: S("计划中未发生"),
                threads: S("未结伏笔"),
                style: S("全书文风约束"),
                pace: E(["快爽", "稳推", "慢燃"], "可选：本书节奏档位"),
            },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const { dir } = await openWork(exec, args);
                const patch: Record<string, any> = {};
                for (const key of ["locks", "happened", "characters", "readerKnowledge", "planned", "threads", "style"]) {
                    const v = asString(args, key);
                    if (v !== undefined)
                        patch[key] = v;
                }
                const pace = asString(args, "pace");
                if (Object.keys(patch).length === 0 && !pace)
                    fail("至少提供一个根基字段或节奏");
                const meta = await setFoundation(dir, patch, { pace });
                return `已更新「${meta.title}」根基：${[...Object.keys(patch), ...(pace ? ["pace"] : [])].join("、")}`;
            },
        }),
        defineTool({
            name: "zhizhang_foundation_append_happened",
            description: "向根基 happened 追加一句本章后果（短行；按 chapter 去重）；修订后可显式 replace=true 更新该章记录。accept 不覆盖作者已有记录。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                chapter: S("章节 id（用于去重标记）"),
                text: S("一句后果（建议≤200字；通常来自 ending 或作者摘要）"),
                title: S("可选章节标题"),
                replace: B("显式替换该章已有的唯一记录；不改其他章节或作者手写内容"),
            },
            required: ["chapter", "text"],
            async execute(args: any, exec: ExecContext) {
                const chapterId = asString(args, "chapter", { required: true });
                const textLine = asString(args, "text", { required: true });
                const { dir } = await openWork(exec, args);
                const result = await FoundationPort.appendHappened(dir, {
                    chapterId,
                    text: textLine,
                    title: asString(args, "title"),
                    replace: boolArg(args, "replace") === true,
                });
                if (result.replaced) {
                    return `已更新 happened：${result.line}`;
                }
                if (result.appended) {
                    return `已追加 happened：${result.line}`;
                }
                if (result.reason === "already_recorded") {
                    return `未追加（${chapterId} 已在 happened 中）。现有条目与本次相同标记；如需更新请显式传 replace=true。`;
                }
                if (result.reason === "ambiguous_record") {
                    fail(`章节 ${chapterId} 的记录不唯一或嵌在手写段落中，请核对 happened 后用 foundation_set 手动修改。`, "ambiguous_record");
                }
                if (result.reason === "empty_text") {
                    fail("text 不能为空");
                }
                return `未追加（${result.reason ?? "unknown"}）`;
            },
        }),
        defineTool({
            name: "zhizhang_outline_get",
            description: "读取某章章纲（含 situationLens / livedScene / stateLens）。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                chapter: S("章节 id（如 c001）"),
            },
            required: ["chapter"],
            async execute(args: any, exec: ExecContext) {
                const chapterId = asString(args, "chapter", { required: true });
                const { dir } = await openWork(exec, args);
                const ch = await readChapter(dir, chapterId);
                return [`# 章纲 · ${ch.title}（${ch.id}）`, renderOutline(ch.outline)].join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_outline_set",
            description: "写入/合并某章章纲。写前定调：处境透镜、亲历重心、状态透镜。续写章接着前章后果换压力。不生成正文。若章节不存在则创建空章。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                chapter: S("章节 id；不存在则新建"),
                title: S("可选章节标题（新建或改名）"),
                ...OUTLINE_PROPS,
            },
            required: ["chapter"],
            async execute(args: any, exec: ExecContext) {
                const chapterId = asString(args, "chapter", { required: true });
                const { dir } = await openWork(exec, args);
                const patch: Record<string, any> = {};
                for (const key of Object.keys(OUTLINE_PROPS)) {
                    if (args[key] === undefined || args[key] === null)
                        continue;
                    if (key === "targetWords") {
                        if (!Number.isInteger(args.targetWords) || args.targetWords <= 0)
                            fail("targetWords 必须是正整数");
                        patch.targetWords = args.targetWords;
                    }
                    else {
                        const v = asString(args, key);
                        if (v !== undefined)
                            patch[key] = v;
                    }
                }
                // legacy alias voiceTone → stateLens
                if (!patch.stateLens) {
                    const legacy = asString(args, "voiceTone");
                    if (legacy?.trim())
                        patch.stateLens = legacy;
                }
                const saved = await setOutline(dir, chapterId, patch, asString(args, "title"));
                return [`已写入章纲「${saved.title}」`, renderOutline(saved.outline)].join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_chapter_list",
            description: "列出作品章节清单（id、标题、状态、字数）。",
            properties: { work: WORK_OPT, working_dir: WORKING_DIR },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const { dir } = await openWork(exec, args);
                const rows = await listChapters(dir);
                if (rows.length === 0)
                    return "尚无章节。用 zhizhang_outline_set 或 zhizhang_chapter_save 创建。";
                return rows.map((c: any) => `${c.position}. [${c.status}] ${c.title}（${c.id}，${c.wordCount} 字）`).join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_chapter_read",
            description: "读取某章正文与章纲。续写或审校前先取现场。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                chapter: S("章节 id"),
            },
            required: ["chapter"],
            async execute(args: any, exec: ExecContext) {
                const chapterId = asString(args, "chapter", { required: true });
                const { dir } = await openWork(exec, args);
                const ch = await readChapter(dir, chapterId);
                return [
                    `# ${ch.title}（${ch.id}）`,
                    `- 状态：${ch.status} · ${ch.wordCount} 字 · ${ch.updatedAt}`,
                    "",
                    "## 章纲",
                    renderOutline(ch.outline),
                    "",
                    "## 正文",
                    ch.body.trim() ? ch.body : "（空稿）",
                ].join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_chapter_save",
            description: "作者显式落盘或定稿改 status。创作默认请走 candidate 链。大正文（超过旁路字数阈值）须 confirm_bypass=true，否则拒绝。可省略 content 仅改 status/title/position（须章已存在）。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                chapter: S("章节 id；不存在则新建（新建必须带 content）"),
                title: S("章节标题"),
                content: S("完整正文；省略则保留已有正文（仅改 status/title/position）"),
                status: E(CHAPTER_STATUSES, "可选状态"),
                position: I("可选排序位置（从 1）"),
                confirm_bypass: B(`大正文旁路确认：正文超过 ${SAVE_BYPASS_WORD_THRESHOLD} 字直写时必须为 true；短稿/仅改状态可不传`),
            },
            required: ["chapter"],
            async execute(args: any, exec: ExecContext) {
                const chapterId = asString(args, "chapter", { required: true });
                const contentArg = asString(args, "content", { trim: false });
                const confirmBypass = boolArg(args, "confirm_bypass") === true;
                const { dir } = await openWork(exec, args);
                const title = asString(args, "title");
                let bypassNoted = false;
                if (contentArg === undefined) {
                    const metaGate = SaveBypassGate.evaluate({
                        contentProvided: false,
                        wordCount: 0,
                        confirmBypass: false,
                    });
                    if (!metaGate.ok)
                        fail(firstDenyText(metaGate), firstDenyCode(metaGate));
                }
                else {
                    if (!contentArg.trim())
                        fail("content 不能为空；仅改状态请省略 content 参数");
                    const wc = countWords(contentArg);
                    const gate = SaveBypassGate.evaluate({
                        contentProvided: true,
                        wordCount: wc,
                        confirmBypass,
                    });
                    if (!gate.ok)
                        fail(firstDenyText(gate), firstDenyCode(gate));
                    bypassNoted = gate.messages.some((m: any) => m.code === "save_bypass_confirmed");
                }
                const status = asString(args, "status");
                if (status && !CHAPTER_STATUSES.includes(status))
                    fail(`非法 status：${status}`);
                if (args.position !== undefined && (!Number.isInteger(args.position) || args.position < 1))
                    fail("position 必须是从 1 开始的整数");
                const position = typeof args.position === "number" ? args.position : undefined;
                const saved = await updateChapter(dir, {
                    id: chapterId,
                    title,
                    body: contentArg,
                    status,
                    position,
                });
                const bypassTag = bypassNoted ? " confirm_bypass=true" : contentArg === undefined ? " 仅元数据/status" : "";
                await appendLedger(dir, {
                    chapterId: saved.id,
                    kind: "chapter_save_direct",
                    summary: `chapter_save 直写「${saved.title}」${saved.wordCount}字 status=${saved.status}（旁路候选链${bypassTag}，已留痕）`,
                });
                return `已保存「${saved.title}」（${saved.id}）：${saved.wordCount} 字，状态 ${saved.status}。已记 ledger kind=chapter_save_direct${bypassTag}。`;
            },
        }),
    ];
}
