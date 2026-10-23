/** 抽样计划：Auto 10% 分层 / Full 全量（须显式同意）。 */
import path from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { atomicWrite } from "../../store.js";
import type { StoragePaths } from "../../types.js";
import { ZhizhangError } from "../../errors.js";
import { AUTO_SAMPLE_HEAD, AUTO_SAMPLE_RATIO, AUTO_SAMPLE_TAIL } from "../../domain/workflow.js";
import { assertSourceId, ensureDir, nowIso } from "./paths.js";

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

function planFiles(paths: StoragePaths, sourceId: any) {
    const id = assertSourceId(sourceId);
    const dir = path.join(paths.library, "analyses", id);
    return {
        dir,
        json: path.join(dir, "plan.json"),
        md: path.join(dir, "plan.md"),
        pending: path.join(dir, "plan-confirm.json"),
    };
}

export function buildPlan(input: any) {
    const { sourceId, title, index, mode = "auto", ratio = PLAN_RATIO_DEFAULT, batchChars = PLAN_BATCH_DEFAULT } = input;
    const full = mode === "full";
    const ratioNum = Number(ratio);
    if (!full && (!Number.isFinite(ratioNum) || ratioNum < PLAN_RATIO_MIN || ratioNum > PLAN_RATIO_MAX)) {
        throw new ZhizhangError("bad_ratio", `比例须在 ${PLAN_RATIO_MIN}–${PLAN_RATIO_MAX} 之间（Auto 默认 ${PLAN_RATIO_DEFAULT}）`);
    }
    const chapters = index
        .filter((c: any) => Number(c.n) > 0)
        .map((c: any) => ({ n: Number(c.n), title: c.title, chars: Math.max(0, c.end - c.start) }))
        .filter((c: any) => c.chars > 0);
    if (chapters.length === 0)
        throw new ZhizhangError("bad_source", "没有可解析的章节（需「第N章 / 第一章 / 序章」标题）");
    const totalChars = chapters.reduce((s: string, c: any) => s + c.chars, 0);
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
            const interior = chapters.filter((c: any) => !picked.has(c.n));
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
                    let idx = cum.findIndex((v: any) => v >= pos);
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
        .filter((c: any) => picked.has(c.n))
        .map((c: any) => ({ ...c, reason: picked.get(c.n) }));
    const batches = [];
    let cur: { i: number; chapters: number[]; chars: number } | null = null;
    for (const p of picks) {
        if (!cur || cur.chars + p.chars > batchChars) {
            cur = { i: batches.length, chapters: [], chars: 0 };
            batches.push(cur);
        }
        cur.chapters.push(p.n);
        cur.chars += p.chars;
    }
    const planChars = picks.reduce((s: number, p: any) => s + p.chars, 0);
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
        chapters: picks.map((c: any) => ({ n: c.n, title: c.title, chars: c.chars, reason: c.reason })),
        batches: batches.map((b: any) => ({ i: b.i, chapters: b.chapters, chars: b.chars })),
        cursor: 0,
        createdAt: nowIso(),
    };
}

export function estimatePlan(plan: any) {
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

export function planLabel(plan: any) {
    if (!plan)
        return "未建计划（旧模式：按 from/count 取批）";
    if (plan.mode === "full")
        return `Full 全量（${plan.planChapters}/${plan.totalChapters} 章）`;
    if (plan.chapters.length > 0 && plan.chapters.every((c: any) => c.reason === "auto:全读（小书）"))
        return `Auto 全读（小书）· ${plan.planChapters}/${plan.totalChapters} 章`;
    const pct = Math.round((plan.planChars / Math.max(1, plan.totalChars)) * 100);
    return `Auto ${Math.round(plan.ratio * 100)}%（实取 ${pct}%：${plan.planChapters}/${plan.totalChapters} 章 / ${plan.planChars} 字）`;
}

export async function writePlan(paths: StoragePaths, plan: any) {
    const f = planFiles(paths, plan.sourceId);
    await ensureDir(f.dir);
    await atomicWrite(f.json, JSON.stringify(plan, null, 2));
    await atomicWrite(f.md, renderPlanMarkdown(plan));
}

export async function readPlan(paths: StoragePaths, sourceId: any) {
    const f = planFiles(paths, sourceId);
    try {
        return JSON.parse(await readFile(f.json, "utf8"));
    }
    catch {
        return null;
    }
}

export function renderPlanMarkdown(plan: any) {
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
        ...plan.batches.map((b: any) => `| ${b.i} | ${b.chapters.join("、")} | ${b.chars} |`),
        "",
        "## 入选章与理由",
        "| 章 | 标题 | 字数 | 理由 |",
        "| --- | --- | --- | --- |",
        ...plan.chapters.map((c: any) => `| ${c.n} | ${c.title} | ${c.chars} | ${c.reason} |`),
        "",
    ];
    return lines.join("\n");
}

