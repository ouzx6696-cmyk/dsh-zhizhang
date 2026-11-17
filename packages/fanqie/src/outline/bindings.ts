import { AppError } from "@zhizhang/core/errors";
import { readTextIfExists, resolveResourcePath, sha256 } from "@zhizhang/core/fs";
import type { IntentWrite } from "@zhizhang/core/journal";
import { listChapters } from "../commands/chapter.js";
import { parseChapterMarkdown, serializeChapterMarkdown } from "../domain/chapter.js";
import { nodesOf, type Outline } from "./store.js";
export async function bindingWrites(
  work: string,
  outline: Outline,
  extra: IntentWrite[] = [],
): Promise<IntentWrite[]> {
  const rows = await listChapters(work),
    bindings = new Map<string, string>();
  for (const { node } of nodesOf(outline))
    if ("chapterId" in node && node.chapterId) {
      const file = resolveResourcePath(work, "chapters", `${node.chapterId}.md`);
      if (
        !rows.some((row) => row.id === node.chapterId) &&
        !extra.some((write) => write.path === file && write.after !== null)
      )
        throw new AppError("input.invalid", "绑定的正文不存在", {
          chapter: node.chapterId,
          rule: "V2-3",
        });
      bindings.set(node.chapterId, node.id);
    }
  const writes: IntentWrite[] = [];
  for (const row of rows) {
    const file = resolveResourcePath(work, "chapters", `${row.id}.md`),
      raw = await readTextIfExists(file);
    if (raw === undefined) continue;
    const doc = parseChapterMarkdown(raw),
      id = bindings.get(row.id);
    if (doc.meta.outlineId === id) continue;
    doc.meta.outlineId = id;
    writes.push({ path: file, beforeHash: sha256(raw), after: serializeChapterMarkdown(doc) });
  }
  return writes;
}
