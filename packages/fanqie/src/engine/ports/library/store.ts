/**
 * 拆书库存储层 — 索引 / 路径 / 导入解码 / 过滤 / 排序。
 * 不包含卡 schema（见 schema.js）与机械审计（见 audit.js）。
 */
import { randomUUID } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, assertResourceId } from "../../storage/primitives.js";
import { withResourceLock } from "../../storage/process-lock.js";
import { assertNoPendingCard } from "../../storage/card-journal.js";
import { coerceAxis, coerceHumanFeel } from "./schema.js";
import type { StoragePaths } from "../../types.js";

export { nowIso } from "../../storage/primitives.js";
export function newId(prefix: string) {
    return `${prefix}-${Date.now().toString(36)}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
export async function fileExists(p: string) {
    try {
        await access(p);
        return true;
    }
    catch (err: any) {
        if (err?.code === "ENOENT") return false;
        throw err;
    }
}
export function libraryDirs(paths: StoragePaths) {
    return {
        root: paths.library,
        sources: path.join(paths.library, "sources"),
        cards: path.join(paths.library, "cards"),
        candidates: path.join(paths.library, "candidates"),
        index: path.join(paths.library, "index.json"),
    };
}
export async function emptyIndex() {
    return { schemaVersion: 1, sources: [], cards: [] };
}
export async function readIndex(paths: StoragePaths) {
    return withResourceLock(paths.library, async () => {
    await assertNoPendingCard(paths.library);
    const { index } = libraryDirs(paths);
    try {
        const raw = JSON.parse(await readFile(index, "utf8"));
        if (!raw || typeof raw !== "object" || !Array.isArray(raw.sources) || !Array.isArray(raw.cards))
            throw new Error(`拆书库索引格式损坏：${index}`);
        return { ...raw, schemaVersion: raw.schemaVersion ?? 1, sources: raw.sources, cards: raw.cards };
    }
    catch (err: any) {
        if (err?.code === "ENOENT") return emptyIndex();
        throw err;
    }
    });
}
export async function writeIndex(paths: StoragePaths, idx: any) {
    await assertNoPendingCard(paths.library);
    const { index } = libraryDirs(paths);
    await atomicWrite(index, JSON.stringify(idx, null, 2) + "\n");
}
export async function resolveSourceIdFilter(paths: StoragePaths, opts: any) {
    const ids = new Set();
    let active = false;
    const one = String(opts.sourceId ?? "").trim();
    if (one) {
        active = true;
        ids.add(one);
    }
    if (Array.isArray(opts.sourceIds)) {
        for (const raw of opts.sourceIds) {
            const id = String(raw ?? "").trim();
            if (id) {
                active = true;
                ids.add(id);
            }
        }
    }
    const titleQ = String(opts.sourceTitle ?? "").trim().toLowerCase();
    if (titleQ) {
        active = true;
        const idx = await readIndex(paths);
        for (const s of idx.sources) {
            const hay = `${s.title} ${s.author ?? ""}`.toLowerCase();
            if (hay.includes(titleQ))
                ids.add(s.id);
        }
    }
    return active ? ids : null;
}
export async function filterCardRows(paths: StoragePaths, rows: any, opts: any) {
    let out = rows;
    const status = opts.status ?? "accepted";
    if (status !== "all") {
        out = out.filter((c: any) => c.status === status);
    }
    const sourceSet = await resolveSourceIdFilter(paths, opts);
    if (sourceSet) {
        out = out.filter((c: any) => sourceSet.has(c.sourceId));
    }
    if (opts.axis === "craft" || opts.axis === "mind") {
        const want = opts.axis;
        const kept = [];
        for (const row of out) {
            let axis = row.axis;
            if (axis !== "craft" && axis !== "mind") {
                const id = assertResourceId(row.id, "卡 id");
                const card = JSON.parse(await readFile(path.join(libraryDirs(paths).cards, `${id}.json`), "utf8"));
                axis = coerceAxis(card);
            }
            if (axis === want)
                kept.push({ ...row, axis });
        }
        out = kept;
    }
    return out;
}
export function comboScore(row: any, query: any, deepHay: any) {
    const tokens = tokenizeQuery(query);
    if (!tokens.length) {
        const t = Date.parse(row.updatedAt);
        return { score: Number.isFinite(t) ? t / 1e12 : 0, matched: 0 };
    }
    let score = 0;
    let matched = 0;
    const title = row.title.toLowerCase();
    const tags = (row.tags ?? []).join(" ").toLowerCase();
    const meta = `${row.sourceId} ${row.axis ?? ""}`.toLowerCase();
    for (const t of tokens) {
        let hit = 0;
        if (title.includes(t))
            hit += 100;
        if (tags.includes(t))
            hit += 40;
        if (meta.includes(t))
            hit += 10;
        if (deepHay && deepHay.includes(t))
            hit += 25;
        if (hit > 0)
            matched += 1;
        score += hit;
    }
    // 多词覆盖加成：命中两个词的卡明显优于只命中一个
    if (tokens.length > 1)
        score += matched * matched * 30;
    // slight recency tie-break
    const t = Date.parse(row.updatedAt);
    if (Number.isFinite(t))
        score += (t % 10000) / 1e6;
    return { score, matched };
}

// ===== 编码 / 路径 / 查询分词 / 证据审计 =====

/** 解码书籍文件：UTF-8 严格校验 → GB18030 回退；避免 GBK 书导入成乱码。 */
export function decodeBookBuffer(buf: any) {
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
        return { text: new TextDecoder("utf-16le").decode(buf.subarray(2)), encoding: "utf-16le", converted: true };
    }
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        return { text: buf.subarray(3).toString("utf8"), encoding: "utf-8-bom", converted: true };
    }
    try {
        return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), encoding: "utf-8", converted: false };
    }
    catch {
        /* not valid utf-8 */
    }
    try {
        return { text: new TextDecoder("gb18030").decode(buf), encoding: "gb18030", converted: true };
    }
    catch {
        /* gb18030 unavailable */
    }
    return { text: buf.toString("utf8"), encoding: "utf-8-lossy", converted: true };
}

/** 兼容 MSYS 风格 /d/foo/bar 与带引号路径。 */
export function normalizeUserPath(raw: string) {
    let p = String(raw ?? "").trim().replace(/^["']|["']$/g, "");
    const msys = p.match(/^\/([a-zA-Z])\/(.*)$/);
    if (msys)
        p = `${msys[1].toUpperCase()}:/${msys[2]}`;
    return p;
}

/** 查询分词：空格 / 逗号 / 顿号 / 分号 / 加号 都算分隔符。 */
export function tokenizeQuery(query: any) {
    return String(query ?? "")
        .toLowerCase()
        .split(/[\s,，、;；/|+]+/)
        .map((t: any) => t.trim())
        .filter((t: any) => /[一-龥A-Za-z0-9]/.test(t));
}

export function cardDeepHay(card: any) {
    const coerced = coerceHumanFeel(card.humanFeel);
    const hf = coerced
        ? `${coerced.writerCraft} ${coerced.characterState} ${coerced.stateOnPage} ${coerced.allowedEdges} ${coerced.failAsTemplate}`
        : "";
    const bc = card.bookCraft
        ? `${card.bookCraft.continueWhy} ${card.bookCraft.adjacentChange ?? ""} ${card.bookCraft.failAsShortStory ?? ""}`
        : "";
    const md = card.mind
        ? `${card.mind.sellIntoCost} ${card.mind.infoStaging} ${card.mind.pressureMachine} ${card.mind.debtAndSwap} ${card.mind.readerContract} ${card.mind.failAsEncyclopedia ?? ""}`
        : "";
    const mech = (card.mechanisms ?? [])
        .map((m: any) => `${m.name} ${m.failWhen} ${m.rebuild} ${m.experience ?? ""} ${m.discard ?? ""}`)
        .join(" ");
    const ho = card.handoff
        ? `${card.handoff.purpose ?? ""} ${card.handoff.experience ?? ""} ${card.handoff.rebuild ?? ""} ${card.handoff.discard ?? ""}`
        : "";
    // v2 模块层：读者想要 / 情绪走向 / 戏剧单元 / 可替换项 / 不可照搬 / 迁移 / 失败边界
    const v2 = [
        card.layer,
        card.dimension,
        card.readerWant,
        card.emotionArc,
        card.dramaticUnit,
        ...(card.replaceables ?? []),
        ...(card.mustNotCopy ?? []),
        card.transfer,
        card.failWhen,
        ...(card.steps ?? []),
        ...(card.bannedDiction ?? []),
    ]
        .filter(Boolean)
        .join(" ");
    // 证据引文：按「第 N 章 + 引文」入库，检索时也要能命中
    const ev = (card.evidence ?? [])
        .map((e: any) => `${e.chapter ?? ""} ${e.quote ?? ""}`)
        .join(" ");
    return `${card.body} ${mech} ${hf} ${bc} ${md} ${ho} ${v2} ${ev} ${card.kind ?? ""} ${card.readingRange ?? ""}`.toLowerCase();
}

const reconciledLibs = new Set();

/** 索引与卡文件对齐：tags/axis/title/updatedAt 以卡文件为准（防止改了卡、索引还是旧的）。 */
export async function reconcileIndex(paths: StoragePaths) {
    const key = paths.library;
    if (reconciledLibs.has(key)) return 0;
    return withResourceLock(paths.library, async () => {
        if (reconciledLibs.has(key)) return 0;
        const d = libraryDirs(paths);
        const idx = await readIndex(paths);
        let changed = 0;
        for (const row of idx.cards) {
            const id = assertResourceId(row.id, "卡 id");
            const p = path.join(d.cards, `${id}.json`);
            if (!(await fileExists(p))) continue;
            const card = JSON.parse(await readFile(p, "utf8"));
            const next = {
                title: card.title ?? row.title,
                sourceId: card.sourceId ?? row.sourceId,
                tags: Array.isArray(card.tags) ? card.tags : row.tags,
                axis: coerceAxis(card),
                status: card.status ?? row.status,
                updatedAt: card.updatedAt ?? row.updatedAt,
            };
            for (const [k, v] of Object.entries(next)) {
                if (JSON.stringify(row[k]) !== JSON.stringify(v)) {
                    row[k] = v;
                    changed += 1;
                }
            }
        }
        if (changed) await writeIndex(paths, idx);
        reconciledLibs.add(key);
        return changed;
    });
}