export async function deletePlan(paths: StoragePaths, sourceId: any) {
    const f = planFiles(paths, sourceId);
    for (const p of [f.json, f.md, f.pending]) {
        try {
            await unlink(p);
        }
        catch {
            /* ignore */
        }
    }
}

export function makeConfirmToken() {
    return `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function writePendingConfirm(paths: StoragePaths, sourceId: any, token: any, estimate: any) {
    const f = planFiles(paths, sourceId);
    await ensureDir(f.dir);
    const body = { sourceId, token, estimate, expiresAt: Date.now() + 30 * 60 * 1000, createdAt: nowIso() };
    await atomicWrite(f.pending, JSON.stringify(body, null, 2));
    return body;
}

export async function readPendingConfirm(paths: StoragePaths, sourceId: any) {
    const f = planFiles(paths, sourceId);
    try {
        return JSON.parse(await readFile(f.pending, "utf8"));
    }
    catch {
        return null;
    }
}

/** Full 闸：token 必须存在、未过期、来源一致。 */
export async function assertFullConsent(paths: StoragePaths, sourceId: any, token: any) {
    const pending = await readPendingConfirm(paths, sourceId);
    if (!pending)
        throw new ZhizhangError("full_needs_consent", "Full 未生成成本回执：先调用 library_plan(mode=full) 看估算，再由作者明确同意");
    if (pending.sourceId !== sourceId)
        throw new ZhizhangError("bad_confirm_token", "确认 token 与 source 不匹配");
    if (Date.now() > Number(pending.expiresAt ?? 0))
        throw new ZhizhangError("confirm_expired", "确认已过期（30 分钟）：请重新生成成本回执");
    if (!token || token !== pending.token)
        throw new ZhizhangError("bad_confirm_token", "确认 token 不正确：须原样回传 library_plan(mode=full) 回执里的 confirm_token");
    return pending;
}

export async function clearPendingConfirm(paths: StoragePaths, sourceId: any) {
    try {
        await unlink(planFiles(paths, sourceId).pending);
    }
    catch {
        /* ignore */
    }
}

export function planProgress(plan: any, facts: any) {
    const have = new Set(facts.map((f: any) => Number(f.n)));
    const done = plan.chapters.filter((c: any) => have.has(Number(c.n))).length;
    let cursor = 0;
    for (const b of plan.batches) {
        if (b.chapters.every((n: any) => have.has(Number(n))))
            cursor = b.i + 1;
        else
            break;
    }
    return {
        done,
        total: plan.chapters.length,
        charsDone: plan.chapters.filter((c: any) => have.has(Number(c.n))).reduce((s: string, c: any) => s + (c.chars || 0), 0),
        cursor,
        batches: plan.batches.length,
        nextBatch: cursor < plan.batches.length ? plan.batches[cursor] : null,
    };
}

/** 事实章号是否在计划内；不在则返回提示（不硬拒，允许作者手补）。 */
export function planMembership(plan: any, n: number) {
    if (!plan)
        return { inPlan: true, reason: null };
    const hit = plan.chapters.find((c: any) => Number(c.n) === Number(n));
    return hit
        ? { inPlan: true, reason: hit.reason }
        : { inPlan: false, reason: `第 ${n} 章不在 ${planLabel(plan)} 计划内（手补会标为计划外）` };
}
