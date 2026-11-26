/**
 * export.save：弹出保存对话框后导出稿件；“复制”把正文写入宿主剪贴板（Web 模式回传正文交由浏览器写入）。
 * 桌面端通过系统保存对话框获取受信任的目标路径；Web 端写至受控导出目录并返回下载链接，不暴露宿主机绝对路径。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readJson, readTextIfExists } from "@zhizhang/core/fs";
import { commands as fanqie } from "@zhizhang/fanqie";
import { commands as toutiao } from "@zhizhang/toutiao";
import { ArticleMetaSchema } from "@zhizhang/toutiao/storage";
import { wordDocument } from "../../exports.js";
import type { ExportRequest, ExportResult, Target } from "../../shared/views.js";
import type { CommandCtx } from "../commands.js";

export interface ExportHost {
  kind: "electron" | "web";
  pickSave(defaultName: string, extension: string): Promise<string | null>;
  copy(text: string): void;
}

/** 头条正文：交稿单（若要求且存在）或最新一版草稿；标题取已选标题或首行标题。 */
async function readArticleText(
  articleDir: string,
  includeDelivery: boolean,
): Promise<{ title: string; text: string }> {
  const meta = await readJson(path.join(articleDir, "meta.json"), ArticleMetaSchema);
  if (!meta) throw new AppError("input.not_found", `未找到文章：${articleDir}`, { articleDir });
  let raw = includeDelivery
    ? await readTextIfExists(path.join(articleDir, "交稿单.md"))
    : undefined;
  if (raw === undefined) {
    const dir = path.join(articleDir, "drafts");
    const names = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith(".md"));
    let newest: { name: string; mtime: number } | undefined;
    for (const name of names) {
      const stat = await fs.stat(path.join(dir, name));
      if (!newest || stat.mtimeMs >= newest.mtime) newest = { name, mtime: stat.mtimeMs };
    }
    raw = newest ? await readTextIfExists(path.join(dir, newest.name)) : undefined;
  }
  if (raw === undefined)
    throw new AppError("input.not_found", "这篇文章还没有可导出的稿件", { articleDir });
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const heading = /^#\s+(.+)$/.exec(lines[0] ?? "")?.[1]?.trim();
  const title = meta.chosenTitle ?? heading ?? meta.id;
  const text = (heading ? lines.slice(1) : lines).join("\n").trim();
  return { title, text };
}

function fileResult(host: ExportHost, outPath: string, count: number): Exclude<ExportResult, null> {
  if (host.kind === "web") {
    const fileName = path.basename(outPath);
    return {
      file: fileName,
      fileName,
      count,
      downloadUrl: `/api/exports/${encodeURIComponent(fileName)}`,
    };
  }
  return { file: outPath, count };
}

export async function exportTarget(
  target: Target,
  request: ExportRequest,
  ctx: CommandCtx,
  host: ExportHost,
): Promise<ExportResult> {
  if (target.mode === "fanqie") {
    const work = ctx.inside(target.path);
    const finalOnly = request.finalOnly ?? true;
    if (request.format === "copy") {
      const result = await fanqie.exportWorkTxt(work, { onlyFinal: finalOnly });
      host.copy(result.content);
      return host.kind === "web"
        ? { copied: true, chars: result.content.length, content: result.content }
        : { copied: true, chars: result.content.length };
    }
    if (request.format === "md")
      throw new AppError("input.invalid", "长篇导出支持 TXT 与 DOCX", { field: "format" });
    const meta = await fanqie.getWork(work);
    const outPath = await host.pickSave(meta.title, request.format);
    if (!outPath) return null;
    if (request.format === "txt") {
      const result = await fanqie.exportWorkTxt(work, { onlyFinal: finalOnly, outPath });
      return fileResult(host, outPath, result.chapterCount);
    }
    const result = await fanqie.exportWorkTxt(work, { onlyFinal: finalOnly });
    await atomicWrite(outPath, await wordDocument(result.title, result.content));
    return fileResult(host, outPath, result.chapterCount);
  }

  const articleDir = ctx.inside(target.path);
  const includeDelivery = request.includeDelivery ?? false;
  if (request.format === "copy") {
    const { title, text } = await readArticleText(articleDir, includeDelivery);
    const content = `${title}\n\n${text}`;
    host.copy(content);
    return host.kind === "web"
      ? { copied: true, chars: content.length, content }
      : { copied: true, chars: content.length };
  }
  const outPath = await host.pickSave(path.basename(articleDir), request.format);
  if (!outPath) return null;
  if (request.format === "docx") {
    const { title, text } = await readArticleText(articleDir, includeDelivery);
    await atomicWrite(outPath, await wordDocument(title, text));
    return fileResult(host, outPath, 1);
  }
  await toutiao.exportArticleCommand({
    articleDir,
    outPath,
    format: request.format,
    includeDelivery,
  });
  return fileResult(host, outPath, 1);
}
