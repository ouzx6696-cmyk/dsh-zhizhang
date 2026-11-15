import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readJson, readTextIfExists } from "@zhizhang/core/fs";
import { bool, lit, obj, opt, str } from "@zhizhang/core/schema";
import { ArticleMetaSchema } from "../storage/articles.js";
export const ExportArticleReq = obj({
    articleDir: str({ min: 1 }),
    outPath: str({ min: 1 }),
    format: opt(lit("md", "txt")),
    includeDelivery: opt(bool),
});
async function resolveLatestDraftText(articleDir) {
    const draftsDir = path.join(articleDir, "drafts");
    const files = await fs.readdir(draftsDir).catch(() => []);
    const mdFiles = files.filter((f) => f.endsWith(".md") && !f.endsWith(".marker.json"));
    if (mdFiles.length === 0) {
        throw new AppError("input.not_found", `未找到可导出的草稿文件: ${draftsDir}`);
    }
    const withStats = await Promise.all(mdFiles.map(async (f) => {
        const full = path.join(draftsDir, f);
        const stat = await fs.stat(full);
        return { full, mtimeMs: stat.mtimeMs };
    }));
    withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const content = await readTextIfExists(withStats[0].full);
    if (!content) {
        throw new AppError("input.not_found", `草稿内容为空: ${withStats[0].full}`);
    }
    return content;
}
export async function exportArticleCommand(rawInput) {
    const input = ExportArticleReq(rawInput);
    const meta = await readJson(path.join(input.articleDir, "meta.json"), ArticleMetaSchema);
    if (!meta) {
        throw new AppError("input.not_found", `未找到文章元数据: ${input.articleDir}`);
    }
    let content = input.includeDelivery
        ? await readTextIfExists(path.join(input.articleDir, "交稿单.md"))
        : undefined;
    if (!content) {
        content = await resolveLatestDraftText(input.articleDir);
    }
    const format = input.format ?? "md";
    const output = format === "txt"
        ? content
            .replace(/^#+\s+/gm, "")
            .replace(/\r\n/g, "\n")
            .trim() + "\n"
        : content;
    await atomicWrite(input.outPath, output);
    return {
        outPath: input.outPath,
        articleId: meta.id,
        chars: output.replace(/\s+/g, "").length,
    };
}
