import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readJson, readTextIfExists } from "@zhizhang/core/fs";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import { arr, obj, str, type Infer } from "@zhizhang/core/schema";
import type { TechniqueCard } from "../pipelines/dissect/index.js";

const LibrarySourceMetaSchema = obj({
  id: str({ min: 1 }),
  title: str({ min: 1 }),
  importedAt: str({ min: 1 }),
  chars: str({ min: 1 }),
});

const TechniqueCardListSchema = arr(
  obj({
    id: str({ min: 1 }),
    title: str({ min: 1 }),
    category: str({ min: 1 }),
    pattern: str({ min: 1 }),
    example: str({ min: 1 }),
    usage: str({ min: 1 }),
  }),
);

export type LibrarySourceMeta = Infer<typeof LibrarySourceMetaSchema>;

export interface LibrarySourceSummary {
  id: string;
  title: string;
  importedAt: string;
  hasReport: boolean;
  cardCount: number;
}

export async function importLibrarySource(
  libraryRoot: string,
  input: { id: string; title: string; content: string },
  lock: LockService = createLockService(systemClock),
): Promise<LibrarySourceMeta> {
  return lock.write({ kind: "library", path: libraryRoot }, async () => {
    const sourcesDir = path.join(libraryRoot, "sources");
    await fs.mkdir(sourcesDir, { recursive: true });
    const meta: LibrarySourceMeta = {
      id: input.id,
      title: input.title,
      importedAt: systemClock.iso(),
      chars: String(input.content.length),
    };
    await atomicWrite(path.join(sourcesDir, `${input.id}.txt`), input.content);
    await atomicWrite(
      path.join(sourcesDir, `${input.id}.meta.json`),
      JSON.stringify(meta, null, 2),
    );
    return meta;
  });
}

export async function listLibrarySources(libraryRoot: string): Promise<LibrarySourceSummary[]> {
  const sourcesDir = path.join(libraryRoot, "sources");
  let files: string[];
  try {
    files = await fs.readdir(sourcesDir);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw new AppError("storage.io", `无法读取拆书库目录：${sourcesDir}`, { sourcesDir });
  }

  const out: LibrarySourceSummary[] = [];
  for (const file of files) {
    if (!file.endsWith(".meta.json")) continue;
    const meta = await readJson(path.join(sourcesDir, file), LibrarySourceMetaSchema).catch(
      () => undefined,
    );
    if (!meta) continue;
    const analysisDir = path.join(libraryRoot, "analyses", meta.id);
    const report = await readTextIfExists(path.join(analysisDir, "report.md"));
    const cards = await readJson(
      path.join(analysisDir, "cards.json"),
      TechniqueCardListSchema,
    ).catch(() => []);
    out.push({
      id: meta.id,
      title: meta.title,
      importedAt: meta.importedAt,
      hasReport: report !== undefined,
      cardCount: cards?.length ?? 0,
    });
  }
  return out.sort((a, b) => a.importedAt.localeCompare(b.importedAt));
}

export async function readLibraryCards(
  libraryRoot: string,
  sourceId: string,
): Promise<{ cards: TechniqueCard[]; report?: string }> {
  const analysisDir = path.join(libraryRoot, "analyses", sourceId);
  const cards =
    (await readJson(path.join(analysisDir, "cards.json"), TechniqueCardListSchema).catch(
      () => undefined,
    )) ?? [];
  const report = await readTextIfExists(path.join(analysisDir, "report.md"));
  return { cards, report };
}
