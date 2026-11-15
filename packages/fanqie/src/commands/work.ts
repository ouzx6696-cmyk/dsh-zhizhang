import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readJson } from "@zhizhang/core/fs";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import { createWorkLayout, readWorkMeta, WorkMetaSchema, type WorkMeta } from "../storage/work.js";

export interface WorkSummary {
  id: string;
  title: string;
  workPath: string;
  grade: WorkMeta["grade"];
  created: string;
}

export async function createWork(
  workPath: string,
  input: { id: string; title: string; profile?: string; grade?: WorkMeta["grade"] },
  lock: LockService = createLockService(systemClock),
): Promise<WorkMeta> {
  return createWorkLayout(
    workPath,
    {
      id: input.id,
      title: input.title,
      profile: input.profile,
      grade: input.grade,
      nowIso: systemClock.iso(),
    },
    lock,
  );
}

export async function getWork(workPath: string): Promise<WorkMeta> {
  return readWorkMeta(workPath);
}

export async function listWorks(worksRoot: string): Promise<WorkSummary[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(worksRoot, { withFileTypes: true });
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw new AppError("storage.io", `无法读取作品目录：${worksRoot}`, { worksRoot });
  }

  const works: WorkSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workPath = path.join(worksRoot, entry.name);
    const meta = await readJson(path.join(workPath, "work.json"), WorkMetaSchema).catch(
      () => undefined,
    );
    if (!meta) continue;
    works.push({
      id: meta.id,
      title: meta.title,
      workPath,
      grade: meta.grade,
      created: meta.created,
    });
  }
  return works.sort((a, b) => a.created.localeCompare(b.created));
}

export async function updateWorkSettings(
  workPath: string,
  patch: Partial<WorkMeta["settings"]> & { grade?: WorkMeta["grade"]; profile?: string },
  lock: LockService = createLockService(systemClock),
): Promise<WorkMeta> {
  return lock.write({ kind: "work", path: workPath }, async () => {
    const meta = await readWorkMeta(workPath);
    const updated: WorkMeta = {
      ...meta,
      grade: patch.grade ?? meta.grade,
      profile: patch.profile ?? meta.profile,
      settings: {
        requireEditorPass: patch.requireEditorPass ?? meta.settings.requireEditorPass,
        targetWords: patch.targetWords ?? meta.settings.targetWords,
        previousTextMode: patch.previousTextMode ?? meta.settings.previousTextMode,
      },
    };
    await atomicWrite(path.join(workPath, "work.json"), JSON.stringify(updated, null, 2));
    return updated;
  });
}
