import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { commands as fanqieCommands } from "@zhizhang/fanqie";
import { commands as toutiaoCommands } from "@zhizhang/toutiao";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import { wordDocument } from "../exports.js";
import { ModeRegistry } from "./modes.js";

export function resolveCommandMode(command: string) {
  const [mode] = command.split(".");
  if (!mode) throw new AppError("input.invalid", `Invalid command id: ${command}`);
  return ModeRegistry.get(mode);
}

export async function dispatchWorkbenchCommand<K extends WorkbenchCommand>(
  command: K,
  input: CommandInput<K>,
): Promise<CommandResult<K>> {
  resolveCommandMode(command);

  switch (command) {
    case "fanqie.snapshot": {
      const { work } = input as CommandInput<"fanqie.snapshot">;
      await fanqieCommands.getWork(work);
      const rows = await fanqieCommands.listChapters(work);
      const structureRaw =
        (await readTextIfExists(path.join(work, "plan", "structure.json"))) ?? "[]";
      const revision = sha256(JSON.stringify({ rows, structureRaw }));
      return {
        revision,
        full: true,
        rows,
        removedIds: [],
      } as CommandResult<K>;
    }

    case "fanqie.chapter.get": {
      const { work, chapter } = input as CommandInput<"fanqie.chapter.get">;
      const doc = await fanqieCommands.readChapter(work, chapter);
      return {
        id: doc.meta.id,
        title: doc.meta.title,
        body: doc.body,
        revision: doc.meta.revision,
        status: doc.meta.status,
      } as CommandResult<K>;
    }

    case "fanqie.chapter.save": {
      const { work, chapter, base, body } = input as CommandInput<"fanqie.chapter.save">;
      const doc = await fanqieCommands.saveChapter(work, {
        chapterId: chapter,
        body,
        expectedRevision: base || undefined,
      });
      const rows = await fanqieCommands.listChapters(work);
      const row = rows.find((item) => item.id === chapter) ?? {
        id: doc.meta.id,
        title: doc.meta.title,
        position: Number.parseInt(/(\d+)/.exec(doc.meta.id)?.[1] ?? "0", 10),
        status: doc.meta.status,
        wordCount: doc.body.replace(/\s+/g, "").length,
        revision: doc.meta.revision,
      };
      return {
        revision: doc.meta.revision,
        row,
      } as CommandResult<K>;
    }

    case "fanqie.chapter.finalize": {
      const { work, chapter } = input as CommandInput<"fanqie.chapter.finalize">;
      await fanqieCommands.finalizeChapter(work, { chapterId: chapter });
      return { status: "final" } as CommandResult<K>;
    }

    case "fanqie.candidate.accept": {
      const { work, chapter, candidateId, base } = input as CommandInput<"fanqie.candidate.accept">;
      if (base) {
        const current = await fanqieCommands.readChapter(work, chapter).catch(() => undefined);
        if (current && current.meta.revision !== base) {
          throw new AppError("storage.conflict", "章节已在别处更新，请重新读取后再采纳");
        }
      }
      const doc = await fanqieCommands.acceptCandidate(work, {
        chapterId: chapter,
        candidateId,
      });
      return { revision: doc.meta.revision } as CommandResult<K>;
    }

    case "fanqie.work.create": {
      const { root, title, grade } = input as CommandInput<"fanqie.work.create">;
      const id = `work-${Date.now()}`;
      const workPath = path.join(root, id);
      await fanqieCommands.createWork(workPath, { id, title, grade });
      return { workPath } as CommandResult<K>;
    }

    case "fanqie.book.export": {
      const { work, format, finalOnly, outPath } = input as CommandInput<"fanqie.book.export">;
      const result = await fanqieCommands.exportWorkTxt(work, {
        onlyFinal: finalOnly,
        ...(format === "txt" ? { outPath } : {}),
      });
      if (format === "docx") {
        const buffer = await wordDocument(result.title, result.content);
        await atomicWrite(outPath, buffer);
      }
      return { outPath, chapterCount: result.chapterCount } as CommandResult<K>;
    }

    case "toutiao.articles": {
      const { root } = input as CommandInput<"toutiao.articles">;
      return (await toutiaoCommands.listArticleRowsCommand(root)) as CommandResult<K>;
    }

    case "toutiao.article.create": {
      const { root, genre, driver } = input as CommandInput<"toutiao.article.create">;
      const { articleDir } = await toutiaoCommands.createArticleCommand({ root, genre, driver });
      return { articleDir } as CommandResult<K>;
    }

    case "toutiao.article.transition": {
      const { articleDir, to } = input as CommandInput<"toutiao.article.transition">;
      const { status } = await toutiaoCommands.transitionArticleCommand({ articleDir, to });
      return { status } as CommandResult<K>;
    }

    case "toutiao.article.deliver": {
      const { articleDir, title, body } = input as CommandInput<"toutiao.article.deliver">;
      const { deliveryPath } = await toutiaoCommands.deliverArticleCommand({
        articleDir,
        title,
        body,
      });
      return { deliveryPath } as CommandResult<K>;
    }

    default:
      throw new AppError("input.invalid", `Unsupported command: ${String(command)}`);
  }
}
