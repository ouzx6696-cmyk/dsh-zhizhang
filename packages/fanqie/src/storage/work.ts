import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readJson } from "@zhizhang/core/fs";
import type { LockService } from "@zhizhang/core/lock";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import { arr, bool, int, lit, obj, opt, str, type Infer } from "@zhizhang/core/schema";

export const WorkMetaSchema = obj({
  format: lit(FORMAT_VERSION),
  id: str({ min: 1 }),
  title: str({ min: 1, max: 100 }),
  created: str({ min: 1 }),
  profile: str({ min: 1 }),
  grade: lit("economy", "standard", "premium"),
  settings: obj({
    requireEditorPass: bool,
    targetWords: int({ min: 500, max: 20000 }),
    previousTextMode: lit("auto", "full", "tail"),
    ledger: opt(lit("ask", "auto", "off")),
    threadForgetAfter: opt(int({ min: 1, max: 100 })),
    recentFactsWindow: opt(int({ min: 0, max: 20 })),
    contextBudget: opt(int({ min: 4000, max: 200000 })),
    terminalStates: opt(arr(str({ max: 60 }), { max: 20 })),
  }),
});

export type WorkMeta = Infer<typeof WorkMetaSchema>;

export async function createWorkLayout(
  workPath: string,
  input: {
    id: string;
    title: string;
    profile?: string;
    grade?: "economy" | "standard" | "premium";
    nowIso: string;
  },
  lock: LockService,
): Promise<WorkMeta> {
  const exists = await fs.stat(workPath).then(
    () => true,
    () => false,
  );
  if (exists) {
    throw new AppError("input.invalid", `作品已存在：${input.title}`, { field: "title" });
  }
  const meta: WorkMeta = {
    format: FORMAT_VERSION,
    id: input.id,
    title: input.title,
    created: input.nowIso,
    profile: input.profile ?? "default",
    grade: input.grade ?? "standard",
    settings: {
      requireEditorPass: false,
      targetWords: 3000,
      previousTextMode: "auto",
      contextBudget: undefined,
      ledger: "auto",
      threadForgetAfter: 10,
      recentFactsWindow: 5,
      terminalStates: ["死亡", "陨落", "封印", "失踪"],
    },
  };
  await lock.write({ kind: "work", path: workPath }, async () => {
    for (const dir of [
      "outline/volumes",
      "bible/ledger",
      "bible/pending",
      "bible/changes",
      "imports",
    ])
      await fs.mkdir(path.join(workPath, dir), { recursive: true });
    await fs.mkdir(path.join(workPath, "chapters"), { recursive: true });
    await fs.mkdir(path.join(workPath, "candidates"), { recursive: true });
    await fs.mkdir(path.join(workPath, "history"), { recursive: true });
    await fs.mkdir(path.join(workPath, "bible"), { recursive: true });
    await fs.mkdir(path.join(workPath, ".cache"), { recursive: true });
    await atomicWrite(path.join(workPath, "work.json"), JSON.stringify(meta, null, 2));
    await atomicWrite(
      path.join(workPath, "outline", "book.json"),
      JSON.stringify(
        { format: FORMAT_VERSION, title: input.title, volumeOrder: [], rev: 0 },
        null,
        2,
      ),
    );
  });
  return meta;
}

export async function readWorkMeta(workPath: string): Promise<WorkMeta> {
  const meta = await readJson(path.join(workPath, "work.json"), WorkMetaSchema);
  if (!meta) {
    throw new AppError("input.not_found", `未找到作品：${workPath}`, { workPath });
  }
  return meta;
}
