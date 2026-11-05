/** Read-only writing activity derived from existing chapter versions. */
import path from "node:path";
import { readdir } from "node:fs/promises";
import { readTextCached } from "./file-cache.js";

const localDay = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

export async function writingActivity(dir: string, chapters: { id: string }[], now = new Date()) {
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - 6 + index);
    return localDay(date);
  });
  const daily = new Map(dates.map((date) => [date, 0]));
  for (let offset = 0; offset < chapters.length; offset += 16) {
    const batch = chapters.slice(offset, offset + 16);
    const batchVersions = await Promise.all(
      batch.map(async (chapter) => {
        const folder = path.join(dir, "revisions", chapter.id);
        const names = await readdir(folder).catch((error) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
        return Promise.all(
          [
            ...names.filter((name) => name.endsWith(".md")).map((name) => path.join(folder, name)),
            path.join(dir, "chapters", chapter.id + ".md"),
          ].map(async (file) => {
            const raw = await readTextCached(file);
            const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
            if (!front) return null;
            const metadata = JSON.parse(front[1]);
            return { at: String(metadata.updatedAt || ""), words: Number(metadata.wordCount || 0) };
          }),
        );
      }),
    );
    for (const versions of batchVersions) {
      let previous = 0;
      for (const version of versions
        .filter((v): v is { at: string; words: number } => !!v)
        .sort((a, b) => a.at.localeCompare(b.at))) {
        const day = localDay(new Date(version.at));
        const prev = daily.get(day);
        if (prev !== undefined) daily.set(day, prev + Math.max(0, version.words - previous));
        previous = version.words;
      }
    }
  }
  return {
    days: [...daily].map(([date, words]) => ({ date, words })),
    basis: "按现有保存版本计算字数增加，不计删减",
  };
}
