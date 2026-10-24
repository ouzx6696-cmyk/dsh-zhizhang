/** Writing pillar — works, foundation, outline, chapters. */
import { appendLedger, countWords, createWork, ensureStorage, listChapters, listWorks, readChapter, readWorkMeta, saveChapter, setFoundation, } from "../lib/store.js";
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
                        const words = w.chapters.reduce((s: string, c: any) => s + c.wordCount, 0);
                        return `${i + 1}. ${w.title}（${w.key}）· ${w.chapters.length} 章 · 约 ${words} 字 · ${w.updatedAt}`;
                    }),
                ].join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_status",
            description: "查看当前作品状态：根基摘要、章节进度与字数、下一步建议。上下文压缩后先调它恢复现场。",
            properties: { work: WORK_OPT, working_dir: WORKING_DIR },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const { dir, paths } = await openWork(exec, args);
                return renderStatus(await readWorkMeta(dir), dir, paths);
            },
        }),
        defineTool({
            name: "zhizhang_foundation_get",
            description: "读取作品根基（锁定/已发生/人物/读者知情/计划/未结伏笔/文风）。",
            properties: { work: WORK_OPT, working_dir: WORKING_DIR },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const { dir } = await openWork(exec, args);
                const f = (await readWorkMeta(dir)).foundation;
                return [
                    "## 根基",
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
                if (Object.keys(patch).length === 0)
                    fail("至少提供一个根基字段");
                const meta = await setFoundation(dir, patch);
                return `已更新「${meta.title}」根基：${Object.keys(patch).join("、")}`;
            },
        }),
        defineTool({
            name: "zhizhang_foundation_append_happened",
            description: "向根基 happened 追加一句本章后果（短行；按 chapter 去重）。accept 已会用 ending 自动短追加；本工具用于精修或 ending 为空时补记。不杜撰长文。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                chapter: S("章节 id（用于去重标记）"),
                text: S("一句后果（建议≤200字；通常来自 ending 或作者摘要）"),
                title: S("可选章节标题"),
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
                });
                if (result.appended) {
                    return `已追加 happened：${result.line}`;
                }
                if (result.reason === "already_recorded") {
                    return `未追加（${chapterId} 已在 happened 中）。现有条目与本次相同标记；若需改写请用 zhizhang_foundation_set 覆盖 happened 全文。`;
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
                let title = asString(args, "title");
                let body = "";
                let position;
                let status;
                try {
                    const existing = await readChapter(dir, chapterId);
                    title = title ?? existing.title;
                    body = existing.body;
                    position = existing.position;
                    status = existing.status;
                    Object.assign(patch, { ...existing.outline, ...patch });
                }
                catch (err) {
                    // 只有「章文件不存在」才建新章；front matter 坏了必须报错，不能覆盖原稿。
                    if ((err as any)?.code !== "ENOENT")
                        throw err;
                    title = title ?? chapterId;
                    status = "planned";
                }
                const saved = await saveChapter(dir, {
                    id: chapterId,
                    title: title,
                    body,
                    position,
                    status,
                    outline: patch,
                });
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
                let title = asString(args, "title");
                let outline;
                let prevBody;
                let prevExists = false;
                try {
                    const prev = await readChapter(dir, chapterId);
                    prevExists = true;
                    prevBody = prev.body;
                    title = title ?? prev.title;
                    outline = prev.outline;
                }
                catch (err) {
                    if ((err as any)?.code !== "ENOENT")
                        throw err;
                    title = title ?? chapterId;
                }
                let body;
                let bypassNoted = false;
                if (contentArg === undefined) {
                    if (!prevExists)
                        fail("新建章节必须提供 content", "bad_args");
                    body = prevBody ?? "";
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
                    body = contentArg;
                    const wc = countWords(body);
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
                const saved = await saveChapter(dir, {
                    id: chapterId,
                    title: title,
                    body,
                    status,
                    position,
                    outline,
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
