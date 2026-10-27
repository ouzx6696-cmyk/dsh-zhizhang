import { withResourceLock } from "../storage/process-lock.js";
/**
 * InspirationPort — 灵感推演支柱（live）。
 * Session + Library cards + MethodRegistry develop/plan → stage foundation/outline → explicit accept (optional apply to work).
 * Does not silently foundation_set.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
import { snapshotFile } from "../storage/accept-journal.js";
import { normalizeFoundation, validateStoryPace } from "../storage/work-meta.js";
import { prepareChapterSaveUnlocked, readChapter } from "../storage/chapters.js";
import { assertNoPendingInspiration, createInspirationJournal, finishInspirationJournal } from "../storage/inspiration-journal.js";
import { readPlanning } from "../domain/planning.js";
import { atomicWrite, assertResourceId, createWork, resolveWorkDir, readWorkMeta, } from "../store.js";
import { readJsonCached } from "../file-cache.js";
import { LibraryPort, ANTI_STIFFNESS_BRIEF_LINE, coerceAxis, coerceHumanFeel, craftCueFromHumanFeel, formatTechniqueCardBlock, formatTechniqueCardBlockLean, hasShatterCraftCue, } from "./library.js";
import { MethodRegistry } from "./methods.js";
import { QualityPolicy } from "./quality-policy.js";
import type { StoragePaths } from "../types.js";
function nowIso() {
    return new Date().toISOString();
}
function newId(prefix: string) {
    return `${prefix}-${Date.now().toString(36)}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
async function fileExists(p: string) {
    try {
        await access(p);
        return true;
    }
    catch (err: any) {
        if (err?.code === "ENOENT") return false;
        throw err;
    }
}
function inspDirs(paths: StoragePaths) {
    return {
        root: paths.inspiration,
        sessions: path.join(paths.inspiration, "sessions"),
        candidates: path.join(paths.inspiration, "candidates"),
    };
}
async function ensureInsp(paths: StoragePaths) {
    const d = inspDirs(paths);
    await mkdir(d.sessions, { recursive: true });
    await mkdir(d.candidates, { recursive: true });
}
export const InspirationPort = {
    id: "port.inspiration",
    status: "live",
    title: "灵感推演",
    summary: "按作者目标规划，可选 combo/card_ids；forge 分喂参考 → stage 根基/章纲 → accept(apply?) → 写作 brief。不静默写作品。",
    capabilities() {
        return [
            { id: "session", title: "灵感会话（可无卡；有卡无 mind 须 craft_only）", ready: true },
            { id: "forge_with_cards", title: "结合 mind/craft 分喂推演", ready: true },
            { id: "emit_foundation", title: "暂存根基候选", ready: true },
            { id: "emit_outline", title: "暂存章纲候选", ready: true },
            { id: "accept_apply", title: "显式采纳（可选写入作品）", ready: true },
        ];
    },
    async startSession(paths: StoragePaths, input: any) {
        await ensureInsp(paths);
        return withResourceLock(paths.inspiration, async () => {
            await assertNoPendingInspiration(paths.inspiration);
        await ensureInsp(paths);
        const goal = String(input.goal ?? "").trim();
        if (!goal)
            throw new ZhizhangError("bad_args", "goal 不能为空");
        // combo 回执里每张卡 id 会出现多次（card_ids 行 + 明细行），照抄传入是常态——
        // 不去重会让 forge 把同一张卡整段渲染两遍，分轴计数也翻倍。
        const cardIds = [...new Set((input.cardIds ?? []).map((id: string) => String(id).trim()).filter(Boolean))];
        const craftOnly = input.craftOnly === true;
        if (cardIds.length) await LibraryPort.ensureLibrary(paths);
        const pace = validateStoryPace(input.pace);
        let mindCount = 0;
        let craftCount = 0;
        for (const id of cardIds) {
            const card = await LibraryPort.getCard(paths, id);
            if (card.status !== "accepted") {
                throw new ZhizhangError("card_not_accepted", `卡 ${id} 尚未 accept，不能用于灵感`);
            }
            const axis = coerceAxis(card);
            if (axis === "mind")
                mindCount += 1;
            else
                craftCount += 1;
        }
        if (cardIds.length > 0 && mindCount === 0 && !craftOnly) {
            throw new ZhizhangError("mind_required", "灵感规划须至少一张 axis=mind 创作思维卡；若仅技法试写请传 craft_only=true");
        }
        const sessionId = newId("insp");
        const now = nowIso();
        const session: Record<string, any> = {
            schemaVersion: 1,
            id: sessionId,
            goal,
            genre: String(input.genre ?? "").trim(),
            cardIds,
            createdAt: now,
            updatedAt: now,
        };
        if (craftOnly) session.craftOnly = true;
        if (pace) session.pace = pace;
        const d = inspDirs(paths);
        const sessionPath = path.join(d.sessions, `${sessionId}.json`);
        if (await snapshotFile(sessionPath) !== null)
            throw new ZhizhangError("id_collision", "生成的灵感会话 id 已存在；未覆盖原文件，请重新尝试。");
        await atomicWrite(sessionPath, JSON.stringify(session, null, 2) + "\n");
        return { sessionId, craftOnly, mindCount, craftCount };
        });
    },
    async getSession(paths: StoragePaths, sessionId: any) {
        await ensureInsp(paths);
        const d = inspDirs(paths);
        const p = path.join(d.sessions, `${assertResourceId(sessionId, "灵感会话 id")}.json`);
        if (!(await fileExists(p))) {
            throw new ZhizhangError("session_not_found", `找不到灵感会话 ${sessionId}`);
        }
        return readJsonCached(p);
    },
    async listSessions(paths: StoragePaths) {
        await ensureInsp(paths);
        const d = inspDirs(paths);
        const { readdir } = await import("node:fs/promises");
        const names = await readdir(d.sessions).catch(() => []);
        const rows = [];
        for (const name of names) {
            if (!name.endsWith(".json"))
                continue;
            try {
                // mtime 缓存：面板每 ~6s 轮询都会全量列会话。
                const s = await readJsonCached(path.join(d.sessions, name));
                rows.push({
                    id: s.id,
                    goal: s.goal,
                    genre: s.genre,
                    cardIds: s.cardIds,
                    forgeAt: s.forgeAt,
                    updatedAt: s.updatedAt,
                });
            }
            catch {
                /* skip */
            }
        }
        rows.sort((a: any, b: any) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        return rows;
    },
    /** Previously applied candidates remain available as an author-readable decision history. */
    async listWorkHistory(paths: StoragePaths, workKey: string) {
        await ensureInsp(paths);
        return withResourceLock(paths.inspiration, async () => {
            await assertNoPendingInspiration(paths.inspiration);
            const { readdir } = await import("node:fs/promises");
            const dir = inspDirs(paths).candidates;
            const names = (await readdir(dir)).filter(name => name.endsWith(".json"));
            const rows = [];
            for (const name of names) {
                let cand: any;
                try { cand = JSON.parse(await readFile(path.join(dir, name), "utf8")); }
                catch { throw new ZhizhangError("bad_inspiration_candidate", `灵感候选 ${name} 无法读取；请保留原文件并核对。`); }
                if (!cand || typeof cand !== "object" || Array.isArray(cand) || typeof cand.id !== "string" || cand.id !== name.slice(0, -5))
                    throw new ZhizhangError("bad_inspiration_candidate", `灵感候选 ${name} 格式损坏；请保留原文件并核对。`);
                if (cand.status === "accepted" && cand.appliedWorkKey === workKey) {
                    rows.push({ id: cand.id, kind: cand.kind, title: cand.payload?.title || cand.payload?.id || cand.payload?.chapter || "", at: cand.acceptedAt || cand.updatedAt || cand.createdAt || "" });
                }
            }
            rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
            return { total: rows.length, rows: rows.slice(0, 50) };
        });
    },
    async getCandidate(paths: StoragePaths, candidateId: string) {
        await ensureInsp(paths);
        return withResourceLock(paths.inspiration, async () => {
            await assertNoPendingInspiration(paths.inspiration);
            const id = assertResourceId(candidateId, "灵感候选 id");
            let candidate: any;
            try { candidate = JSON.parse(await readFile(path.join(inspDirs(paths).candidates, `${id}.json`), "utf8")); }
            catch (err: any) {
                if (err?.code === "ENOENT") throw new ZhizhangError("candidate_not_found", `找不到灵感候选 ${id}`);
                throw new ZhizhangError("bad_inspiration_candidate", `灵感候选 ${id} 无法读取；请保留原文件并核对。`);
            }
            if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || candidate.id !== id)
                throw new ZhizhangError("bad_inspiration_candidate", `灵感候选 ${id} 格式损坏；请保留原文件并核对。`);
            return candidate;
        });
    },
    async forgeBrief(paths: StoragePaths, sessionId: any) {
        await ensureInsp(paths);
        return withResourceLock(paths.inspiration, async () => {
            await assertNoPendingInspiration(paths.inspiration);
        const session = await InspirationPort.getSession(paths, sessionId);
        const cards = [];
        for (const id of session.cardIds) {
            cards.push(await LibraryPort.getCard(paths, id));
        }
        const develop = MethodRegistry.get("develop");
        const plan = MethodRegistry.get("plan");
        const tomato = MethodRegistry.get("tomato_four_q");
        const mindCards = cards.filter((c: any) => coerceAxis(c) === "mind");
        const craftCards = cards.filter((c: any) => coerceAxis(c) !== "mind");
        const thinMind = mindCards.filter((c: any) => !c.mind && !c.layer).length;
        const thinFeel = craftCards.filter((c: any) => !c.humanFeel && !c.layer).length;
        const craftOnly = Boolean(session.craftOnly);
        const lines = [
            `# 灵感推演简报 · ${sessionId}`,
            `- goal：${session.goal}`,
            `- genre：${session.genre || "（未填）"}`,
            `- 节奏：${session.pace || "未指定；按作者目标选择并说明"}`,
            `- 卡：${session.cardIds.length ? session.cardIds.join("、") : "无参考卡（按作者目标规划，不虚构参考依据）"}`,
            `- 分轴：mind ${mindCards.length} · craft ${craftCards.length}` +
                (craftOnly ? " · **仅技法试写（craft_only）**" : ""),
            mindCards.length === 0
                ? (session.cardIds.length === 0 ? "- 未使用参考卡；不存在来源证据" : "- ⚠️ 无 mind 卡（已声明仅技法试写）")
                : thinMind > 0
                    ? `- ⚠️ ${thinMind}/${mindCards.length} 张 mind 偏薄（无 mind 块）`
                    : `- ✓ mind 卡均含创作思维块`,
            craftCards.length === 0
                ? `- （无 craft 辅卡）`
                : thinFeel > 0
                    ? `- ⚠️ ${thinFeel}/${craftCards.length} 张 craft 写法/状态偏薄`
                    : `- ✓ craft 辅卡均含 humanFeel`,
            "",
            "【工程说明】本工具**分喂**拆书库双轴卡与方法包（流程纪律），**不代写设定**。mind → foundation/outline；craft 仅辅风格/场面。完成后 zhizhang_inspire_stage → inspire_accept。根基写入须经 inspire_accept(apply)。",
            "",
            "## ① 创作思维（mind · 主粮）——设定 / 章纲 / 卷纲",
            "先吃 sellIntoCost / infoStaging / pressureMachine / debtAndSwap / readerContract；写成可迁移的设定/纲思维。",
            "",
        ];
        if (mindCards.length === 0) {
            lines.push(craftOnly
                ? "（本会话为仅技法试写：无 mind 主粮；planned/locks 须自洽并标明偏技法。）"
                : "（未使用参考卡：依据作者的目标与偏好规划，不虚构拆书来源。）");
            lines.push("");
        }
        else {
            for (const c of mindCards) {
                lines.push(formatTechniqueCardBlock(c));
                lines.push("");
            }
        }
        lines.push("## ② 写作技法（craft · 辅）——风格与场面");
        lines.push("可参考写法/状态/继续；世界观与章纲主吃 mind。");
        lines.push("");
        if (craftCards.length === 0) {
            lines.push("（无 craft 辅卡）");
            lines.push("");
        }
        else {
            for (const c of craftCards) {
                lines.push(formatTechniqueCardBlock(c));
                lines.push("");
            }
        }
        lines.push("## 共享方法包（流程纪律；≠ 拆书库双轴卡）");
        lines.push("");
        if (develop) {
            lines.push(MethodRegistry.formatForAgent(develop));
            lines.push("");
        }
        if (plan) {
            lines.push(MethodRegistry.formatForAgent(plan));
            lines.push("");
        }
        if (tomato) {
            lines.push(MethodRegistry.formatForAgent(tomato));
            lines.push("");
        }
        lines.push("## 本书决策");
        lines.push("- 先确定节奏档位（快爽 / 稳推 / 慢燃）：按作者目标安排卖点与回报；慢燃也要让近端体验和推进成立。");
        lines.push("- 写清主角目标与办法、对手可行回应、代价如何发生，以及当场回报和下一步压力；让这些选择来自本书人物与处境。");
        lines.push("- 可参考卡的机制，不照搬原作人物、情节或场面；没有参考卡时明确依据作者目标，不编造来源。");
        lines.push("");
        lines.push("## 输出要求");
        lines.push("- 可先提交 book_plan（content）、volume_plan（id/title/content/chapters）和 act_plan（同卷规划，可填 volumeId），写全书、各卷与幕的目标及明确归属的章节；只有显式 apply 后才进入作品与章简报。");
        lines.push("- foundation：locks / characters / planned / style / threads 等；**planned/locks/threads 须主吃 mind**（卖点进代价、信息分期、压力机、长线债）；style 可辅吃 craft 的写法+状态；人名剧情自行重造。");
        lines.push("- outline：须含 chapter、title、situationLens、livedScene、stateLens、ending；**压力换与书债对齐 mind.debtAndSwap / readerContract**；stateLens 写场面状态/写法取舍（非声纹）。");
        lines.push("- **相邻换压力**：后续章纲换场面/压力/人事，接着前章后果往下推。");
        lines.push("- 成功样子：可迁移的设定/纲思维 + 写法场面；对照 failAsEncyclopedia / failAsTemplate / failAsShortStory 自检边界。");
        lines.push("- **质量面 · 毒点**：" + QualityPolicy.poisonPolicyLine());
        lines.push("- " + QualityPolicy.surfaceLine());
        lines.push("- 完成后：zhizhang_inspire_stage → zhizhang_inspire_accept（apply=true 写入作品）。");
        const brief = lines.join("\n");
        const now = nowIso();
        const d = inspDirs(paths);
        const updated = {
            ...session,
            forgeAt: now,
            updatedAt: now,
            lastBriefPreview: brief.slice(0, 400),
        };
        await atomicWrite(path.join(d.sessions, `${sessionId}.json`), JSON.stringify(updated, null, 2) + "\n");
        return brief;
        });
    },
    async stageEmit(paths: StoragePaths, sessionId: any, input: any) {
        await ensureInsp(paths);
        return withResourceLock(paths.inspiration, async () => {
            await assertNoPendingInspiration(paths.inspiration);
        const session = await InspirationPort.getSession(paths, sessionId);
        const kind = input.kind;
        if (!["foundation", "outline", "book_plan", "volume_plan", "act_plan"].includes(kind)) {
            throw new ZhizhangError("bad_args", "kind 须为 foundation、outline、book_plan、volume_plan 或 act_plan");
        }
        const payload = input.payload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            throw new ZhizhangError("bad_args", "payload 必须是对象");
        }
        if (kind === "foundation") {
            const has = payload.locks ||
                payload.characters ||
                payload.planned ||
                payload.style ||
                payload.happened ||
                payload.threads ||
                payload.readerKnowledge;
            if (!has) {
                throw new ZhizhangError("empty_body", "foundation payload 至少填一个根基字段");
            }
        }
        else if (kind === "outline") {
            const chapter = String(payload.chapter ?? payload.chapterId ?? "").trim();
            if (!chapter)
                throw new ZhizhangError("bad_args", "outline payload 须含 chapter");
            const ending = String(payload.ending ?? "").trim();
            if (!ending)
                throw new ZhizhangError("bad_args", "outline payload 须含 ending（可兑付落点）");
        }
        else {
            if (typeof payload.content !== "string" || !payload.content.trim())
                throw new ZhizhangError("empty_body", "规划 payload 须含非空 content");
            if (kind === "volume_plan" || kind === "act_plan") {
                assertResourceId(payload.id, kind === "act_plan" ? "幕 id" : "卷 id");
                if (kind === "act_plan" && payload.volumeId) assertResourceId(payload.volumeId, "卷 id");
                if (payload.chapters !== undefined && (!Array.isArray(payload.chapters) || payload.chapters.some((id: any) => typeof id !== "string")))
                    throw new ZhizhangError("bad_args", "卷规划 chapters 须为章节 id 数组");
                for (const chapter of payload.chapters ?? []) assertResourceId(chapter, "章节 id");
            }
        }
        const candId = newId("icand");
        const now = nowIso();
        const cand = {
            schemaVersion: 1,
            id: candId,
            sessionId,
            kind,
            payload: { ...payload },
            // 卡组快照：acceptEmit(apply) 据此更新 bindings.json 索引，不必回读 session。
            cardIds: [...(session.cardIds ?? [])],
            sourceGoal: session.goal,
            ...(session.pace ? { pace: session.pace } : {}),
            status: "staged",
            createdAt: now,
            updatedAt: now,
        };
        const d = inspDirs(paths);
        const candidatePath = path.join(d.candidates, `${candId}.json`);
        if (await snapshotFile(candidatePath) !== null)
            throw new ZhizhangError("id_collision", "生成的灵感候选 id 已存在；未覆盖原文件，请重新尝试。");
        await atomicWrite(candidatePath, JSON.stringify(cand, null, 2) + "\n");
        let mindN = 0;
        let craftN = 0;
        let withMind = 0;
        let withFeel = 0;
        for (const id of session.cardIds) {
            try {
                const c = await LibraryPort.getCard(paths, id);
                if (coerceAxis(c) === "mind") {
                    mindN += 1;
                    if (c.mind)
                        withMind += 1;
                }
                else {
                    craftN += 1;
                    if (c.humanFeel)
                        withFeel += 1;
                }
            }
            catch {
                /* skip missing */
            }
        }
        const craftOnly = Boolean(session.craftOnly);
        const styleReminder = kind === "book_plan" || kind === "volume_plan" || kind === "act_plan"
            ? "写清本书或本卷的目标、变化和回报；来源只记录作者目标及所选卡，不推断已读或具体影响。"
            : kind === "foundation"
            ? `planned/locks/threads 主吃 mind（有 mind ${mindN} 张` +
                (withMind < mindN ? `，偏薄 ${mindN - withMind}` : "") +
                `）；style 可辅 craft（${craftN}，含写法 ${withFeel}）` +
                (craftOnly ? "；本会话 craft_only" : "") +
                "。写成可迁移设定/纲；章纲留追读余地。"
            : `ending/压力换对齐 mind.debtAndSwap；stateLens=场面状态（非声纹）；mind ${mindN} / craft ${craftN}` +
                (craftOnly ? "；craft_only" : "") +
                "。相邻章换压力/场面推进。";
        return { candId, kind, styleReminder };
        });
    },
    async acceptEmit(paths: StoragePaths, candId: any, opts: any) {
        await ensureInsp(paths);
        const id = assertResourceId(candId, "灵感候选 id");
        const d = inspDirs(paths);
        const candPath = path.join(d.candidates, `${id}.json`);
        return withResourceLock(paths.inspiration, async () => {
            await assertNoPendingInspiration(paths.inspiration);
            const candidateBefore = await snapshotFile(candPath);
            if (candidateBefore === null) throw new ZhizhangError("candidate_not_found", `找不到灵感候选 ${id}`);
            const cand = JSON.parse(await readFile(candPath, "utf8"));
            if (await snapshotFile(candPath) !== candidateBefore)
                throw new ZhizhangError("candidate_changed", "灵感候选在读取期间发生变化，请重新检查。");
            if (cand.status === "accepted" && cand.appliedWorkKey)
                throw new ZhizhangError("already_accepted", `灵感候选 ${id} 已采纳到 ${cand.appliedWorkKey}`);
            let workKey = String(opts.workKey ?? "").trim();
            if (!workKey) throw new ZhizhangError("bad_args", "workKey 不能为空");
            const now = nowIso();
            if (opts.apply !== true) {
                await atomicWrite(candPath, JSON.stringify({ ...cand, status: "accepted", updatedAt: now, acceptedAt: now }, null, 2) + "\n");
                return { candId: id, applied: false, workKey, detail: "仅标记采纳，未写入作品（apply=false）", bindingWarning: "" };
            }
            let dir: string;
            try { dir = await resolveWorkDir(paths, workKey); }
            catch (err) {
                if (!(err instanceof ZhizhangError) || err.code !== "work_not_found") throw err;
                dir = (await createWork(paths, { title: opts.title || workKey, genre: opts.genre, premise: opts.premise, key: workKey })).dir;
            }
            return withResourceLock(dir, async () => {
                const metaPath = path.join(dir, "meta.json");
                const metaBefore = await snapshotFile(metaPath);
                const meta = await readWorkMeta(dir);
                workKey = meta.key;
                if (workKey !== path.basename(dir))
                    throw new ZhizhangError("bad_work_meta", "作品目录与元数据 key 不一致；请保留并检查作品。 ");
                const pace = validateStoryPace(cand.pace);
                const writes: Array<{target: "work" | "inspiration"; file: string; before: string | null; content: string}> = [];
                let chapterId: string | undefined;
                let detail: string;
                const payload = cand.payload;
                if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ZhizhangError("bad_args", "灵感候选内容损坏，请保留原文件并检查。");
                if (cand.kind === "foundation") {
                    const patch: Record<string, string> = {};
                    for (const key of ["locks", "happened", "characters", "readerKnowledge", "planned", "threads", "style"])
                        if (typeof payload[key] === "string" && payload[key].trim()) patch[key] = payload[key];
                    if (!Object.keys(patch).length) throw new ZhizhangError("empty_body", "foundation payload 无可写入字段");
                    if (pace !== undefined) meta.pace = pace;
                    meta.foundation = normalizeFoundation({ ...meta.foundation, ...patch });
                    meta.updatedAt = nowIso();
                    writes.push({target: "work", file: "meta.json", before: metaBefore, content: JSON.stringify(meta, null, 2) + "\n"});
                    detail = `已 apply foundation → 作品「${meta.title}」（${meta.key}）：${Object.keys(patch).join("、")}${pace ? `；节奏 ${pace}` : ""}`;
                } else if (cand.kind === "book_plan" || cand.kind === "volume_plan" || cand.kind === "act_plan") {
                    if (typeof payload.content !== "string" || !payload.content.trim())
                        throw new ZhizhangError("empty_body", "规划内容为空，请检查候选。");
                    const planning = readPlanning(meta) ?? { schemaVersion: 1, volumes: [], acts: [] };
                    const source = {
                        sessionId: cand.sessionId,
                        candidateId: id,
                        authorGoal: typeof cand.sourceGoal === "string" ? cand.sourceGoal : "",
                        selectedCardIds: Array.isArray(cand.cardIds) ? [...cand.cardIds] : [],
                    };
                    if (cand.kind === "book_plan") {
                        planning.book = { ...(planning.book ?? {}), content: payload.content, source, updatedAt: now };
                        detail = `已应用全书规划 → 作品「${meta.title}」（${meta.key}）`;
                    } else if (cand.kind === "volume_plan") {
                        const volumeId = assertResourceId(payload.id, "卷 id");
                        if (payload.chapters !== undefined && (!Array.isArray(payload.chapters) || payload.chapters.some((ch: any) => typeof ch !== "string")))
                            throw new ZhizhangError("bad_args", "卷规划 chapters 须为章节 id 数组");
                        const chapters = [...new Set((payload.chapters ?? []).map((ch: string) => assertResourceId(ch, "章节 id")))];
                        const index = planning.volumes.findIndex((v: any) => v && v.id === volumeId);
                        const volume = { ...(index < 0 ? {} : planning.volumes[index]), id: volumeId, title: typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : volumeId, content: payload.content, chapters, source, updatedAt: now };
                        if (index < 0) planning.volumes.push(volume); else planning.volumes[index] = volume;
                        detail = `已应用卷规划「${volume.title}」 → 作品「${meta.title}」`;
                    } else {
                        const actId = assertResourceId(payload.id, "幕 id");
                        const volumeId = payload.volumeId ? assertResourceId(payload.volumeId, "卷 id") : "";
                        if (payload.chapters !== undefined && (!Array.isArray(payload.chapters) || payload.chapters.some((ch: any) => typeof ch !== "string")))
                            throw new ZhizhangError("bad_args", "幕规划 chapters 须为章节 id 数组");
                        const chapters = [...new Set((payload.chapters ?? []).map((ch: string) => assertResourceId(ch, "章节 id")))];
                        const index = planning.acts.findIndex((v: any) => v && v.id === actId);
                        const act = { ...(index < 0 ? {} : planning.acts[index]), id: actId, title: typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : actId, content: payload.content, volumeId, chapters, source, updatedAt: now };
                        if (index < 0) planning.acts.push(act); else planning.acts[index] = act;
                        detail = `已应用幕规划「${act.title}」 → 作品「${meta.title}」`;
                    }
                    planning.updatedAt = now;
                    meta.planning = planning;
                    if (pace !== undefined) meta.pace = pace;
                    meta.updatedAt = nowIso();
                    writes.push({target: "work", file: "meta.json", before: metaBefore, content: JSON.stringify(meta, null, 2) + "\n"});
                } else if (cand.kind === "outline") {
                    chapterId = assertResourceId(String(payload.chapter ?? payload.chapterId ?? "").trim(), "章节 id");
                    const chapterPath = path.join(dir, "chapters", `${chapterId}.md`);
                    const chapterBefore = await snapshotFile(chapterPath);
                    let previous: any = null;
                    try { previous = await readChapter(dir, chapterId); }
                    catch (err: any) { if (err?.code !== "ENOENT") throw err; }
                    const patch: Record<string, any> = {};
                    for (const key of ["pov", "locks", "knowledge", "synopsis", "conflict", "beats", "ending", "situationLens", "livedScene", "stateLens"])
                        if (typeof payload[key] === "string") patch[key] = payload[key];
                    if (!patch.stateLens && typeof payload.voiceTone === "string" && payload.voiceTone.trim()) patch.stateLens = payload.voiceTone;
                    if (typeof payload.targetWords === "number") patch.targetWords = payload.targetWords;
                    const prepared = await prepareChapterSaveUnlocked(dir, { id: chapterId, title: typeof payload.title === "string" ? payload.title : previous?.title ?? chapterId, body: previous?.body ?? "", position: previous?.position, status: previous?.status ?? "planned", outline: { ...(previous?.outline ?? {}), ...patch }, workPace: pace });
                    writes.push({target: "work", file: `chapters/${chapterId}.md`, before: chapterBefore, content: prepared.chapterContent});
                    writes.push({target: "work", file: "meta.json", before: metaBefore, content: prepared.metaContent});
                    detail = `已 apply outline → 作品「${meta.title}」章 ${chapterId}《${prepared.record.title}》${pace ? `；节奏 ${pace}` : ""}`;
                } else throw new ZhizhangError("bad_args", "灵感候选类型损坏，请保留原文件并检查。");
                const bPath = path.join(d.root, "bindings.json");
                const bBefore = await snapshotFile(bPath);
                const bindings = bBefore === null ? {} : JSON.parse(await readFile(bPath, "utf8"));
                if (!bindings || typeof bindings !== "object" || Array.isArray(bindings) || (bindings[workKey] !== undefined && !Array.isArray(bindings[workKey])))
                    throw new ZhizhangError("bad_bindings", "参考卡绑定索引格式损坏；请保留并检查原文件。");
                const ids = Array.isArray(cand.cardIds) ? cand.cardIds : [];
                const next = [...ids, ...(bindings[workKey] ?? [])].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 24);
                if (next.length) {
                    bindings[workKey] = next;
                    writes.push({target: "inspiration", file: "bindings.json", before: bBefore, content: JSON.stringify(bindings, null, 2) + "\n"});
                }
                writes.push({target: "inspiration", file: `candidates/${id}.json`, before: candidateBefore, content: JSON.stringify({ ...cand, status: "accepted", updatedAt: now, acceptedAt: now, appliedWorkKey: workKey }, null, 2) + "\n"});
                for (const w of writes) {
                    const file = path.join(w.target === "work" ? dir : paths.inspiration, w.file);
                    if (await snapshotFile(file) !== w.before) throw new ZhizhangError("inspiration_conflict", `${w.file} 在准备应用时发生变化，请重新核对。`);
                }
                try {
                    const journal = await createInspirationJournal(paths, { workKey, candidateId: id, chapterId, writes });
                    await finishInspirationJournal(paths, journal);
                } catch (err: any) {
                    if (err instanceof ZhizhangError) throw err;
                    throw new ZhizhangError("inspiration_recovery_required", `灵感应用未完成（${err?.message ?? String(err)}）。请用 zhizhang_inspire_status(recovery=inspect) 检查，不要重复应用。`);
                }
                return {candId:id, applied:true, workKey, detail, bindingWarning:""};
            });
        });
    },
    /**
     * Resolve technique cards for chapter_brief / writing path.
     * Priority: explicit cardIds → inspire sessions applied to work → none.
     * 不做「按 genre 猜卡」：技法卡不含题材词，猜出来也是无关卡。
     */
    async resolveCardsForBrief(paths: StoragePaths, opts: any = {}) {
        await ensureInsp(paths);
        await assertNoPendingInspiration(paths.inspiration);
        await LibraryPort.ensureLibrary(paths);
        const limit = Math.max(1, Math.min(opts.limit ?? 5, 12));
        const explicit = (opts.cardIds ?? []).map((id: string) => String(id).trim()).filter(Boolean);
        if (explicit.length > 0) {
            const cards = [];
            for (const id of explicit.slice(0, limit)) {
                const card = await LibraryPort.getCard(paths, id);
                if (card.status !== "accepted") {
                    throw new ZhizhangError("card_not_accepted", `技法卡 ${id} 尚未 accept，不能注入 chapter_brief`);
                }
                cards.push(card);
            }
            cards.sort((a: any, b: any) => {
                const aa = coerceAxis(a) === "craft" ? 0 : 1;
                const bb = coerceAxis(b) === "craft" ? 0 : 1;
                return aa - bb;
            });
            return {
                cards,
                source: "explicit",
                note: `显式 card_ids（${cards.length}；craft 优先）`,
                cardIds: cards.map((c: any) => c.id),
            };
        }
        const workKey = String(opts.workKey ?? "").trim();
        if (workKey) {
            const d = inspDirs(paths);
            // 快路径：bindings.json（acceptEmit apply 时维护的 workKey→cardIds 索引）。
            try {
                const bPath = path.join(d.root, "bindings.json");
                if (await fileExists(bPath)) {
                    const bindings = await readJsonCached(bPath);
                    const indexed = Array.isArray(bindings?.[workKey]) ? bindings[workKey] : [];
                    const cards = [];
                    for (const id of indexed.slice(0, limit)) {
                        try {
                            const card = await LibraryPort.getCard(paths, id);
                            if (card.status === "accepted")
                                cards.push(card);
                        }
                        catch {
                            /* skip */
                        }
                    }
                    if (cards.length > 0) {
                        return {
                            cards,
                            source: "inspire_apply",
                            note: `作品「${workKey}」绑定技法卡（${cards.length}；bindings 索引）`,
                            cardIds: cards.map((c: any) => c.id),
                        };
                    }
                }
            }
            catch {
                /* fall through to legacy scan */
            }
            // 旧数据回退：索引出现前的 accept 记录，仍扫 candidates/ 目录。
            const { readdir } = await import("node:fs/promises");
            const names = await readdir(d.candidates).catch(() => []);
            const hits = [];
            for (const name of names) {
                if (!name.endsWith(".json"))
                    continue;
                try {
                    const cand = await readJsonCached(path.join(d.candidates, name));
                    if (cand.status === "accepted" && cand.appliedWorkKey === workKey) {
                        hits.push({
                            at: cand.acceptedAt || cand.updatedAt || cand.createdAt,
                            sessionId: cand.sessionId,
                        });
                    }
                }
                catch {
                    /* skip */
                }
            }
            hits.sort((a: any, b: any) => (b.at || "").localeCompare(a.at || ""));
            const seen = new Set();
            const cardIds = [];
            for (const h of hits) {
                try {
                    const s = await InspirationPort.getSession(paths, h.sessionId);
                    for (const id of s.cardIds) {
                        if (seen.has(id))
                            continue;
                        seen.add(id);
                        cardIds.push(id);
                        if (cardIds.length >= limit)
                            break;
                    }
                }
                catch {
                    /* skip */
                }
                if (cardIds.length >= limit)
                    break;
            }
            if (cardIds.length > 0) {
                const cards = [];
                for (const id of cardIds) {
                    try {
                        const card = await LibraryPort.getCard(paths, id);
                        if (card.status === "accepted")
                            cards.push(card);
                    }
                    catch {
                        /* skip */
                    }
                }
                if (cards.length > 0) {
                    return {
                        cards,
                        source: "inspire_apply",
                        note: `作品「${workKey}」最近灵感 apply 绑定的技法卡（${cards.length}）`,
                        cardIds: cards.map((c: any) => c.id),
                    };
                }
            }
        }
        // 未发布：删掉「按 genre 检索」这条分支。技法卡是写法卡，不含题材词，
        // 实测任何作品 genre 都命中 0 条；留着只会让人以为有自动注入。
        // 注入只走两条明确路径：显式 card_ids（推荐先用 library_combo_suggest 组包），
        // 或本作品 inspire_accept(apply) 绑定过的卡。
        return {
            cards: [],
            source: "none",
            note: "未绑定技法卡：可按本书章纲与方法包继续创作；需要参考时可用 library_combo_suggest 选择 card_ids，或通过 inspire_accept(apply=true) 绑定。",
            cardIds: [],
        };
    },
    /**
     * Craft shatter/feel cue blob for Accept + human_feel_audit (same source).
     * Empty string when no craft cards or cues.
     */
    async resolveCraftCue(paths: StoragePaths, opts: any = {}) {
        try {
            const resolved = await InspirationPort.resolveCardsForBrief(paths, {
                workKey: opts.workKey,
                cardIds: opts.cardIds,
                limit: opts.limit ?? 5,
            });
            return resolved.cards
                .filter((c: any) => coerceAxis(c) === "craft")
                .map((c: any) => craftCueFromHumanFeel(coerceHumanFeel(c.humanFeel)))
                .join("\n");
        }
        catch {
            return "";
        }
    },
    /**
     * Markdown section for chapter_brief.
     * lean：只主注 craft（写法+状态）；mind 不整段灌句式。
     */
    formatCardsSection(cards: any, meta: any) {
        const lean = Boolean(meta.lean);
        const craftCards = cards.filter((c: any) => coerceAxis(c) === "craft");
        const mindCards = cards.filter((c: any) => coerceAxis(c) === "mind");
        const inject = lean ? craftCards : cards;
        const title = lean
            ? "## 技法卡（lean · craft 写法+状态）"
            : "## 拆书库卡（craft + mind）";
        if (inject.length === 0) {
            const extra = lean && mindCards.length > 0
                ? `（已绑定 ${mindCards.length} 张 mind，lean 正文不灌规划卡；设定/纲走 inspire。）`
                : "（无卡注入；方法包只管流程纪律。）";
            return [title, meta.note, extra].join("\n");
        }
        const thinFeel = craftCards.filter((c: any) => !c.humanFeel && !c.layer).length;
        const lines = [
            title,
            `- 来源：${meta.note}`,
            `- 来源码：${meta.source}`,
            `- 分轴：craft ${craftCards.length} · mind ${mindCards.length}` +
                (lean ? "（lean 只注入 craft）" : ""),
            lean
                ? "- 模式：lean（写法/状态/本场不完美/僵硬失败 + continueWhy；无机制/分析；mind 不灌）"
                : "- 模式：full",
            craftCards.length === 0
                ? "- （无 craft）"
                : thinFeel > 0
                    ? `- ⚠️ ${thinFeel}/${craftCards.length} 张 craft 写法/状态偏薄`
                    : `- ✓ craft 均含 humanFeel`,
            lean
                ? "先吃写法与场面状态；mind 供规划，不灌进 lean 当句式。"
                : "craft 吃写法；mind 吃创作思维。方法包 ≠ 本区。",
            "",
        ];
        for (const c of inject) {
            lines.push(lean ? formatTechniqueCardBlockLean(c) : formatTechniqueCardBlock(c));
            lines.push("");
        }
        if (lean) {
            const cue = craftCards
                .map((c: any) => craftCueFromHumanFeel(coerceHumanFeel(c.humanFeel)))
                .join("\n");
            if (hasShatterCraftCue(cue)) {
                lines.push(`> ${ANTI_STIFFNESS_BRIEF_LINE}`, "");
            }
        }
        if (lean && mindCards.length > 0) {
            lines.push(`- （另有 mind ${mindCards.length} 张未注入 lean：${mindCards.map((c: any) => c.id).join("、")}）`);
        }
        return lines.join("\n").trimEnd();
    },
};
