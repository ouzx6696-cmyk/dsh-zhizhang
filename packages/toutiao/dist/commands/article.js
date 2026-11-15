import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { readJson, readTextIfExists, resolveInside } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import { lit, obj, opt, str } from "@zhizhang/core/schema";
import { ARTICLE_STATUSES, } from "../domain/status.js";
import { createRulesBridge } from "../rules/bridge.js";
import { ArticleMetaSchema, createArticle, registerSource, transitionArticleStatus, writeDeliverySheet, } from "../storage/articles.js";
const DEFAULT_SCRIPTS_DIR = path.resolve(import.meta.dirname, "../../skill/scripts");
export const CreateArticleReq = obj({
    root: str({ min: 1 }),
    id: opt(str({ min: 1 })),
    genre: str({ min: 1 }),
    driver: str({ min: 1 }),
    scriptsDir: opt(str()),
});
export const TransitionArticleReq = obj({
    articleDir: str({ min: 1 }),
    to: lit(...ARTICLE_STATUSES),
});
export const DeliverArticleReq = obj({
    articleDir: str({ min: 1 }),
    title: str({ min: 1 }),
    body: str({ min: 1 }),
    ledgerPath: opt(str({ min: 1 })),
    cardPath: opt(str({ min: 1 })),
    scriptsDir: opt(str()),
    date: opt(str()),
});
export const RegisterSourceReq = obj({
    articleDir: str({ min: 1 }),
    sourceId: str({ min: 1 }),
    kind: lit("paste", "file", "classic"),
    content: str({ min: 1 }),
});
export async function createArticleCommand(rawInput, lock = createLockService()) {
    const input = CreateArticleReq(rawInput);
    const id = input.id ?? `tt-${systemClock.now()}`;
    const articleDir = resolveInside(input.root, id);
    const bridge = createRulesBridge(input.scriptsDir ?? DEFAULT_SCRIPTS_DIR);
    const limits = await bridge.limits();
    if (!limits.genres.includes(input.genre)) {
        throw new AppError("input.invalid", `不支持的体裁：${input.genre}`, {
            genre: input.genre,
            supported: limits.genres,
        });
    }
    const meta = await createArticle(articleDir, {
        id,
        genre: input.genre,
        driver: input.driver,
        rulesVersion: limits.rules_version,
        nowIso: systemClock.iso(),
    }, lock);
    return { articleDir, meta };
}
export async function transitionArticleCommand(rawInput, lock = createLockService()) {
    const input = TransitionArticleReq(rawInput);
    const meta = await transitionArticleStatus(input.articleDir, input.to, systemClock.iso(), lock);
    return { status: meta.status, meta };
}
export async function deliverArticleCommand(rawInput, lock = createLockService()) {
    const input = DeliverArticleReq(rawInput);
    const nowIso = systemClock.iso();
    const deliveryPath = await writeDeliverySheet(input.articleDir, input.title, input.body, nowIso, lock);
    const cardPath = input.cardPath ?? path.join(input.articleDir, "card.json");
    const hasExplicitLedgerTarget = Boolean(input.ledgerPath || input.cardPath);
    const cardExists = await fs
        .access(cardPath)
        .then(() => true)
        .catch(() => false);
    if (!cardExists && !hasExplicitLedgerTarget) {
        return { deliveryPath, status: "已交稿" };
    }
    if (!cardExists) {
        throw new AppError("input.not_found", `未找到立项卡文件：${cardPath}`, { cardPath });
    }
    const meta = await readJson(path.join(input.articleDir, "meta.json"), ArticleMetaSchema).catch(() => undefined);
    const ledgerPath = input.ledgerPath ?? path.join(path.dirname(input.articleDir), "ledger.csv");
    const bridge = createRulesBridge(input.scriptsDir ?? DEFAULT_SCRIPTS_DIR);
    const ledger = await bridge.ledgerAdd({
        card: cardPath,
        ledger: ledgerPath,
        articleId: meta?.id,
        status: "已交稿",
        date: input.date ?? nowIso.slice(0, 10),
    });
    if (!ledger.ok) {
        throw new AppError(ledger.code === "NOT_FOUND" ? "input.not_found" : "input.invalid", ledger.message || "交稿联动台账追加失败", { code: ledger.code });
    }
    return { deliveryPath, status: "已交稿", ledger };
}
export async function registerSourceCommand(rawInput, lock = createLockService()) {
    const input = RegisterSourceReq(rawInput);
    await registerSource(input.articleDir, input.sourceId, input.kind, input.content, systemClock.iso(), lock);
    return { sourceId: input.sourceId };
}
export async function listArticleRowsCommand(root) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const rows = [];
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const articleDir = path.join(root, entry.name);
        const meta = await readJson(path.join(articleDir, "meta.json"), ArticleMetaSchema).catch(() => undefined);
        if (!meta)
            continue;
        const cardRaw = await readTextIfExists(path.join(articleDir, "card.json"));
        let title = meta.chosenTitle ?? meta.id;
        if (!meta.chosenTitle && cardRaw) {
            try {
                const card = JSON.parse(cardRaw);
                if (typeof card["主标题"] === "string" && card["主标题"].trim()) {
                    title = card["主标题"].trim();
                }
            }
            catch {
                // ignore invalid card preview
            }
        }
        const updatedAt = meta.history.at(-1)?.at ?? "";
        rows.push({
            id: meta.id,
            title,
            genre: meta.genre,
            driver: meta.driver,
            status: meta.status,
            updatedAt,
        });
    }
    rows.sort((a, b) => ARTICLE_STATUSES.indexOf(a.status) - ARTICLE_STATUSES.indexOf(b.status) ||
        b.updatedAt.localeCompare(a.updatedAt));
    return { rows };
}
