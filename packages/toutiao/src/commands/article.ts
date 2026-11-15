import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { readJson, readTextIfExists, resolveInside } from "@zhizhang/core/fs";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import { lit, obj, opt, str, type Infer } from "@zhizhang/core/schema";
import { assertArticleTransition, ARTICLE_STATUSES, type ArticleStatus } from "../domain/status.js";
import { createRulesBridge, type LedgerMutateResult } from "../rules/bridge.js";
import {
  ArticleMetaSchema,
  createArticle,
  registerSource,
  transitionArticleStatus,
  writeDeliverySheet,
  type ArticleMeta,
} from "../storage/articles.js";
import type { ArticleRowView } from "../view/rows.js";

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

export type CreateArticleInput = Infer<typeof CreateArticleReq>;
export type TransitionArticleInput = Infer<typeof TransitionArticleReq>;
export type DeliverArticleInput = Infer<typeof DeliverArticleReq>;
export type RegisterSourceInput = Infer<typeof RegisterSourceReq>;

export async function createArticleCommand(
  rawInput: unknown,
  lock: LockService = createLockService(systemClock),
): Promise<{ articleDir: string; meta: ArticleMeta }> {
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
  const meta = await createArticle(
    articleDir,
    {
      id,
      genre: input.genre,
      driver: input.driver,
      rulesVersion: limits.rules_version,
      nowIso: systemClock.iso(),
    },
    lock,
  );
  return { articleDir, meta };
}

export async function transitionArticleCommand(
  rawInput: unknown,
  lock: LockService = createLockService(systemClock),
): Promise<{ status: ArticleStatus; meta: ArticleMeta }> {
  const input = TransitionArticleReq(rawInput);
  const meta = await transitionArticleStatus(input.articleDir, input.to, systemClock.iso(), lock);
  return { status: meta.status, meta };
}

export async function deliverArticleCommand(
  rawInput: unknown,
  lock: LockService = createLockService(systemClock),
): Promise<{ deliveryPath: string; status: ArticleStatus; ledger?: LedgerMutateResult }> {
  const input = DeliverArticleReq(rawInput);
  return lock.write({ kind: "article", path: input.articleDir }, async () => {
    const nowIso = systemClock.iso();
    const meta = await readJson(path.join(input.articleDir, "meta.json"), ArticleMetaSchema);
    if (!meta) throw new AppError("input.not_found", "未找到文章");
    if (meta.status === "已交稿") {
      return { deliveryPath: path.join(input.articleDir, "交稿单.md"), status: meta.status };
    }
    assertArticleTransition(meta.status, "已交稿");
    const cardPath = input.cardPath ?? path.join(input.articleDir, "card.json");
    const cardExists = await fs.access(cardPath).then(
      () => true,
      () => false,
    );
    if (!cardExists && (input.ledgerPath || input.cardPath)) {
      throw new AppError("input.not_found", `未找到立项卡文件：${cardPath}`, { cardPath });
    }
    let ledger: LedgerMutateResult | undefined;
    if (cardExists) {
      const ledgerPath =
        input.ledgerPath ?? path.join(path.dirname(input.articleDir), "ledger.csv");
      const bridge = createRulesBridge(input.scriptsDir ?? DEFAULT_SCRIPTS_DIR);
      ledger = await bridge.ledgerAdd({
        card: cardPath,
        ledger: ledgerPath,
        articleId: meta.id,
        status: "已交稿",
        date: input.date ?? nowIso.slice(0, 10),
      });
      if (ledger.ok && ledger.existing && ledger.row?.["状态"] !== "已交稿") {
        ledger = await bridge.ledgerStatus({
          title: ledger.row?.["主标题"] ?? input.title,
          to: "已交稿",
          ledger: ledgerPath,
          articleId: meta.id,
        });
      }
      if (!ledger.ok) {
        throw new AppError("input.invalid", ledger.message || "交稿联动台账追加失败", {
          code: ledger.code,
        });
      }
    }
    const deliveryPath = await writeDeliverySheet(
      input.articleDir,
      input.title,
      input.body,
      nowIso,
      lock,
    );
    return { deliveryPath, status: "已交稿", ...(ledger ? { ledger } : {}) };
  });
}

export async function registerSourceCommand(
  rawInput: unknown,
  lock: LockService = createLockService(systemClock),
): Promise<{ sourceId: string }> {
  const input = RegisterSourceReq(rawInput);
  await registerSource(
    input.articleDir,
    input.sourceId,
    input.kind,
    input.content,
    systemClock.iso(),
    lock,
  );
  return { sourceId: input.sourceId };
}

export async function listArticleRowsCommand(root: string): Promise<{ rows: ArticleRowView[] }> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const rows: ArticleRowView[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const articleDir = path.join(root, entry.name);
    const meta = await readJson(path.join(articleDir, "meta.json"), ArticleMetaSchema).catch(
      () => undefined,
    );
    if (!meta) continue;
    const cardRaw = await readTextIfExists(path.join(articleDir, "card.json"));
    let title = meta.chosenTitle ?? meta.id;
    if (!meta.chosenTitle && cardRaw) {
      try {
        const card = JSON.parse(cardRaw) as Record<string, unknown>;
        if (typeof card["主标题"] === "string" && card["主标题"].trim()) {
          title = card["主标题"].trim();
        }
      } catch {
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
  rows.sort(
    (a, b) =>
      ARTICLE_STATUSES.indexOf(a.status) - ARTICLE_STATUSES.indexOf(b.status) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  return { rows };
}
