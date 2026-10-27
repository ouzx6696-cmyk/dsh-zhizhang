/**
 * LibraryPort — 拆书库支柱（live）。
 * User submits a novel → dissect brief → AI stages cards → explicit accept → searchable.
 * 0.7.0 双轴：axis=craft|mind。craft→正文 brief；mind→inspire 设定/章纲。
 * Technique cards ≠ MethodRegistry. 拒收百科/梗概/声纹/人设墙。
 * 兼容：旧卡无 axis 时按 humanFeel/mind 推断；kind 降为次标签。
 */
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
import { assertNoPendingCard, createCardJournal, finishCardJournal } from "../storage/card-journal.js";
import { createSourceJournal, finishSourceJournal } from "../storage/source-journal.js";
import { createDiscardJournal, finishDiscardJournal } from "../storage/discard-journal.js";
import { snapshotFile } from "../storage/recovery-common.js";
import { withResourceLock } from "../storage/process-lock.js";
import { atomicWrite, assertResourceId, sessionCwd, } from "../work-store.js";
import { readJsonCached } from "../file-cache.js";
import { MethodRegistry } from "./methods.js";
import { parseChapterNumber } from "../domain/chapter-heading.js";
import { REPORT_SECTION_COUNT } from "../domain/report-sections.js";
import { QualityPolicy } from "./quality-policy.js";
import type { StoragePaths } from "../types.js";
import {
    chapterIndex,
    chapterText,
    chapterTitle,
    nearestChapter,
    totalChapters,
    ensureAnalysis,
    writeAnalysisMeta,
    readAnalysisBundle,
    deriveAxis,
    validateModule,
    verifyModuleEvidence,
    verifyBodyQuotes,
    assertSourceId,
} from "./analysis.js";
import {
    normalizeMechanism,
    normalizeHumanFeel,
    normalizeBookCraft,
    normalizeHandoff,
    normalizeKind,
    normalizeAxis,
    coerceAxis,
    normalizeMind,
    warnCharacterStateWall,
    readingArtifactWarnings,
    admitCardContent,
} from "./library/schema.js";
import { auditCardContent, normForMatch } from "./library/audit.js";
import {
    nowIso,
    newId,
    fileExists,
    libraryDirs,
    emptyIndex,
    readIndex,
    filterCardRows,
    comboScore,
    decodeBookBuffer,
    normalizeUserPath,
    tokenizeQuery,
    cardDeepHay,
    reconcileIndex,
} from "./library/store.js";
export * from "./library/schema.js";
export { auditCardContent, normForMatch } from "./library/audit.js";
// —— § 拆书源缓存（文本 + 章索引派生） ——
// 轮询与阅读复用源文本缓存；证据校验单独读取源文件字节，不把缓存当完整性证明。
const SOURCE_CACHE_MAX = 6;
interface SourceCacheEntry {
    mtimeMs: number;
    ctimeMs: number;
    ino: number;
    size: number;
    meta: any;
    text: string;
    index?: any[];
}
const sourceCache = new Map<string, SourceCacheEntry>();
async function getSourceCached(paths: StoragePaths, sourceId: any) {
    const id = assertSourceId(sourceId);
    await LibraryPort.ensureLibrary(paths);
    const d = libraryDirs(paths);
    const metaPath = path.join(d.sources, `${id}.json`);
    if (!(await fileExists(metaPath))) {
        throw new ZhizhangError("source_not_found", `找不到来源 ${id}`);
    }
    const meta = await readJsonCached(metaPath);
    // excerptPath 来自磁盘元数据，仍须是 sources/ 下的单段文件名：
    // 不能让一个被改坏的 meta 把读取路径带出沙箱。
    const excerptName = typeof meta.excerptPath === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._-]*\.txt$/.test(meta.excerptPath)
        ? meta.excerptPath
        : `${id}.txt`;
    const textPath = path.join(d.sources, excerptName);
    let st;
    try {
        st = await stat(textPath);
    }
    catch (err: any) {
        if (err?.code === "ENOENT") throw new ZhizhangError("source_not_found", `书源正文缺失：${id}；请检查并保留已有文件。`);
        throw err;
    }
    const hit = sourceCache.get(textPath);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.ctimeMs === st.ctimeMs && hit.ino === st.ino && hit.size === st.size) {
        // meta 与文本同目录同生命周期；命中时顺带刷新缓存里的 meta 引用。
        hit.meta = meta;
        return { meta, text: hit.text, entry: hit };
    }
    const text = await readFile(textPath, "utf8");
    const after = await stat(textPath);
    if (st.mtimeMs !== after.mtimeMs || st.ctimeMs !== after.ctimeMs || st.ino !== after.ino || st.size !== after.size)
        throw new ZhizhangError("source_changed", `书源 ${id} 在读取期间发生变化；请重新核对后再试。`);
    const entry: SourceCacheEntry = { mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs, ino: after.ino, size: after.size, meta, text };
    sourceCache.delete(textPath);
    if (text.length * 2 <= 64 * 1024 * 1024) sourceCache.set(textPath, entry);
    while (sourceCache.size > SOURCE_CACHE_MAX || [...sourceCache.values()].reduce((n, v) => n + v.text.length * 2, 0) > 64 * 1024 * 1024) {
        const oldest = sourceCache.keys().next().value;
        if (oldest !== undefined)
            sourceCache.delete(oldest);
    }
    return { meta, text, entry };
}
/** Evidence decisions always re-read source bytes; polling caches are not integrity proofs. */
async function readSourceForEvidence(paths: StoragePaths, sourceId: string) {
    const id = assertSourceId(sourceId);
    const d = libraryDirs(paths);
    const metaBytes = await readFile(path.join(d.sources, `${id}.json`));
    const meta = JSON.parse(metaBytes.toString("utf8"));
    const excerptName = typeof meta.excerptPath === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*\.txt$/.test(meta.excerptPath)
        ? meta.excerptPath : `${id}.txt`;
    const bytes = await readFile(path.join(d.sources, excerptName));
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new ZhizhangError("bad_source", "书源不是有效 UTF-8，无法安全核对引文；请保留原文件并检查。"); }
    return {
        text, index: chapterIndex(text), sourceId: id, sourceFile: excerptName,
        sourceHash: createHash("sha256").update(bytes).digest("hex"),
        metaHash: createHash("sha256").update(metaBytes).digest("hex"),
    };
}
/** 章索引按需派生一次，挂在缓存条目上；同一本书的多张卡共用。 */
function sourceIndexOf(entry: SourceCacheEntry | null, text: string = "") {
    if (!entry)
        return chapterIndex(text);
    if (!entry.index)
        entry.index = chapterIndex(entry.text);
    return entry.index;
}
export const LibraryPort = {
    id: "port.library",
    status: "live",
    title: "拆书库",
    summary: "闭环第1段：交书→plan（auto 10% / full 须同意）→dissect（批次）→facts（白描）→structure（剧情/节奏/人物）→card（v2 模块）→accept→report→combo。book 交灵感；scene 交写作。验收=真读原文（脚本只核字段与字面引文）。≠ MethodRegistry。",
    capabilities() {
        return [
            { id: "import_source", title: "导入小说原文", ready: true },
            { id: "plan", title: "抽样计划（Auto 10% 分层 / Full 须同意）", ready: true },
            { id: "dissect", title: "拆书批次（原文 + 事实模板）", ready: true },
            { id: "facts", title: "逐章事实（白描，禁补动机）", ready: true },
            { id: "structure", title: "聚合：剧情条 / 节奏 / 人物", ready: true },
            { id: "card_stage", title: "暂存模块卡（层/维度 + 5 项 + 证据）", ready: true },
            { id: "card_accept", title: "显式采纳入库", ready: true },
            { id: "card_search", title: "检索卡（按书/按轴/主题）", ready: true },
            { id: "card_get", title: "读取卡全文", ready: true },
            { id: "card_combo", title: "组合包：1 book + N scene（可跨书）", ready: true },
            { id: "report", title: `拆书报告（${REPORT_SECTION_COUNT} 节，确定性拼装）`, ready: true },
            { id: "card_audit", title: "审计：引文回溯 / 白描违规 / 覆盖率", ready: true },
        ];
    },
    async ensureLibrary(paths: StoragePaths) {
        await mkdir(paths.library, { recursive: true });
        return withResourceLock(paths.library, async () => {
        const d = libraryDirs(paths);
        await assertNoPendingCard(paths.library);
        await mkdir(d.sources, { recursive: true });
        await mkdir(d.cards, { recursive: true });
        await mkdir(d.candidates, { recursive: true });
        if (!(await fileExists(d.index))) {
            const managed = [d.sources, d.cards, d.candidates, path.join(d.root, "analyses")];
            const contents = await Promise.all(managed.map(async (dir) => {
                try { return await readdir(dir); }
                catch (err: any) { if (err?.code === "ENOENT") return []; throw err; }
            }));
            if (contents.some((items) => items.length > 0) && !(await fileExists(d.index)))
                throw new ZhizhangError("library_index_missing", "拆书库索引缺失但目录中仍有资产；请保留原文件并检查，不自动创建空索引。");
            // Publish a complete initial index without replacing a concurrent creator's file.
            const tmp = `${d.index}.${randomUUID()}.init.tmp`;
            try {
                const handle = await open(tmp, "wx", 0o600);
                try { await handle.writeFile(JSON.stringify(await emptyIndex(), null, 2) + "\n", "utf8"); await handle.sync(); }
                finally { await handle.close(); }
                try { await link(tmp, d.index); }
                catch (err: any) { if (err?.code !== "EEXIST") throw err; }
            }
            finally { await unlink(tmp).catch(() => {}); }
        }
        await reconcileIndex(paths);
        return paths;
        });
    },
    async importSource(paths: StoragePaths, input: any) {
        await LibraryPort.ensureLibrary(paths);
        const title = String(input.title ?? "").trim();
        if (!title)
            throw new ZhizhangError("bad_args", "title 不能为空");
        let text = input.text ?? "";
        let encoding = "utf8";
        let converted = false;
        if ((!text || !String(text).trim()) && input.file) {
            const cwd = sessionCwd(input.exec);
            const raw = normalizeUserPath(String(input.file));
            const filePath = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
            let buf;
            try {
                buf = await readFile(filePath);
            }
            catch {
                throw new ZhizhangError("file_read_failed", `无法读取文件：${input.file}（已尝试路径：${filePath}）`);
            }
            const decoded = decodeBookBuffer(buf);
            text = decoded.text;
            encoding = decoded.encoding;
            converted = decoded.converted;
        }
        text = String(text ?? "");
        if (!text.trim())
            throw new ZhizhangError("empty_body", "导入正文不能为空（传 text 或 file）");
        const sourceId = newId("src");
        const d = libraryDirs(paths);
        const excerptPath = path.join(d.sources, `${sourceId}.txt`);
        const metaPath = path.join(d.sources, `${sourceId}.json`);
        const now = nowIso();
        const meta = {
            schemaVersion: 1,
            id: sourceId,
            title,
            author: String(input.author ?? "").trim(),
            readingRange: String(input.readingRange ?? "").trim() || "全文（已导入）",
            excerptPath: `${sourceId}.txt`,
            charCount: text.length,
            encoding,
            createdAt: now,
            updatedAt: now,
        };
        await withResourceLock(paths.library, async () => {
            const indexBefore = await snapshotFile(d.index);
            if (!indexBefore) throw new ZhizhangError("library_index_missing", "拆书库索引缺失，请先检查原文件。");
            const idx = await readIndex(paths);
            if (await snapshotFile(d.index) !== indexBefore)
                throw new ZhizhangError("library_recovery_conflict", "拆书库索引在导入准备期间变化，请重新检查。");
            if (await snapshotFile(excerptPath) !== null || await snapshotFile(metaPath) !== null)
                throw new ZhizhangError("id_collision", "生成的书源 id 已存在；未覆盖原文件，请重新尝试。");
            idx.sources.unshift({ id: sourceId, title: meta.title, author: meta.author, createdAt: now });
            const journal = await createSourceJournal(paths.library, { sourceId, text, metaContent: JSON.stringify(meta, null, 2) + "\n", indexBefore, indexContent: JSON.stringify(idx, null, 2) + "\n" });
            try {
                await finishSourceJournal(paths.library, journal);
            }
            catch (err: any) {
                if (err instanceof ZhizhangError) throw err;
                throw new ZhizhangError("library_recovery_required", `书源 ${sourceId} 导入未完成（${err?.message ?? String(err)}）。请用 zhizhang_library_list(recovery=inspect) 检查，不要重复导入。`);
            }
        });
        return {
            sourceId,
            charCount: text.length,
            encoding,
            converted,
            excerptPath: meta.excerptPath,
            warning: converted && encoding !== "utf-8"
                ? `文件不是 UTF-8，已按 ${encoding} 解码（原文件若为乱码请检查编码）`
                : undefined,
        };
    },
    async getSource(paths: StoragePaths, sourceId: any) {
        const cached = await getSourceCached(paths, sourceId);
        return { meta: cached.meta, text: cached.text };
    },
    /**
     * getSource + 已解析的章索引。整本书（可能数 MB）此前在 dissect / 卡
     * stage / accept / audit 里被反复整读 + 全文正则重扫；这里按文本文件
     * mtime+size 缓存文本与章索引，未变时全部命中。
     */
    async getSourceIndexed(paths: StoragePaths, sourceId: any) {
        const cached = await getSourceCached(paths, sourceId);
        return { meta: cached.meta, text: cached.text, index: sourceIndexOf(cached.entry, cached.text) };
    },
    async listSources(paths: StoragePaths) {
        await LibraryPort.ensureLibrary(paths);
        return (await readIndex(paths)).sources;
    },
    async dissectBrief(paths: StoragePaths, sourceId: any, opts: any = {}) {
        return withResourceLock(paths.library, async () => {
        await assertNoPendingCard(paths.library);
        const { meta, text, index: idx } = await LibraryPort.getSourceIndexed(paths, sourceId);
        const mode = String(opts.mode ?? "").trim();
        if (mode) {
            const total = totalChapters(idx);
            await ensureAnalysis(paths, sourceId, text);
            const prevScope = (await readAnalysisBundle(paths, sourceId)).meta?.scope ?? { mode: "none", chapters: 0 };
            let picked: number[] = [];
            if (mode === "opening") {
                picked = [1, 2, 3].filter((n: number) => idx.some((c: any) => c.n === n));
            }
            else if (mode === "sample") {
                picked = [...new Set([0.1, 0.3, 0.6, 0.85].map((r: any) => Number(nearestChapter(idx, r))).filter((n: number) => Number.isFinite(n) && n > 0))];
            }
            else {
                const from = Math.max(1, Math.floor(Number(opts.from ?? 1) || 1));
                const count = Math.max(1, Math.min(5, Math.floor(Number(opts.count ?? 3) || 3)));
                for (let n = from; n < from + count; n++)
                    picked.push(n);
            }
            // 无 plan 的 mode=full 只是「从 from 起 3-5 章」，绝不是全量阅读——
            // 若在这里写 scope.mode="full"，报告会去掉「抽样观察」标记、覆盖率可到 1.0，
            // 属可信度造假。全量 scope 只能由 library_plan(mode=full, 经作者同意) 产生。
            const scopeMode = mode === "opening" ? "opening" : mode === "sample" ? "sample" : "chapters";
            const planned = mode === "sample" ? picked.length : picked.length ? Math.max(...picked.map((x: any) => Number(x))) : 0;
            await writeAnalysisMeta(paths, sourceId, { scope: { mode: scopeMode, chapters: Math.max(planned, Number(prevScope.chapters ?? 0)) } });
            const budget = Math.max(4000, Math.min(Number(opts.maxChars ?? 15000), 30000));
            const batch = [];
            let used = 0;
            for (const n of picked) {
                const body = chapterText(text, idx, n);
                if (!body)
                    continue;
                const room = budget - used;
                if (room <= 800)
                    break;
                const chunk = body.length <= room ? body : body.slice(0, room) + `
…（本章截断，完整见 sources/${meta.excerptPath}）`;
                batch.push({ n, title: chapterTitle(idx, n), text: chunk });
                used += chunk.length;
            }
            const bundle = await readAnalysisBundle(paths, sourceId);
            const facts = bundle.chapters;
            const lines = [
                `# 拆书批次 · ${meta.title}${meta.author ? `（${meta.author}）` : ""}`,
                `- sourceId：${meta.id}`,
                `- 全书章数：${total} · 已拆：${facts.length}`,
                `- 本批：${batch.map((b: any) => `第${b.n}章`).join("、") || "（无）"}`,
            ];
            if (mode === "full") {
                lines.push("- 注意：无 plan 的 mode=full 只取 from 起数章，不是全量；全量须 library_plan(mode=full)（作者同意后）。本批按 chapters 记 scope。");
            }
            lines.push("", "【纪律】只记白描：谁做了什么、结果怎样；原文没写的动机/身份/后果写进 unknowns，禁止补。", "心理/评价词只提示回看：区分人物明确说过的话与分析者推断，不能单凭词表拒绝事实。", "", "## 每章提交格式（zhizhang_library_facts_stage；阅读程度须如实申报，未声明可省略）", "```json", JSON.stringify({ source: meta.id, facts: { n: 1, title: "…", events: [{ loc: "P1-P3", desc: "谁做了什么，结果怎样", quote: "原文片段" }], functions: ["入局"], hook: { type: "悬念", text: "章末钩子", strength: "强" }, value: { situation: "…", relation: "…", cognition: "…", emotion: "…" }, unknowns: ["原文没写的动机"], readingLevel: "正文已读" } }, null, 2), "```", "", "## 本批原文");
            for (const b of batch) {
                lines.push(`
### 第${b.n}章 ${b.title}`);
                lines.push("<<<SOURCE");
                lines.push(b.text);
                lines.push("SOURCE>>>");
            }
            return lines.join("\n");
        }
        const maxChars = Math.max(800, Math.min(opts.maxChars ?? 12000, 80000));
        const excerpt = text.length <= maxChars
            ? text
            : text.slice(0, maxChars) + `\n\n…（已截断，原文共 ${text.length} 字；完整在 sources/${meta.excerptPath}）`;
        const analyze = MethodRegistry.get("analyze");
        const recommend = opts.includeRecommend !== false ? MethodRegistry.get("recommend") : undefined;
        const lines = [
            `# 拆书简报 · ${meta.title}${meta.author ? `（${meta.author}）` : ""}`,
            `- sourceId：${meta.id}`,
            `- readingRange：${meta.readingRange}`,
            `- 导入字数：${meta.charCount}`,
            "",
            "【工程说明】本工具只注入摘录与方法包，**不代写分析**。请你按双轴提炼后调用 zhizhang_library_card_stage；须 zhizhang_library_card_accept 才入库。",
            "",
            "## 双轴准入（只拆两样）",
            QualityPolicy.surfaceLine(),
            "",
            "## 怎么算拆完（脚本核不了，必须真读）",
            QualityPolicy.cardJudgmentLine(),
            "拆完的标志不是字段齐，而是：每张卡都能回答上面五条；mind 卡另有一句「检验方法」（遮住结局，读者能否用已给信息推出___）；craft 卡能说清这一场怎么写。",
            "禁止用「字段齐全 / 引文能搜到 / 审计通过」冒充合格。",
            "",
            "### A. craft（写作技法）→ 指导 **具体写作** / chapter_brief",
            "算：场面取舍、信息怎么漏、节奏/小物、状态如何落纸、失败边界可迁到**另一本书的正文**。",
            "必填：`axis=craft` + **humanFeel**（writerCraft / craftRange / characterState / stateOnPage / allowedEdges / failAsTemplate）。",
            "另填：**bookCraft**（章级续写面 continueWhy / adjacentChange / failAsShortStory）——≠ 完整创作思维。",
            "`characterState` = 这一刻场面状态（慌/赖/在算/会错半拍）；写法+状态，不是人设墙或台词范本。",
            "",
            "#### craft · 打碎僵硬（反完美感；书无关逻辑 + 本书载体）",
            "对原文另问四句：①呼吸哪里故意不齐？②哪里半截、作者也没立刻补课？③关键信息从讲义出还是从误认/失手/身体/跑题漏？载体是什么？④第一反应哪里不对？戏完纸上还留什么？",
            "逻辑名（可并列）：呼吸不齐 / 念头半截 / 信息侧漏 / 先错半拍 / 局部余震 / 口气拧着 / 意义不收齐——每条只记**逻辑名 + 本书载体**。",
            "`allowedEdges` 写成「本场应落纸：…」（打碎正向句 + 本书载体）。`failAsTemplate` 点名僵硬版（句句收齐、反应全对、讲义说明、意义被收完）。",
            "迁的是打碎逻辑名 + 本书载体；不同书的场面外壳各自不同，只记这一本自己怎么把文字写散。",
            "",
            "### B. mind（创作思维）→ 指点 **设定层 / 章纲 / 卷纲**（inspire）",
            "算：能力与代价如何设计、冲突飞轮、信息分期、章/卷压力如何换、读者合同如何立——可迁到**另一本书的设定/纲**。",
            "必填：`axis=mind` + **mind**（sellIntoCost / infoStaging / pressureMachine / debtAndSwap / readerContract / failAsEncyclopedia）。",
            "mind 供 inspire 规划；lean 正文 brief 只吃 craft 写法+状态。",
            "",
            "### 准入样子（两轴）",
            "- craft：可迁到另一本书正文的写法与场面状态",
            "- mind：可迁到另一本书设定/纲的创作思维",
            "- kind 是场面粒度次标签（craft|scene|book），axis 才是双轴",
            "",
            "### 其它",
            "1. **mechanisms** 须含 `name` + `failWhen`；discard 写清丢弃的原作剧情与人名。",
            "2. 可选 **handoff**；可选 **kind**（`craft`|`scene`|`book`）——axis=mind 才进创作思维轨。",
            "3. 同一 source 宜拆：**多张 craft + 至少一张 mind**（完整迁技）；仅技法试写可后注明。",
            "4. 缺证据块时 stage 可软警告通过；准入硬闸拦百科表与台词范本教嘴。",
            "5. **质量面 · 毒点**：" + QualityPolicy.poisonPolicyLine(),
            "",
        ];
        if (analyze) {
            lines.push(MethodRegistry.formatForAgent(analyze));
            lines.push("");
        }
        if (recommend) {
            lines.push(MethodRegistry.formatForAgent(recommend));
            lines.push("");
        }
        lines.push("## 原文摘录");
        lines.push("<<<SOURCE");
        lines.push(excerpt);
        lines.push("SOURCE>>>");
        lines.push("");
        lines.push("完成后：为每张卡填 axis +（craft: humanFeel+bookCraft | mind: mind）+ mechanisms + body，再 card_stage → card_accept。");
        return lines.join("\n");
        });
    },
    async stageCard(paths: StoragePaths, input: any) {
        await LibraryPort.ensureLibrary(paths);
        const title = String(input.title ?? "").trim();
        const body = String(input.body ?? "");
        const sourceId = String(input.sourceId ?? "").trim();
        if (!title)
            throw new ZhizhangError("bad_args", "title 不能为空");
        if (!sourceId)
            throw new ZhizhangError("bad_args", "sourceId 不能为空");
        if (!body.trim())
            throw new ZhizhangError("empty_body", "卡 body 不能为空");
        if (!Array.isArray(input.mechanisms) || input.mechanisms.length === 0) {
            throw new ZhizhangError("bad_args", "mechanisms 至少一条");
        }
        await LibraryPort.getSource(paths, sourceId);
        const mechanisms = input.mechanisms.map((m: any, i: number) => normalizeMechanism(m, i));
        const { handoff, warnings: w3 } = normalizeHandoff(input.handoff);
        const { kind, warnings: w4 } = normalizeKind(input.kind);
        const tags = (input.tags ?? []).map((t: any) => String(t).trim()).filter(Boolean);
        const v2 = {
            layer: String(input.layer ?? "").trim(),
            dimension: String(input.dimension ?? "").trim(),
            readerWant: String(input.readerWant ?? "").trim(),
            emotionArc: String(input.emotionArc ?? "").trim(),
            dramaticUnit: String(input.dramaticUnit ?? "").trim(),
            replaceables: Array.isArray(input.replaceables) ? input.replaceables.map((x: any) => String(x).trim()).filter(Boolean) : [],
            mustNotCopy: Array.isArray(input.mustNotCopy) ? input.mustNotCopy.map((x: any) => String(x).trim()).filter(Boolean) : [],
            transfer: String(input.transfer ?? "").trim(),
            failWhen: String(input.failWhen ?? "").trim(),
            evidence: Array.isArray(input.evidence) ? input.evidence : [],
            steps: Array.isArray(input.steps) ? input.steps.map((x: any) => String(x).trim()).filter(Boolean) : [],
            bannedDiction: Array.isArray(input.bannedDiction) ? input.bannedDiction.map((x: any) => String(x).trim()).filter(Boolean) : [],
        };
        const hasV2 = Boolean(v2.layer || v2.dimension || v2.readerWant || v2.emotionArc || v2.dramaticUnit || v2.transfer || v2.failWhen || v2.replaceables.length || v2.mustNotCopy.length || v2.evidence.length);
        if (!hasV2 && (v2.steps.length > 0 || v2.bannedDiction.length > 0)) {
            throw new ZhizhangError("bad_args", "steps / bannedDiction 仅用于 v2 模块卡：请同时传 layer + dimension，或改用 mechanisms 写操作");
        }
        const v2Warnings = [];
        let evidenceSourceHash: string | undefined;
        if (hasV2) {
            const check = validateModule({ ...v2, mechanisms: input.mechanisms });
            if (check.errors.length)
                throw new ZhizhangError("bad_module", `模块未通过：${check.errors.join("；")}`);
            v2Warnings.push(...check.warnings);
            const src = await readSourceForEvidence(paths, sourceId);
            evidenceSourceHash = src.sourceHash;
            const bad = verifyModuleEvidence(v2, src.text, src.index);
            if (bad.length)
                throw new ZhizhangError("bad_evidence", `模块证据未通过：${bad.join("；")}`);
        }
        // Peek presence before full normalize (avoid craft-warn spam on mind cards)
        const peekFeel = input.humanFeel != null;
        const peekBook = input.bookCraft != null;
        const peekMind = input.mind != null;
        const derivedAxis = hasV2 && !String(input.axis ?? "").trim() ? deriveAxis(v2.layer, v2.dimension) : input.axis;
        const { axis, warnings: wAxis } = normalizeAxis(derivedAxis, {
            hasHumanFeel: peekFeel,
            hasMind: peekMind,
            hasBookCraft: peekBook,
            tags,
            kind,
        });
        let humanFeel;
        let bookCraft;
        let mind;
        const w1 = [];
        const w2 = [];
        const wMind = [];
        if (axis === "craft" || peekFeel) {
            const r = normalizeHumanFeel(input.humanFeel);
            humanFeel = r.humanFeel;
            w1.push(...r.warnings);
        }
        if (axis === "craft" || peekBook) {
            const r = normalizeBookCraft(input.bookCraft);
            bookCraft = r.bookCraft;
            w2.push(...r.warnings);
        }
        if (axis === "mind" || peekMind) {
            const r = normalizeMind(input.mind);
            mind = r.mind;
            wMind.push(...r.warnings);
        }
        // kind=book must not be treated as mind — already enforced in normalizeAxis
        if (kind === "book" && axis === "craft") {
            // ok: book is scene-granularity tag
        }
        if (String(input.kind ?? "").trim().toLowerCase() === "book" && axis === "mind" && !mind) {
            wAxis.push("kind=book 不能冒充 mind：请填 mind 块或改 axis=craft");
        }
        const admit = admitCardContent({ title, body, axis, mechanisms });
        if (admit.hardReject) {
            throw new ZhizhangError("card_rejected", admit.hardReject);
        }
        const warnings = hasV2
            ? [...v2Warnings, ...w3, ...w4, ...warnCharacterStateWall(humanFeel?.characterState)]
            : [
                ...wAxis,
                ...w1,
                ...w2,
                ...wMind,
                ...w3,
                ...w4,
                ...admit.warnings,
                ...warnCharacterStateWall(humanFeel?.characterState),
                ...readingArtifactWarnings(body, axis),
            ];
        // Axis-specific soft expectations（v2 模块走 5 项校验，不再套旧轴口令）
        if (!hasV2) {
            if (axis === "craft" && !humanFeel) {
                warnings.push("axis=craft 但缺 humanFeel：新拆书应以写法+状态为硬产出目标");
            }
            if (axis === "mind" && !mind) {
                warnings.push("axis=mind 但缺 mind 块：新拆书应以创作思维六项为硬产出目标");
            }
            if (axis === "mind" && humanFeel && !mind) {
                warnings.push("mind 轴却只填了 humanFeel：人味属技法侧，请补 mind 或改 axis=craft");
            }
            if (axis === "craft" && mind && !humanFeel) {
                warnings.push("craft 轴却只填了 mind：创作思维请单独出 mind 卡，或改 axis=mind");
            }
        }
        const candId = newId("lcand");
        const now = nowIso();
        const card: Record<string, any> = {
            schemaVersion: 1,
            id: candId,
            title,
            sourceId,
            readingRange: String(input.readingRange ?? "").trim() || "见拆书简报",
            axis,
            mechanisms,
            body: body.trim(),
            tags,
            status: "drafted",
            createdAt: now,
            updatedAt: now,
        };
        if (humanFeel)
            card.humanFeel = humanFeel;
        if (bookCraft)
            card.bookCraft = bookCraft;
        if (mind)
            card.mind = mind;
        if (handoff)
            card.handoff = handoff;
        if (kind)
            card.kind = kind;
        if (hasV2) {
            card.schemaVersion = 2;
            card.layer = v2.layer;
            card.dimension = v2.dimension;
            card.readerWant = v2.readerWant;
            card.emotionArc = v2.emotionArc;
            card.dramaticUnit = v2.dramaticUnit;
            card.replaceables = v2.replaceables;
            card.mustNotCopy = v2.mustNotCopy;
            card.transfer = v2.transfer;
            card.failWhen = v2.failWhen;
            card.evidence = v2.evidence;
            // Snapshot only explicit reading declarations for cited chapters; quotes do not prove depth.
            const analysis = await readAnalysisBundle(paths, sourceId);

            const chapterNums = [...new Set(v2.evidence.map((e: any) => parseChapterNumber(e?.chapter)).filter((n: any) => Number.isInteger(n) && n > 0))] as number[];
            const chapters = chapterNums.map((n) => {
                const matches = analysis.chapters.filter((f: any) => Number(f.n) === n);
                const fact: any = matches.length === 1 ? matches[0] : undefined;
                const level = fact?.readingLevel === "正文已读" || fact?.readingLevel === "深读" ? fact.readingLevel : "未声明";
                return { chapter: n, readingLevel: level, sourceHash: fact?.sourceHash, sourceStart: fact?.sourceStart, sourceMatches: fact?.sourceHash ? fact.sourceHash === evidenceSourceHash : null };
            });
            card.readingEvidence = {
                capturedAt: now,
                sourceHash: evidenceSourceHash,
                planMode: analysis.meta?.scope?.mode ?? "未建计划",
                chapters,
                note: "阅读程度为提交者申报，引用匹配不证明已读或深读；来源版本不同时仅为历史申报，旧记录来源未知",
            };
            if (chapters.some((ch) => ch.readingLevel === "未声明"))
                warnings.push("部分证据章的阅读程度未声明；引文匹配不证明已读或深读。");
            if (v2.steps.length)
                card.steps = v2.steps;
            if (v2.bannedDiction.length)
                card.bannedDiction = v2.bannedDiction;
        }
        const d = libraryDirs(paths);
        const candidatePath = path.join(d.candidates, `${candId}.json`);
        await withResourceLock(paths.library, async () => {
            await assertNoPendingCard(paths.library);
            if (await snapshotFile(candidatePath) !== null)
                throw new ZhizhangError("id_collision", "生成的卡候选 id 已存在；未覆盖原文件，请重新尝试。");
            await atomicWrite(candidatePath, JSON.stringify(card, null, 2) + "\n");
        });
        return { candId, title, warnings };
    },
    async acceptCard(paths: StoragePaths, candId: any) {
        const id = assertResourceId(candId, "卡候选 id");
        await LibraryPort.ensureLibrary(paths);
        // 读候选 → 查已采纳 → 写卡 + 索引 + 回写候选全程持同一把库锁：
        // 并发/重试不能把同一张候选重复采纳成两张卡。
        return withResourceLock(paths.library, async () => {
            await assertNoPendingCard(paths.library);
            const d = libraryDirs(paths);
            const candPath = path.join(d.candidates, `${id}.json`);
            const candidateBefore = await snapshotFile(candPath);
            if (candidateBefore === null) {
                throw new ZhizhangError("candidate_not_found", `找不到技法卡候选 ${id}`);
            }
            const indexBefore = await snapshotFile(d.index);
            if (indexBefore === null)
                throw new ZhizhangError("library_index_missing", "拆书库索引缺失，请先核对原文件。");
            const staged = JSON.parse(await readFile(candPath, "utf8"));
            if (staged.status === "accepted" || staged.acceptedCardId) {
                throw new ZhizhangError("candidate_already_accepted", `卡候选 ${id} 已采纳${staged.acceptedCardId ? `（${staged.acceptedCardId}）` : ""}，不能重复入库。请重新 card_stage。`);
            }
            if (!staged.body?.trim()) {
                throw new ZhizhangError("empty_body", "候选 body 为空，拒绝采纳");
            }
            let moduleWarnings: string[] = [];
            let sourceGuard: { sourceId: string; sourceFile: string; metaHash: string; sourceHash: string } | undefined;
            if (staged.schemaVersion === 2 || staged.layer) {
                const check = validateModule(staged);
                if (check.errors.length)
                    throw new ZhizhangError("bad_module", `模块未通过：${check.errors.join("；")}`);
                moduleWarnings = check.warnings;
                const src = await readSourceForEvidence(paths, staged.sourceId);
                if (staged.readingEvidence?.sourceHash && staged.readingEvidence.sourceHash !== src.sourceHash)
                    throw new ZhizhangError("source_changed", "书源在暂存卡后发生变化；请重新核对原文并暂存卡，避免沿用旧阅读依据。");
                const bad = verifyModuleEvidence(staged, src.text, src.index);
                if (bad.length)
                    throw new ZhizhangError("bad_evidence", `模块证据未通过：${bad.join("；")}`);
                sourceGuard = { sourceId: src.sourceId, sourceFile: src.sourceFile, metaHash: src.metaHash, sourceHash: src.sourceHash };
            }
            let auditWarnings: string[] = [];
            if (!(staged.schemaVersion === 2 || staged.layer)) {
                try {
                    const src = await LibraryPort.getSource(paths, staged.sourceId);
                    const audit = auditCardContent({ ...staged, axis: coerceAxis(staged) }, src.text, undefined);
                    auditWarnings = audit.warnings;
                    if (audit.unverifiable.length > 0) {
                        auditWarnings.unshift(`证据引文 ${audit.evidenceVerified}/${audit.evidenceQuotes} 可在原文中核对，${audit.unverifiable.length} 条未命中`);
                    }
                }
                catch (err: any) {
                    auditWarnings.push(`旧卡原文未能核对（${err?.message ?? String(err)}）；采纳前须人工检查来源。`);
                }
            }
            auditWarnings.unshift(...moduleWarnings);
            const cardId = newId("card");
            const now = nowIso();
            const card: Record<string, any> = {
                ...staged,
                id: cardId,
                status: "accepted",
                updatedAt: now,
                acceptedAt: now,
            };
            const idx = await readIndex(paths);
            const cardBefore = await snapshotFile(path.join(d.cards, `${cardId}.json`));
            if (cardBefore !== null) throw new ZhizhangError("id_collision", "生成的卡 id 已存在；未覆盖原卡，请重新尝试。");
            idx.cards.unshift({
                id: cardId,
                title: card.title,
                sourceId: card.sourceId,
                tags: card.tags,
                status: "accepted",
                updatedAt: now,
                axis: coerceAxis(card),
                layer: card.layer,
                dimension: card.dimension,
            });
            const acceptedCandidate = { ...staged, status: "accepted", acceptedCardId: cardId, updatedAt: now };
            const journalId = await createCardJournal(paths.library, {
                candidateId: id, cardId, sourceGuard,
                writes: [
                    { file: `cards/${cardId}.json`, before: cardBefore, content: JSON.stringify(card, null, 2) + "\n" },
                    { file: "index.json", before: indexBefore, content: JSON.stringify(idx, null, 2) + "\n" },
                    { file: `candidates/${id}.json`, before: candidateBefore, content: JSON.stringify(acceptedCandidate, null, 2) + "\n" },
                ],
            });
            try { await finishCardJournal(paths.library, journalId); }
            catch (err: any) {
                if (err instanceof ZhizhangError) throw err;
                throw new ZhizhangError("library_recovery_required", `卡采纳未完整提交（${err?.message ?? String(err)}）。请用 zhizhang_library_list(recovery=inspect) 检查；不要重复采纳。`);
            }
            return {
                cardId,
                title: card.title,
                warnings: auditWarnings,
                judgment: [
                    "机械审计只证明引文没编、字段没缺，不证明卡能用。",
                    "采纳前请真读原文，按五条判：可操作 / 特异性（换书名还成立=没抓到本书）/ 非梗概 / 状态落纸 / 失败边界具体。",
                    "并在回执里写一句：这张卡最可能失效的地方是___。",
                ],
            };
        });
    },
    async discardCard(paths: StoragePaths, cardId: any) {
        const id = assertResourceId(cardId, "卡 id");
        await LibraryPort.ensureLibrary(paths);
        const d = libraryDirs(paths);
        return withResourceLock(paths.library, async () => {
            const indexBefore = await snapshotFile(d.index);
            if (!indexBefore) throw new ZhizhangError("library_index_missing", "拆书库索引缺失，请先检查原文件。");
            const fresh = await readIndex(paths);
            if (await snapshotFile(d.index) !== indexBefore) throw new ZhizhangError("library_recovery_conflict", "索引在删卡准备期间变化，请重新检查。");
            const hit = fresh.cards.find((c: any) => c.id === id);
            if (!hit) throw new ZhizhangError("card_not_found", `找不到卡 ${cardId}`);
            fresh.cards = fresh.cards.filter((c: any) => c.id !== id);
            const cardBefore = await snapshotFile(path.join(d.cards, `${id}.json`));
            const journal = await createDiscardJournal(paths.library, { cardId: id, indexBefore, cardBefore, indexContent: JSON.stringify(fresh, null, 2) + "\n" });
            try { await finishDiscardJournal(paths.library, journal); }
            catch (err: any) {
                if (err instanceof ZhizhangError) throw err;
                throw new ZhizhangError("library_recovery_required", `删卡 ${id} 未完成（${err?.message ?? String(err)}）。请先检查恢复记录。`);
            }
            return { cardId: id, title: hit.title, remaining: fresh.cards.length };
        });
    },
    async listCards(paths: StoragePaths, opts: any = {}) {
        await LibraryPort.ensureLibrary(paths);
        const idx = await readIndex(paths);
        return filterCardRows(paths, idx.cards, {
            status: opts.status ?? "accepted",
            sourceId: opts.sourceId,
            sourceIds: opts.sourceIds,
            sourceTitle: opts.sourceTitle,
            axis: opts.axis,
        });
    },
    async searchCards(paths: StoragePaths, query: any, opts: any = {}) {
        await LibraryPort.ensureLibrary(paths);
        const tokens = tokenizeQuery(query);
        const tag = String(opts.tag ?? "").trim().toLowerCase();
        const hasFilter = Boolean(opts.sourceId ||
            (opts.sourceIds && opts.sourceIds.length) ||
            opts.sourceTitle ||
            opts.axis ||
            tag);
        if (!tokens.length && !hasFilter) {
            throw new ZhizhangError("bad_args", "query 不能为空（或提供 source/axis/tag 过滤）");
        }
        const idx = await readIndex(paths);
        let pool = await filterCardRows(paths, idx.cards, {
            status: opts.status ?? "accepted",
            sourceId: opts.sourceId,
            sourceIds: opts.sourceIds,
            sourceTitle: opts.sourceTitle,
            axis: opts.axis,
        });
        if (tag) {
            pool = pool.filter((row: any) => (row.tags ?? []).some((t: any) => String(t).toLowerCase() === tag));
        }
        if (!tokens.length)
            return pool;
        const hits = [];
        for (const row of pool) {
            const shallow = `${row.title} ${(row.tags ?? []).join(" ")} ${row.sourceId} ${row.axis ?? ""}`.toLowerCase();
            if (tokens.every((t: any) => shallow.includes(t))) {
                hits.push(row);
                continue;
            }
            try {
                const card = await LibraryPort.getCard(paths, row.id);
                if (tokens.every((t: any) => cardDeepHay(card).includes(t)))
                    hits.push({ ...row, axis: coerceAxis(card) });
            }
            catch (err) { throw err; }
        }
        return hits;
    },
    /**
     * 推荐组合包：优先 1 mind + 最多 N craft；有用的 craft 可独立返回。
     * 缺 mind 不阻断；没有任何可用卡时返回空原因。
     */
    async suggestCombo(paths: StoragePaths, input: any = {}) {
        await LibraryPort.ensureLibrary(paths);
        const warnings = [];
        const nRaw = input.craftCount ?? 2;
        const craftCount = Math.max(1, Math.min(8, Math.floor(Number(nRaw) || 2)));
        if (input.craftCount != null && Number(input.craftCount) !== craftCount) {
            warnings.push(`craftCount 已夹紧为 ${craftCount}（允许 1–8）`);
        }
        const query = String(input.query ?? "").trim();
        const preferMind = new Set((input.preferMindSourceIds ?? []).map((x: any) => String(x).trim()).filter(Boolean));
        const pool = await LibraryPort.listCards(paths, {
            status: "accepted",
            sourceIds: input.sourceIds,
            sourceTitle: input.sourceTitle,
        });
        const minds = [];
        const crafts = [];
        for (const row of pool) {
            let axis = row.axis;
            if (axis !== "craft" && axis !== "mind") {
                try {
                    axis = coerceAxis(await LibraryPort.getCard(paths, row.id));
                }
                catch (err) { throw err; }
            }
            const normalized = { ...row, axis };
            if (axis === "mind")
                minds.push(normalized);
            else
                crafts.push(normalized);
        }
        if (minds.length === 0) {
            const selected = [...crafts].sort((a, b) => comboScore(b, query, "").score - comboScore(a, query, "").score).slice(0, craftCount);
            return { ok: selected.length > 0, cardIds: selected.map(c => c.id), mind: null, crafts: selected,
                warnings: [...warnings, "没有 mind；按本书作者材料规划，craft 仅提供写法参考，不要求补卡。"],
                emptyReason: selected.length ? undefined : "当前范围没有参考卡；可以直接按作者目标规划。" };
        }
        // score minds
        const mindScored = [];
        for (const row of minds) {
            // 深打分与深检索同源（cardDeepHay）：v2 模块的 readerWant/transfer/
            // dramaticUnit/replaceables/evidence 等也参与主题命中——
            // 此前手拼 mind.*/body 会让 v2 卡在主题排序里几乎不可见。
            let deep = "";
            try {
                deep = cardDeepHay(await LibraryPort.getCard(paths, row.id));
            }
            catch (err) { throw err; }
            const cs = comboScore(row, query, deep);
            let score = cs.score;
            if (preferMind.size && preferMind.has(row.sourceId))
                score += 50;
            mindScored.push({ row, score, matched: cs.matched });
        }
        mindScored.sort((a: any, b: any) => b.score - a.score);
        const mindRow = mindScored[0].row;
        // score crafts; prefer source diversity after mind's source
        const craftScored = [];
        for (const row of crafts) {
            let deep = "";
            try {
                deep = cardDeepHay(await LibraryPort.getCard(paths, row.id));
            }
            catch (err) { throw err; }
            const cs = comboScore(row, query, deep);
            let score = cs.score;
            // light bonus for different source than mind (cross-book mix)
            if (row.sourceId !== mindRow.sourceId)
                score += 5;
            craftScored.push({ row, score, matched: cs.matched });
        }
        craftScored.sort((a: any, b: any) => b.score - a.score);
        if (query && !mindScored.some((s: any) => s.matched > 0) && !craftScored.some((s: any) => s.matched > 0)) {
            warnings.push(`主题词「${query}」在候选池无命中：已按更新时间兜底`);
        }
        const pickedCrafts = [];
        const usedSources = new Set([mindRow.sourceId]);
        // first pass: prefer new sources
        for (const { row } of craftScored) {
            if (pickedCrafts.length >= craftCount)
                break;
            if (usedSources.has(row.sourceId) && craftScored.length > craftCount) {
                continue;
            }
            pickedCrafts.push(row);
            usedSources.add(row.sourceId);
        }
        // fill remaining
        if (pickedCrafts.length < craftCount) {
            const have = new Set(pickedCrafts.map((c: any) => c.id));
            for (const { row } of craftScored) {
                if (pickedCrafts.length >= craftCount)
                    break;
                if (have.has(row.id))
                    continue;
                pickedCrafts.push(row);
            }
        }
        if (pickedCrafts.length === 0) {
            warnings.push("池内无 craft：仅返回 1 mind；写作 lean brief 将缺少技法卡");
        }
        else if (pickedCrafts.length < craftCount) {
            warnings.push(`craft 仅 ${pickedCrafts.length} 张（少于请求的 ${craftCount}）`);
        }
        const mindRef = {
            id: mindRow.id,
            title: mindRow.title,
            sourceId: mindRow.sourceId,
            axis: "mind",
            tags: mindRow.tags,
        };
        const craftRefs = pickedCrafts.map((c: any) => ({
            id: c.id,
            title: c.title,
            sourceId: c.sourceId,
            axis: "craft",
            tags: c.tags,
        }));
        const cardIds = [mindRef.id, ...craftRefs.map((c: any) => c.id)];
        return {
            ok: true,
            cardIds,
            mind: mindRef,
            crafts: craftRefs,
            warnings,
        };
    },
    async auditCards(paths: StoragePaths, opts: any = {}) {
        await LibraryPort.ensureLibrary(paths);
        const idx = await readIndex(paths);
        let rows = await filterCardRows(paths, idx.cards, {
            status: opts.status ?? "accepted",
            sourceId: opts.sourceId,
            axis: opts.axis,
        });
        if (opts.cardId)
            rows = rows.filter((r: any) => r.id === opts.cardId);
        const srcCache = new Map();
        const out = [];
        for (const row of rows) {
            const card = await LibraryPort.getCard(paths, row.id);
            let entry = srcCache.get(card.sourceId);
            if (entry === undefined) {
                try {
                    const src = await LibraryPort.getSourceIndexed(paths, card.sourceId);
                    entry = { text: src.text, norm: normForMatch(src.text), index: src.index };
                }
                catch {
                    // source 缺失：引文一律记为未命中
                    entry = { text: "", norm: normForMatch(""), index: [] };
                }
                srcCache.set(card.sourceId, entry);
            }
            if (card.schemaVersion === 2 || card.layer) {
                const check = validateModule(card);
                const bad = entry.text
                    ? verifyModuleEvidence(card, entry.text, entry.index)
                    : (card.evidence ?? []).map((_: any, i: number) => `evidence[${i}] 来源缺失，无法核对`);
                const quotes = (card.evidence ?? []).length;
                const bodyCheck = entry.text
                    ? verifyBodyQuotes(card, entry.text)
                    : { total: 0, ok: 0, bad: ["来源缺失，正文引文无法核对"], skipped: 0 };
                out.push({
                    id: card.id,
                    title: card.title,
                    axis: coerceAxis(card),
                    layer: card.layer,
                    dimension: card.dimension,
                    evidenceQuotes: quotes,
                    evidenceVerified: Math.max(0, quotes - bad.length),
                    unverifiable: bad,
                    skippedShort: [],
                    bodyQuotes: bodyCheck.total,
                    bodyVerified: bodyCheck.ok,
                    bodyUnverifiable: bodyCheck.bad,
                    bodySkipped: bodyCheck.skipped ?? 0,
                    warnings: [...check.errors, ...check.warnings.filter((w: any) => !w.includes("mechanisms 为空"))],
                    chapterOk: bad.length || bodyCheck.bad.length ? false : true,
                });
                continue;
            }
            const audit = auditCardContent({ ...card, axis: coerceAxis(card) }, entry.text, entry.norm);
            out.push({ id: card.id, title: card.title, axis: coerceAxis(card), ...audit });
        }
        return out;
    },
    async getCard(paths: StoragePaths, cardId: any) {
        const id = assertResourceId(cardId, "卡 id");
        await LibraryPort.ensureLibrary(paths);
        const d = libraryDirs(paths);
        const cardPath = path.join(d.cards, `${id}.json`);
        if (!(await fileExists(cardPath))) {
            throw new ZhizhangError("card_not_found", `找不到技法卡 ${id}`);
        }
        // mtime 缓存：combo 深打分 / 深检索 / 面板轮询会反复读同一批卡。
        const raw = await readJsonCached(cardPath);
        return { ...raw, axis: coerceAxis(raw) };
    },
    async getCandidate(paths: StoragePaths, candId: any) {
        const id = assertResourceId(candId, "卡候选 id");
        await LibraryPort.ensureLibrary(paths);
        const d = libraryDirs(paths);
        const candPath = path.join(d.candidates, `${id}.json`);
        if (!(await fileExists(candPath))) {
            throw new ZhizhangError("candidate_not_found", `找不到技法卡候选 ${id}`);
        }
        const raw = await readJsonCached(candPath);
        return { ...raw, axis: coerceAxis(raw) };
    },
};
