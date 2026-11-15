import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readJson, sha256 } from "@zhizhang/core/fs";
import type { LockService } from "@zhizhang/core/lock";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import { arr, lit, obj, opt, str, type Infer } from "@zhizhang/core/schema";
import {
  assertArticleTransition,
  FIXED_DELIVERY_ENDING,
  type ArticleStatus,
} from "../domain/status.js";

export const ArticleMetaSchema = obj({
  format: lit(FORMAT_VERSION),
  id: str({ min: 1 }),
  genre: str({ min: 1 }),
  driver: str({ min: 1 }),
  status: lit("初稿待改", "待验收", "已验收", "验收退回", "已交稿"),
  chosenTitle: opt(str()),
  rulesVersion: str({ min: 1 }),
  history: arr(obj({ to: str(), at: str() })),
});

export type ArticleMeta = Infer<typeof ArticleMetaSchema>;

export async function createArticle(
  articleDir: string,
  input: { id: string; genre: string; driver: string; rulesVersion: string; nowIso: string },
  lock: LockService,
): Promise<ArticleMeta> {
  return lock.write({ kind: "article", path: articleDir }, async () => {
    await fs.mkdir(path.join(articleDir, "sources"), { recursive: true });
    await fs.mkdir(path.join(articleDir, "drafts"), { recursive: true });
    const meta: ArticleMeta = {
      format: FORMAT_VERSION,
      id: input.id,
      genre: input.genre,
      driver: input.driver,
      status: "初稿待改",
      chosenTitle: undefined,
      rulesVersion: input.rulesVersion,
      history: [{ to: "初稿待改", at: input.nowIso }],
    };
    await atomicWrite(path.join(articleDir, "meta.json"), JSON.stringify(meta, null, 2));
    return meta;
  });
}

export async function registerSource(
  articleDir: string,
  sourceId: string,
  kind: "paste" | "file" | "classic",
  content: string,
  nowIso: string,
  lock: LockService,
): Promise<void> {
  await lock.write({ kind: "article", path: articleDir }, async () => {
    const dir = path.join(articleDir, "sources");
    await atomicWrite(path.join(dir, `${sourceId}.txt`), content);
    await atomicWrite(
      path.join(dir, `${sourceId}.json`),
      JSON.stringify({ id: sourceId, kind, hash: sha256(content), at: nowIso }, null, 2),
    );
  });
}

export async function transitionArticleStatus(
  articleDir: string,
  to: ArticleStatus,
  nowIso: string,
  lock: LockService,
): Promise<ArticleMeta> {
  return lock.write({ kind: "article", path: articleDir }, async () => {
    const metaFile = path.join(articleDir, "meta.json");
    const meta = await readJson(metaFile, ArticleMetaSchema);
    if (!meta) throw new AppError("input.not_found", `Article not found: ${articleDir}`);
    assertArticleTransition(meta.status, to);
    const next: ArticleMeta = {
      ...meta,
      status: to,
      history: [...meta.history, { to, at: nowIso }],
    };
    await atomicWrite(metaFile, JSON.stringify(next, null, 2));
    return next;
  });
}

export async function writeDeliverySheet(
  articleDir: string,
  title: string,
  body: string,
  nowIso: string,
  lock: LockService,
): Promise<string> {
  return lock.write({ kind: "article", path: articleDir }, async () => {
    const metaFile = path.join(articleDir, "meta.json");
    const meta = await readJson(metaFile, ArticleMetaSchema);
    if (!meta) throw new AppError("input.not_found", `Article not found: ${articleDir}`);
    assertArticleTransition(meta.status, "已交稿");

    const outPath = path.join(articleDir, "交稿单.md");
    const content = `# ${title}\n\n${body.trim()}\n\n${FIXED_DELIVERY_ENDING}\n`;
    await atomicWrite(outPath, content);
    const next: ArticleMeta = {
      ...meta,
      status: "已交稿",
      chosenTitle: title,
      history: [...meta.history, { to: "已交稿", at: nowIso }],
    };
    await atomicWrite(metaFile, JSON.stringify(next, null, 2));
    return outPath;
  });
}
