/**
 * 写作工作台 · 今日头条模式的数据与动作。
 * 对齐 domain/status.ts 与 rules/bridge.ts，不保留旧 v1.2 硬编码与裸 Error。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError, isAppError } from "@zhizhang/core/errors";
import { atomicWrite, readJson, readTextIfExists, resolveInside, sha256 } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import { ARTICLE_STATUSES, assertArticleTransition, FIXED_DELIVERY_ENDING, } from "../domain/status.js";
import { createRulesBridge } from "../rules/bridge.js";
import { ArticleMetaSchema, transitionArticleStatus, writeDeliverySheet, } from "../storage/articles.js";
export const TOUTIAO_ACTIONS = ["new", "continue", "review", "revise"];
const BODY_CAP = 200_000;
const DEFAULT_SCRIPTS_DIR = path.resolve(import.meta.dirname, "../../skill/scripts");
function getBridge(config = {}) {
    return createRulesBridge(config.scriptsDir ?? DEFAULT_SCRIPTS_DIR);
}
function resolveArticleDir(root, id) {
    return resolveInside(root, id);
}
async function listLatestDraftFile(articleDir) {
    const draftsDir = path.join(articleDir, "drafts");
    const entries = await fs.readdir(draftsDir).catch(() => []);
    const mdFiles = entries.filter((name) => name.endsWith(".md") && !name.endsWith(".marker.json"));
    if (mdFiles.length === 0)
        return null;
    const stats = await Promise.all(mdFiles.map(async (name) => {
        const full = path.join(draftsDir, name);
        const st = await fs.stat(full);
        return { name, full, mtimeMs: st.mtimeMs };
    }));
    stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest = stats[0];
    const text = (await readTextIfExists(latest.full)) ?? "";
    return {
        path: latest.full,
        name: latest.name,
        text,
        sha256: sha256(text),
    };
}
function titleOf(meta, card) {
    if (meta.chosenTitle?.trim())
        return meta.chosenTitle.trim();
    if (typeof card["主标题"] === "string" && card["主标题"].trim()) {
        return card["主标题"].trim();
    }
    return meta.id;
}
export async function listArticles(roots, config = {}) {
    const rows = [];
    const issues = [];
    const limits = await getBridge(config)
        .limits()
        .catch(() => undefined);
    for (const rawRoot of roots) {
        const root = path.resolve(rawRoot);
        const entries = await fs.readdir(root, { withFileTypes: true }).catch((err) => {
            issues.push({
                root,
                error: isAppError(err) ? err.message : String(err),
            });
            return [];
        });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const articleDir = path.join(root, entry.name);
            const meta = await readJson(path.join(articleDir, "meta.json"), ArticleMetaSchema).catch((err) => {
                issues.push({
                    root,
                    id: entry.name,
                    error: isAppError(err) ? err.message : String(err),
                });
                return undefined;
            });
            if (!meta)
                continue;
            const cardRaw = await readTextIfExists(path.join(articleDir, "card.json"));
            let card = {};
            if (cardRaw) {
                try {
                    card = JSON.parse(cardRaw);
                }
                catch {
                    card = {};
                }
            }
            const draftsDir = path.join(articleDir, "drafts");
            const draftEntries = await fs.readdir(draftsDir).catch(() => []);
            const revCount = draftEntries.filter((name) => name.endsWith(".md") && !name.endsWith(".marker.json")).length;
            const delivered = (await readTextIfExists(path.join(articleDir, "交稿单.md"))) !== undefined;
            const updatedAt = meta.history.at(-1)?.at ?? "";
            rows.push({
                root,
                id: meta.id,
                title: titleOf(meta, card),
                status: meta.status,
                genre: meta.genre,
                driver: meta.driver,
                rev: revCount,
                qa: null,
                delivered,
                updatedAt,
            });
        }
    }
    rows.sort((a, b) => ARTICLE_STATUSES.indexOf(a.status) - ARTICLE_STATUSES.indexOf(b.status) ||
        b.updatedAt.localeCompare(a.updatedAt));
    return {
        roots: roots.map((r) => path.resolve(r)),
        statuses: [...ARTICLE_STATUSES],
        articles: rows,
        limits,
        issues,
    };
}
export async function articleDetail(rootIn, id, config = {}) {
    const root = path.resolve(rootIn);
    const articleDir = resolveArticleDir(root, id);
    const meta = await readJson(path.join(articleDir, "meta.json"), ArticleMetaSchema);
    if (!meta) {
        throw new AppError("input.not_found", `未找到文章：${id}`, { root, id });
    }
    const cardRaw = await readTextIfExists(path.join(articleDir, "card.json"));
    let card = {};
    if (cardRaw) {
        try {
            card = JSON.parse(cardRaw);
        }
        catch {
            card = {};
        }
    }
    const latestDraft = await listLatestDraftFile(articleDir);
    let draftText = latestDraft?.text ?? "";
    const truncated = draftText.length > BODY_CAP;
    if (truncated)
        draftText = draftText.slice(0, BODY_CAP) + "\n\n…（已截断）";
    const delivery = await readTextIfExists(path.join(articleDir, "交稿单.md"));
    let qa = null;
    let qaValid = false;
    let qaProblem = latestDraft ? undefined : "还没有稿件";
    const bridge = getBridge(config);
    const limits = await bridge.limits();
    if (latestDraft) {
        try {
            qa = await bridge.qa({
                file: latestDraft.path,
                card: cardRaw ? path.join(articleDir, "card.json") : undefined,
                ledger: config.ledgerPath,
                articleId: meta.id,
            });
            qaValid = qa.ok && qa.overall >= limits.pass_score && qa.passed;
            if (!qaValid) {
                qaProblem = `质检 ${qa.overall} 分（门槛 ${limits.pass_score}）`;
            }
        }
        catch (err) {
            qaProblem = isAppError(err) ? err.message : String(err);
        }
    }
    const pick = (k) => (typeof card[k] === "string" ? card[k] : undefined);
    return {
        root,
        id: meta.id,
        title: titleOf(meta, card),
        status: meta.status,
        genre: meta.genre,
        driver: meta.driver,
        rulesVersion: meta.rulesVersion,
        card: {
            主问题: pick("主问题"),
            核心事实: pick("核心事实"),
            读者: pick("读者") ?? pick("目标读者"),
            内容线: pick("内容线"),
            present: Object.keys(card).length > 0,
        },
        draft: latestDraft
            ? {
                name: latestDraft.name,
                sha256: latestDraft.sha256,
                text: draftText,
                truncated,
            }
            : null,
        qa,
        qaValid,
        qaProblem,
        delivery: delivery ?? null,
        history: meta.history,
        adoptable: meta.status === "已验收" && qaValid,
        updatedAt: meta.history.at(-1)?.at ?? "",
    };
}
export async function saveAuthorDraft(rootIn, id, text, expected, config = {}) {
    const clean = text.replace(/\r\n/g, "\n");
    if (!clean.trim()) {
        throw new AppError("input.invalid", "正文不能为空");
    }
    const articleDir = resolveArticleDir(path.resolve(rootIn), id);
    const lock = createLockService();
    const meta = await readJson(path.join(articleDir, "meta.json"), ArticleMetaSchema);
    if (!meta) {
        throw new AppError("input.not_found", `未找到文章：${id}`);
    }
    const latest = await listLatestDraftFile(articleDir);
    if (expected.sha256 && latest && latest.sha256 !== expected.sha256) {
        throw new AppError("storage.conflict", "稿件已被其他流程更新，请刷新后再保存");
    }
    const draftFile = path.join(articleDir, "drafts", `author-${systemClock.now()}.md`);
    await lock.write({ kind: "article", path: articleDir }, async () => {
        await atomicWrite(draftFile, clean);
    });
    let nextMeta = meta;
    if (meta.status !== "初稿待改") {
        assertArticleTransition(meta.status, "初稿待改");
        nextMeta = await transitionArticleStatus(articleDir, "初稿待改", systemClock.iso(), lock);
    }
    let warning;
    if (config.ledgerPath) {
        await getBridge(config)
            .ledgerStatus({
            title: meta.chosenTitle ?? meta.id,
            to: nextMeta.status,
            ledger: config.ledgerPath,
            articleId: meta.id,
        })
            .catch((err) => {
            warning = `正文已保存，台账状态未能同步（${isAppError(err) ? err.message : String(err)}）`;
        });
    }
    return {
        status: nextMeta.status,
        chars: clean.replace(/\s+/g, "").length,
        sha256: sha256(clean),
        ...(warning ? { warning } : {}),
    };
}
export async function articleManuscript(rootIn, id, config = {}) {
    const articleDir = resolveArticleDir(path.resolve(rootIn), id);
    const meta = await readJson(path.join(articleDir, "meta.json"), ArticleMetaSchema);
    if (!meta) {
        throw new AppError("input.not_found", `未找到文章：${id}`);
    }
    const latest = await listLatestDraftFile(articleDir);
    if (!latest) {
        throw new AppError("input.not_found", "文章还没有正文");
    }
    const bridge = getBridge(config);
    const limits = await bridge.limits();
    const qa = await bridge.qa({
        file: latest.path,
        ledger: config.ledgerPath,
        articleId: meta.id,
    });
    return {
        title: meta.chosenTitle ?? meta.id,
        text: latest.text,
        qaValid: qa.ok && qa.overall >= limits.pass_score && qa.passed,
    };
}
export async function adopt(rootIn, id, expected, config = {}) {
    if (!/^[a-f0-9]{64}$/.test(expected.sha256)) {
        throw new AppError("input.invalid", "须指明已经加载的正文指纹");
    }
    const articleDir = resolveArticleDir(path.resolve(rootIn), id);
    const meta = await readJson(path.join(articleDir, "meta.json"), ArticleMetaSchema);
    if (!meta) {
        throw new AppError("input.not_found", `未找到文章：${id}`);
    }
    assertArticleTransition(meta.status, "已交稿");
    const latest = await listLatestDraftFile(articleDir);
    if (!latest) {
        throw new AppError("input.not_found", "文章还没有正文");
    }
    if (latest.sha256 !== expected.sha256) {
        throw new AppError("storage.conflict", "正文版本已变化，请刷新后再采用");
    }
    const bridge = getBridge(config);
    const limits = await bridge.limits();
    const qa = await bridge.qa({
        file: latest.path,
        ledger: config.ledgerPath,
        articleId: meta.id,
    });
    if (!qa.ok || !qa.passed || qa.overall < limits.pass_score) {
        throw new AppError("gate.denied", `当前稿件质检未过线（${qa.overall}/${limits.pass_score}），不能标记已交稿`);
    }
    const title = meta.chosenTitle ?? meta.id;
    const deliveryPath = await writeDeliverySheet(articleDir, title, `${latest.text}\n\n${FIXED_DELIVERY_ENDING}`, systemClock.iso(), createLockService());
    if (config.ledgerPath) {
        await bridge.ledgerStatus({
            title,
            to: "已交稿",
            ledger: config.ledgerPath,
            articleId: meta.id,
        });
    }
    const nextMeta = await readJson(path.join(articleDir, "meta.json"), ArticleMetaSchema);
    if (!nextMeta) {
        throw new AppError("storage.io", "交稿后读取文章元数据失败");
    }
    return { meta: nextMeta, deliveryPath };
}
export async function buildToutiaoDelivery(rootIn, input) {
    if (!TOUTIAO_ACTIONS.includes(input.action)) {
        throw new AppError("input.invalid", `不支持的动作：${input.action}`);
    }
    const action = input.action;
    const root = path.resolve(rootIn);
    const note = (input.note ?? "").trim().slice(0, 300);
    const lines = [];
    if (action === "new") {
        lines.push(note
            ? `【写作台】写一篇新的今日头条，题材/素材：${note}`
            : "【写作台】写一篇新的今日头条：先读取台账与热榜，按 S1/S2 立项后再起稿。");
        lines.push("按流水线走到质检过线并送待验收；不要跳过作者验收直接标记已交稿。");
    }
    else {
        if (!input.id) {
            throw new AppError("input.invalid", "须指明文章");
        }
        const articleDir = resolveArticleDir(root, input.id);
        const meta = await readJson(path.join(articleDir, "meta.json"), ArticleMetaSchema);
        if (!meta) {
            throw new AppError("input.not_found", `未找到文章：${input.id}`);
        }
        const ref = `《${meta.chosenTitle ?? meta.id}》（${meta.id}，${meta.status}）`;
        if (action === "continue") {
            const nextHint = {
                初稿待改: "推进到质检过线并送待验收",
                待验收: "按质检与验收结论决定：过线改为已验收，否则验收退回",
                验收退回: "按退回意见改稿、重跑质检，过线再送待验收",
                已验收: "可在写作台确认采用并生成交稿单",
                已交稿: "这篇已交稿；仅在作者明确要求时再改",
            };
            lines.push(`【写作台】继续${ref}：${nextHint[meta.status]}。`);
        }
        else if (action === "review") {
            lines.push(`【写作台】按 s5-editing 给${ref}做编辑红笔并重跑质检。`);
        }
        else {
            lines.push(`【写作台】按最近质检意见修改${ref}，只改 fails 与硬闸指出的位置，不靠堆口语词或拆小标题凑分。`);
        }
    }
    if (note && action !== "new") {
        lines.push(`作者附言：${note}`);
    }
    return { action, id: input.id, text: lines.join("\n") };
}
