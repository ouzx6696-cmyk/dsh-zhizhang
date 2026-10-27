/** 抽样计划：Auto 10% 分层 / Full 全量（须显式同意）。 */
import path from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { atomicWrite } from "../../storage/primitives.js";
import { ZhizhangError } from "../../errors.js";
import { withResourceLock } from "../../storage/process-lock.js";
import { assertNoPendingCard } from "../../storage/card-journal.js";
import { snapshotFile } from "../../storage/recovery-common.js";
import { createPlanJournal, finishPlanJournal } from "../../storage/plan-journal.js";
import { AUTO_SAMPLE_HEAD, AUTO_SAMPLE_RATIO, AUTO_SAMPLE_TAIL } from "../../domain/workflow.js";
import { assertSourceId, ensureDir, nowIso, readJson } from "./paths.js";
export const PLAN_RATIO_DEFAULT = AUTO_SAMPLE_RATIO;
export const PLAN_RATIO_MIN = 0.05;
export const PLAN_RATIO_MAX = 1;
export const PLAN_BATCH_DEFAULT = 30000;
export const PLAN_BATCH_MIN = 4000;
export const PLAN_BATCH_MAX = 100000;
/** 10% 不足这个字数时，Auto 直接全读（小书）。 */
export const PLAN_SMALL_BOOK_CHARS = 30000;
/** 估算：中文约 1.4 字/token；每批 5 分钟（含读 + 白描）。 */
export const PLAN_CHARS_PER_TOKEN = 1.4;
export const PLAN_MINUTES_PER_BATCH = 5;
function planFiles(paths, sourceId) {
    const id = assertSourceId(sourceId);
    const dir = path.join(paths.library, "analyses", id);
    return {
        dir,
        json: path.join(dir, "plan.json"),
        md: path.join(dir, "plan.md"),
        pending: path.join(dir, "plan-confirm.json"),
    };
}
export function buildPlan(input) {
    const { sourceId, title, index, mode = "auto", ratio = PLAN_RATIO_DEFAULT, batchChars = PLAN_BATCH_DEFAULT } = input;
    const numbers = index.map((c) => c.n);
    if (new Set(numbers).size !== numbers.length)
        throw new ZhizhangError("ambiguous_chapter_numbers", "原文存在重复章号，不能按章号合并阅读计划；请按实际位置选片段分析或先明确章界，原文已保留。");
    const full = mode === "full";
    const ratioNum = Number(ratio);
    if (!full && (!Number.isFinite(ratioNum) || ratioNum < PLAN_RATIO_MIN || ratioNum > PLAN_RATIO_MAX)) {
        throw new ZhizhangError("bad_ratio", `比例须在 ${PLAN_RATIO_MIN}–${PLAN_RATIO_MAX} 之间（Auto 默认 ${PLAN_RATIO_DEFAULT}）`);
    }
    const chapters = index
        .filter((c) => Number(c.n) > 0)
        .map((c) => ({ n: Number(c.n), title: c.title, chars: Math.max(0, c.end - c.start) }))
        .filter((c) => c.chars > 0);
    if (chapters.length === 0)
        throw new ZhizhangError("bad_source", "没有可解析的章节（需「第N章 / 第一章 / 序章」标题）");
    const totalChars = chapters.reduce((s, c) => s + c.chars, 0);
    const picked = new Map();
    if (full) {
        for (const c of chapters)
            picked.set(c.n, "全量");
    }
    else {
        const targetChars = Math.round(totalChars * ratioNum);
        if (targetChars < PLAN_SMALL_BOOK_CHARS) {
            for (const c of chapters)
                picked.set(c.n, "auto:全读（小书）");
        }
        else {
            const targetN = Math.max(1, Math.round(chapters.length * ratioNum));
            const head = Math.min(AUTO_SAMPLE_HEAD, chapters.length);
            for (let i = 0; i < head; i++)
                picked.set(chapters[i].n, "开篇");
            const tail = Math.min(AUTO_SAMPLE_TAIL, chapters.length);
            for (let i = chapters.length - tail; i < chapters.length; i++)
                picked.set(chapters[i].n, "收束");
            const interior = chapters.filter((c) => !picked.has(c.n));
            const want = Math.max(0, targetN - picked.size);
            if (want > 0 && interior.length > 0) {
                const cum = [];
                let acc = 0;
                for (const c of interior) {
                    acc += c.chars;
                    cum.push(acc);
                }
                const total = acc;
                let taken = 0;
                for (let k = 0; k < want && taken < interior.length; k++) {
                    const pos = (k + 0.5) * (total / want);
                    let idx = cum.findIndex((v) => v >= pos);
                    if (idx < 0)
                        idx = interior.length - 1;
                    while (idx < interior.length && picked.has(interior[idx].n))
                        idx += 1;
                    if (idx >= interior.length)
                        break;
                    picked.set(interior[idx].n, "等距");
                    taken += 1;
                }
            }
        }
    }
    const picks = chapters
        .filter((c) => picked.has(c.n))
        .map((c) => ({ ...c, reason: picked.get(c.n) }));
    const batches = [];
    let cur = null;
    for (const p of picks) {
        if (!cur || cur.chars + p.chars > batchChars) {
            cur = { i: batches.length, chapters: [], chars: 0 };
            batches.push(cur);
        }
        cur.chapters.push(p.n);
        cur.chars += p.chars;
    }
    const planChars = picks.reduce((s, p) => s + p.chars, 0);
    return {
        schemaVersion: 1,
        sourceId,
        title: title ?? "",
        mode: full ? "full" : "auto",
        ratio: full ? 1 : ratioNum,
        totalChapters: chapters.length,
        totalChars,
        planChapters: picks.length,
        planChars,
        batchChars,
        chapters: picks.map((c) => ({ n: c.n, title: c.title, chars: c.chars, reason: c.reason })),
        batches: batches.map((b) => ({ i: b.i, chapters: b.chapters, chars: b.chars })),
        cursor: 0,
        createdAt: nowIso(),
    };
}
export function estimatePlan(plan) {
    const tokens = Math.round(plan.planChars / PLAN_CHARS_PER_TOKEN);
    const batches = plan.batches.length;
    const minutes = batches * PLAN_MINUTES_PER_BATCH;
    return {
        tokens,
        batches,
        minutes,
        hours: Number((minutes / 60).toFixed(1)),
        chars: plan.planChars,
        chapters: plan.planChapters,
        ratio: plan.totalChars > 0 ? Number((plan.planChars / plan.totalChars).toFixed(3)) : 0,
    };
}
export function planLabel(plan) {
    if (!plan)
        return "未建计划（旧模式：按 from/count 取批）";
    if (plan.mode === "full")
        return `Full 全量（${plan.planChapters}/${plan.totalChapters} 章）`;
    if (plan.chapters.length > 0 && plan.chapters.every((c) => c.reason === "auto:全读（小书）"))
        return `Auto 全读（小书）· ${plan.planChapters}/${plan.totalChapters} 章`;
    const pct = Math.round((plan.planChars / Math.max(1, plan.totalChars)) * 100);
    return `Auto ${Math.round(plan.ratio * 100)}%（实取 ${pct}%：${plan.planChapters}/${plan.totalChapters} 章 / ${plan.planChars} 字）`;
}
export async function writePlan(paths, plan, options = {}) {
    return withResourceLock(paths.library, async () => {
        await assertNoPendingCard(paths.library);
        const sourceId = assertSourceId(plan.sourceId);
        const f = planFiles(paths, sourceId);
        await ensureDir(f.dir);
        const metaPath = path.join(f.dir, "meta.json");
        const [jsonBefore, mdBefore, metaBefore, pendingBefore] = await Promise.all([
            snapshotFile(f.json), snapshotFile(f.md), snapshotFile(metaPath), options.clearConfirm === true ? snapshotFile(f.pending) : Promise.resolve(null),
        ]);
        if (options.clearConfirm === true) {
            await assertFullConsent(paths, sourceId, options.confirmToken, { batchChars: plan.batchChars, totalChapters: plan.totalChapters, planChapters: plan.planChapters });
            if (await snapshotFile(f.pending) !== pendingBefore)
                throw new ZhizhangError("library_recovery_conflict", "全量确认凭据在准备期间变化，请重新检查。");
        }
        const meta = (await readJson(metaPath, null)) ?? { schemaVersion: 2, sourceId, stage: "meta" };
        if (!meta || typeof meta !== "object" || Array.isArray(meta))
            throw new ZhizhangError("bad_analysis", "拆书分析元数据损坏，请保留并核对。");
        const nextMeta = { ...meta, scope: { ...(meta.scope ?? {}), mode: plan.mode, chapters: plan.planChapters }, updatedAt: nowIso() };
        if (await snapshotFile(metaPath) !== metaBefore)
            throw new ZhizhangError("library_recovery_conflict", "计划元数据在准备期间变化，请重新检查。");
        const prefix = `analyses/${sourceId}`;
        const writes = [
            { file: `${prefix}/plan.json`, before: jsonBefore, content: JSON.stringify(plan, null, 2) },
            { file: `${prefix}/plan.md`, before: mdBefore, content: renderPlanMarkdown(plan) },
            { file: `${prefix}/meta.json`, before: metaBefore, content: JSON.stringify(nextMeta, null, 2) + "\n" },
        ];
        if (options.clearConfirm === true)
            writes.push({ file: `${prefix}/plan-confirm.json`, before: pendingBefore });
        const journal = await createPlanJournal(paths.library, { sourceId, clearConfirm: options.clearConfirm === true, writes });
        try {
            await finishPlanJournal(paths.library, journal);
        }
        catch (err) {
            if (err instanceof ZhizhangError)
                throw err;
            throw new ZhizhangError("library_recovery_required", `拆书计划更新未完成（${err?.message ?? String(err)}），请先检查恢复记录。`);
        }
    });
}
export async function readPlan(paths, sourceId) {
    return withResourceLock(paths.library, async () => {
        await assertNoPendingCard(paths.library);
        const f = planFiles(paths, sourceId);
        try {
            return JSON.parse(await readFile(f.json, "utf8"));
        }
        catch (err) {
            if (err?.code === "ENOENT")
                return null;
            throw err;
        }
    });
}
export function renderPlanMarkdown(plan) {
    const est = estimatePlan(plan);
    const lines = [
        `# 抽样计划 · ${plan.title || plan.sourceId}`,
        "",
        `- 档位：**${planLabel(plan)}**`,
        `- 全书：${plan.totalChapters} 章 / ${plan.totalChars} 字`,
        `- 计划：${plan.planChapters} 章 / ${plan.planChars} 字（${est.ratio ? Math.round(est.ratio * 100) : 0}%）`,
        `- 分批：${est.batches} 批（每批 ≤ ${plan.batchChars} 字）`,
        `- 估算：约 ${est.tokens} tokens · 顺序约 ${est.hours} 小时`,
        plan.mode === "full" && plan.consent ? `- 同意：${plan.consent.at}（${plan.consent.note || "作者明确要求全量"}）` : "",
        "",
        "## 批次",
        "| 批 | 章 | 字数 |",
        "| --- | --- | --- |",
        ...plan.batches.map((b) => `| ${b.i} | ${b.chapters.join("、")} | ${b.chars} |`),
        "",
        "## 入选章与理由",
        "| 章 | 标题 | 字数 | 理由 |",
        "| --- | --- | --- | --- |",
        ...plan.chapters.map((c) => `| ${c.n} | ${c.title} | ${c.chars} | ${c.reason} |`),
        "",
    ];
    return lines.join("\n");
}
export async function deletePlan(paths, sourceId) {
    const f = planFiles(paths, sourceId);
    for (const p of [f.json, f.md, f.pending]) {
        try {
            await unlink(p);
        }
        catch (err) {
            if (err?.code !== "ENOENT")
                throw err;
        }
    }
}
export function makeConfirmToken() {
    return `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
/**
 * Full 闸留痕：estimate + 参数快照（batchChars/totalChapters/planChapters）。
 * confirm 时断言参数一致——作者同意的是回执上的数字，不是换参后的重建计划。
 */
export async function writePendingConfirm(paths, sourceId, token, estimate, params) {
    const f = planFiles(paths, sourceId);
    await ensureDir(f.dir);
    const body = {
        sourceId,
        token,
        estimate,
        params: params ?? null,
        expiresAt: Date.now() + 30 * 60 * 1000,
        createdAt: nowIso(),
    };
    await atomicWrite(f.pending, JSON.stringify(body, null, 2));
    return body;
}
export async function readPendingConfirm(paths, sourceId) {
    const f = planFiles(paths, sourceId);
    try {
        return JSON.parse(await readFile(f.pending, "utf8"));
    }
    catch (err) {
        if (err?.code === "ENOENT")
            return null;
        throw err;
    }
}
/** Full 闸：token 必须存在、未过期、来源一致，且建计划参数与回执一致（若有快照）。 */
export async function assertFullConsent(paths, sourceId, token, current) {
    const pending = await readPendingConfirm(paths, sourceId);
    if (!pending)
        throw new ZhizhangError("full_needs_consent", "Full 未生成成本回执：先调用 library_plan(mode=full) 看估算，再由作者明确同意");
    if (pending.sourceId !== sourceId)
        throw new ZhizhangError("bad_confirm_token", "确认 token 与 source 不匹配");
    if (Date.now() > Number(pending.expiresAt ?? 0))
        throw new ZhizhangError("confirm_expired", "确认已过期（30 分钟）：请重新生成成本回执");
    if (!token || token !== pending.token)
        throw new ZhizhangError("bad_confirm_token", "确认 token 不正确：须原样回传 library_plan(mode=full) 回执里的 confirm_token");
    if (current && pending.params && typeof pending.params === "object") {
        const drift = [];
        for (const key of ["batchChars", "totalChapters", "planChapters"]) {
            const before = Number(pending.params[key]);
            const nowVal = Number(current[key]);
            if (Number.isFinite(before) && Number.isFinite(nowVal) && before !== nowVal) {
                drift.push(`${key} ${before}→${nowVal}`);
            }
        }
        if (drift.length > 0) {
            throw new ZhizhangError("bad_confirm_token", `确认参数与成本回执不一致（${drift.join("；")}）：请重新 library_plan(mode=full) 生成回执并再次取得作者同意`);
        }
    }
    return pending;
}
export async function clearPendingConfirm(paths, sourceId) {
    try {
        await unlink(planFiles(paths, sourceId).pending);
    }
    catch (err) {
        if (err?.code !== "ENOENT")
            throw err;
    }
}
export function planProgress(plan, facts) {
    const have = new Set(facts.map((f) => Number(f.n)));
    const done = plan.chapters.filter((c) => have.has(Number(c.n))).length;
    let cursor = 0;
    for (const b of plan.batches) {
        if (b.chapters.every((n) => have.has(Number(n))))
            cursor = b.i + 1;
        else
            break;
    }
    return {
        done,
        total: plan.chapters.length,
        charsDone: plan.chapters.filter((c) => have.has(Number(c.n))).reduce((s, c) => s + (c.chars || 0), 0),
        cursor,
        batches: plan.batches.length,
        nextBatch: cursor < plan.batches.length ? plan.batches[cursor] : null,
    };
}
/** 事实章号是否在计划内；不在则返回提示（不硬拒，允许作者手补）。 */
export function planMembership(plan, n) {
    if (!plan)
        return { inPlan: true, reason: null };
    const hit = plan.chapters.find((c) => Number(c.n) === Number(n));
    return hit
        ? { inPlan: true, reason: hit.reason }
        : { inPlan: false, reason: `第 ${n} 章不在 ${planLabel(plan)} 计划内（手补会标为计划外）` };
}
