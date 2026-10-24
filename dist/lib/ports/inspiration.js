/**
 * InspirationPort — 灵感推演支柱（live）。
 * Session + Library cards + MethodRegistry develop/plan → stage foundation/outline → explicit accept (optional apply to work).
 * Does not silently foundation_set.
 */
import { mkdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
import { atomicWrite, createWork, resolveWorkDir, saveChapter, setFoundation, readChapter, readWorkMeta, withLock, } from "../store.js";
import { readJsonCached } from "../file-cache.js";
import { LibraryPort, ANTI_STIFFNESS_BRIEF_LINE, coerceAxis, coerceHumanFeel, craftCueFromHumanFeel, formatTechniqueCardBlock, formatTechniqueCardBlockLean, hasShatterCraftCue, } from "./library.js";
import { MethodRegistry } from "./methods.js";
import { QualityPolicy } from "./quality-policy.js";
function nowIso() {
    return new Date().toISOString();
}
let idSeq = 0;
function newId(prefix) {
    idSeq += 1;
    return `${prefix}-${Date.now().toString(36)}${idSeq.toString(36)}`;
}
async function fileExists(p) {
    try {
        await access(p);
        return true;
    }
    catch {
        return false;
    }
}
function inspDirs(paths) {
    return {
        root: paths.inspiration,
        sessions: path.join(paths.inspiration, "sessions"),
        candidates: path.join(paths.inspiration, "candidates"),
    };
}
async function ensureInsp(paths) {
    const d = inspDirs(paths);
    await mkdir(d.sessions, { recursive: true });
    await mkdir(d.candidates, { recursive: true });
}
export const InspirationPort = {
    id: "port.inspiration",
    status: "live",
    title: "灵感推演",
    summary: "闭环第2段：combo/card_ids → forge（mind 主粮 + craft 辅）→ stage 根基/章纲 → accept(apply?) → 交给写作 brief。不静默 foundation_set。",
    capabilities() {
        return [
            { id: "session", title: "灵感会话（须 mind 或 craft_only）", ready: true },
            { id: "forge_with_cards", title: "结合 mind/craft 分喂推演", ready: true },
            { id: "emit_foundation", title: "暂存根基候选", ready: true },
            { id: "emit_outline", title: "暂存章纲候选", ready: true },
            { id: "accept_apply", title: "显式采纳（可选写入作品）", ready: true },
        ];
    },
    async startSession(paths, input) {
        await ensureInsp(paths);
        await LibraryPort.ensureLibrary(paths);
        const goal = String(input.goal ?? "").trim();
        if (!goal)
            throw new ZhizhangError("bad_args", "goal 不能为空");
        // combo 回执里每张卡 id 会出现多次（card_ids 行 + 明细行），照抄传入是常态——
        // 不去重会让 forge 把同一张卡整段渲染两遍，分轴计数也翻倍。
        const cardIds = [...new Set((input.cardIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
        if (cardIds.length === 0) {
            throw new ZhizhangError("bad_args", "cardIds 至少一张已采纳卡");
        }
        const craftOnly = Boolean(input.craftOnly);
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
        if (mindCount === 0 && !craftOnly) {
            throw new ZhizhangError("mind_required", "灵感规划须至少一张 axis=mind 创作思维卡；若仅技法试写请传 craft_only=true");
        }
        const sessionId = newId("insp");
        const now = nowIso();
        const session = {
            schemaVersion: 1,
            id: sessionId,
            goal,
            genre: String(input.genre ?? "").trim(),
            cardIds,
            createdAt: now,
            updatedAt: now,
        };
        if (craftOnly)
            session.craftOnly = true;
        const d = inspDirs(paths);
        await atomicWrite(path.join(d.sessions, `${sessionId}.json`), JSON.stringify(session, null, 2) + "\n");
        return { sessionId, craftOnly, mindCount, craftCount };
    },
    async getSession(paths, sessionId) {
        await ensureInsp(paths);
        const d = inspDirs(paths);
        const p = path.join(d.sessions, `${sessionId}.json`);
        if (!(await fileExists(p))) {
            throw new ZhizhangError("session_not_found", `找不到灵感会话 ${sessionId}`);
        }
        return readJsonCached(p);
    },
    async listSessions(paths) {
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
        rows.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        return rows;
    },
    async forgeBrief(paths, sessionId) {
        const session = await InspirationPort.getSession(paths, sessionId);
        const cards = [];
        for (const id of session.cardIds) {
            cards.push(await LibraryPort.getCard(paths, id));
        }
        const develop = MethodRegistry.get("develop");
        const plan = MethodRegistry.get("plan");
        const tomato = MethodRegistry.get("tomato_four_q");
        const mindCards = cards.filter((c) => coerceAxis(c) === "mind");
        const craftCards = cards.filter((c) => coerceAxis(c) !== "mind");
        const thinMind = mindCards.filter((c) => !c.mind && !c.layer).length;
        const thinFeel = craftCards.filter((c) => !c.humanFeel && !c.layer).length;
        const craftOnly = Boolean(session.craftOnly);
        const lines = [
            `# 灵感推演简报 · ${sessionId}`,
            `- goal：${session.goal}`,
            `- genre：${session.genre || "（未填）"}`,
            `- 卡：${session.cardIds.join("、")}`,
            `- 分轴：mind ${mindCards.length} · craft ${craftCards.length}` +
                (craftOnly ? " · **仅技法试写（craft_only）**" : ""),
            mindCards.length === 0
                ? `- ⚠️ 无 mind 卡` + (craftOnly ? "（已声明仅技法试写）" : "")
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
                : "（无 mind 卡 — 不应到达此处；请补 mind 或 craft_only。）");
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
        lines.push("## 输出要求");
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
    },
    async stageEmit(paths, sessionId, input) {
        const session = await InspirationPort.getSession(paths, sessionId);
        const kind = input.kind;
        if (kind !== "foundation" && kind !== "outline") {
            throw new ZhizhangError("bad_args", "kind 须为 foundation 或 outline");
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
        else {
            const chapter = String(payload.chapter ?? payload.chapterId ?? "").trim();
            if (!chapter)
                throw new ZhizhangError("bad_args", "outline payload 须含 chapter");
            const ending = String(payload.ending ?? "").trim();
            if (!ending)
                throw new ZhizhangError("bad_args", "outline payload 须含 ending（可兑付落点）");
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
            status: "staged",
            createdAt: now,
            updatedAt: now,
        };
        const d = inspDirs(paths);
        await atomicWrite(path.join(d.candidates, `${candId}.json`), JSON.stringify(cand, null, 2) + "\n");
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
        const styleReminder = kind === "foundation"
            ? `planned/locks/threads 主吃 mind（有 mind ${mindN} 张` +
                (withMind < mindN ? `，偏薄 ${mindN - withMind}` : "") +
                `）；style 可辅 craft（${craftN}，含写法 ${withFeel}）` +
                (craftOnly ? "；本会话 craft_only" : "") +
                "。写成可迁移设定/纲；章纲留追读余地。"
            : `ending/压力换对齐 mind.debtAndSwap；stateLens=场面状态（非声纹）；mind ${mindN} / craft ${craftN}` +
                (craftOnly ? "；craft_only" : "") +
                "。相邻章换压力/场面推进。";
        return { candId, kind, styleReminder };
    },
    async acceptEmit(paths, candId, opts) {
        await ensureInsp(paths);
        const d = inspDirs(paths);
        const candPath = path.join(d.candidates, `${candId}.json`);
        // 读候选 → 查已采纳 → apply 写作品 → 回写候选状态 全程持锁：
        // 并发双 accept 只能一个生效，另一个在锁内看到 accepted 硬拒。
        return withLock(`inspiration:${paths.inspiration}`, async () => {
            if (!(await fileExists(candPath))) {
                throw new ZhizhangError("candidate_not_found", `找不到灵感候选 ${candId}`);
            }
            const cand = JSON.parse(await readFile(candPath, "utf8"));
            if (cand.status === "accepted" && cand.appliedWorkKey) {
                throw new ZhizhangError("already_accepted", `灵感候选 ${candId} 已采纳到 ${cand.appliedWorkKey}`);
            }
            const workKey = String(opts.workKey ?? "").trim();
            if (!workKey)
                throw new ZhizhangError("bad_args", "workKey 不能为空");
            const apply = Boolean(opts.apply);
            let detail = "仅标记采纳，未写入作品（apply=false）";
            if (apply) {
                // Ensure work exists
                let dir;
                try {
                    dir = await resolveWorkDir(paths, workKey);
                }
                catch {
                    const created = await createWork(paths, {
                        title: opts.title || workKey,
                        genre: opts.genre,
                        premise: opts.premise,
                        key: workKey,
                    });
                    dir = created.dir;
                }
                if (cand.kind === "foundation") {
                    const p = cand.payload;
                    const patch = {};
                    for (const key of [
                        "locks",
                        "happened",
                        "characters",
                        "readerKnowledge",
                        "planned",
                        "threads",
                        "style",
                    ]) {
                        if (typeof p[key] === "string" && String(p[key]).trim()) {
                            patch[key] = String(p[key]);
                        }
                    }
                    if (Object.keys(patch).length === 0) {
                        throw new ZhizhangError("empty_body", "foundation payload 无可写入字段");
                    }
                    const meta = await setFoundation(dir, patch);
                    detail = `已 apply foundation → 作品「${meta.title}」（${meta.key}）：${Object.keys(patch).join("、")}`;
                }
                else {
                    const p = cand.payload;
                    const chapterId = String(p.chapter ?? p.chapterId ?? "").trim();
                    const outlinePatch = {};
                    for (const key of [
                        "pov",
                        "locks",
                        "knowledge",
                        "synopsis",
                        "conflict",
                        "beats",
                        "ending",
                        "situationLens",
                        "livedScene",
                        "stateLens",
                    ]) {
                        if (typeof p[key] === "string")
                            outlinePatch[key] = String(p[key]);
                    }
                    // legacy alias
                    const legacy = p;
                    if (typeof legacy.voiceTone === "string" && String(legacy.voiceTone).trim()) {
                        if (!outlinePatch.stateLens)
                            outlinePatch.stateLens = String(legacy.voiceTone);
                    }
                    if (typeof legacy.targetWords === "number")
                        outlinePatch.targetWords = legacy.targetWords;
                    let title = typeof p.title === "string" ? p.title : undefined;
                    let body = "";
                    let position;
                    let status;
                    try {
                        const existing = await readChapter(dir, chapterId);
                        title = title ?? existing.title;
                        body = existing.body;
                        position = existing.position;
                        status = existing.status;
                        Object.assign(outlinePatch, { ...existing.outline, ...outlinePatch });
                    }
                    catch (e) {
                        // 只有"章文件不存在"才是新建。front matter 损坏时若当新建处理，
                        // 下面的 saveChapter 会用空 body 覆盖掉原稿。
                        if (e?.code !== "ENOENT")
                            throw e;
                        title = title ?? chapterId;
                        status = "planned";
                    }
                    await saveChapter(dir, {
                        id: chapterId,
                        title: title,
                        body,
                        position,
                        status: status,
                        outline: outlinePatch,
                    });
                    const meta = await readWorkMeta(dir);
                    detail = `已 apply outline → 作品「${meta.title}」章 ${chapterId}《${title}》`;
                }
                // workKey→cardIds 索引（bindings.json）：resolveCardsForBrief 先读这里，
                // 免得每次 brief 都扫 candidates/ 全目录。仍在 acceptEmit 锁内，无并发写。
                try {
                    const bPath = path.join(d.root, "bindings.json");
                    const bindings = (await fileExists(bPath))
                        ? await readJsonCached(bPath)
                        : {};
                    const prev = Array.isArray(bindings?.[workKey]) ? bindings[workKey] : [];
                    const ids = Array.isArray(cand.cardIds) ? cand.cardIds : [];
                    const next = [...ids, ...prev].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 24);
                    if (next.length > 0) {
                        bindings[workKey] = next;
                        await atomicWrite(bPath, JSON.stringify(bindings, null, 2) + "\n");
                    }
                }
                catch {
                    /* 索引失败不阻断 accept */
                }
            }
            const now = nowIso();
            const updated = {
                ...cand,
                status: "accepted",
                updatedAt: now,
                acceptedAt: now,
                appliedWorkKey: apply ? workKey : cand.appliedWorkKey,
            };
            await atomicWrite(candPath, JSON.stringify(updated, null, 2) + "\n");
            return { candId, applied: apply, workKey, detail };
        });
    },
    /**
     * Resolve technique cards for chapter_brief / writing path.
     * Priority: explicit cardIds → inspire sessions applied to work → none.
     * 不做「按 genre 猜卡」：技法卡不含题材词，猜出来也是无关卡。
     */
    async resolveCardsForBrief(paths, opts = {}) {
        await ensureInsp(paths);
        await LibraryPort.ensureLibrary(paths);
        const limit = Math.max(1, Math.min(opts.limit ?? 5, 12));
        const explicit = (opts.cardIds ?? []).map((id) => String(id).trim()).filter(Boolean);
        if (explicit.length > 0) {
            const cards = [];
            for (const id of explicit.slice(0, limit)) {
                const card = await LibraryPort.getCard(paths, id);
                if (card.status !== "accepted") {
                    throw new ZhizhangError("card_not_accepted", `技法卡 ${id} 尚未 accept，不能注入 chapter_brief`);
                }
                cards.push(card);
            }
            cards.sort((a, b) => {
                const aa = coerceAxis(a) === "craft" ? 0 : 1;
                const bb = coerceAxis(b) === "craft" ? 0 : 1;
                return aa - bb;
            });
            return {
                cards,
                source: "explicit",
                note: `显式 card_ids（${cards.length}；craft 优先）`,
                cardIds: cards.map((c) => c.id),
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
                            cardIds: cards.map((c) => c.id),
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
            hits.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
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
                        cardIds: cards.map((c) => c.id),
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
            note: "未绑定技法卡：先跑 library_combo_suggest 取「1 book + N scene」的 card_ids 再传 card_ids；或先 inspire_accept(apply=true) 把卡绑到本作品，之后自动继承",
            cardIds: [],
        };
    },
    /**
     * Craft shatter/feel cue blob for Accept + human_feel_audit (same source).
     * Empty string when no craft cards or cues.
     */
    async resolveCraftCue(paths, opts = {}) {
        try {
            const resolved = await InspirationPort.resolveCardsForBrief(paths, {
                workKey: opts.workKey,
                cardIds: opts.cardIds,
                limit: opts.limit ?? 5,
            });
            return resolved.cards
                .filter((c) => coerceAxis(c) === "craft")
                .map((c) => craftCueFromHumanFeel(coerceHumanFeel(c.humanFeel)))
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
    formatCardsSection(cards, meta) {
        const lean = Boolean(meta.lean);
        const craftCards = cards.filter((c) => coerceAxis(c) === "craft");
        const mindCards = cards.filter((c) => coerceAxis(c) === "mind");
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
        const thinFeel = craftCards.filter((c) => !c.humanFeel && !c.layer).length;
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
                .map((c) => craftCueFromHumanFeel(coerceHumanFeel(c.humanFeel)))
                .join("\n");
            if (hasShatterCraftCue(cue)) {
                lines.push(`> ${ANTI_STIFFNESS_BRIEF_LINE}`, "");
            }
        }
        if (lean && mindCards.length > 0) {
            lines.push(`- （另有 mind ${mindCards.length} 张未注入 lean：${mindCards.map((c) => c.id).join("、")}）`);
        }
        return lines.join("\n").trimEnd();
    },
};
