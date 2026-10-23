import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWork, ensureStorage, type StoragePaths } from "../src/lib/store.ts";

export const FIXTURES = path.join(import.meta.dirname, "fixtures");

export async function withTempRoot(prefix = "zhizhang-"): Promise<{
  base: string;
  paths: StoragePaths;
  cleanup: () => Promise<void>;
}> {
  const base = await mkdtemp(path.join(tmpdir(), prefix));
  const paths = await ensureStorage({}, { storageRoot: base });
  return {
    base,
    paths,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

export async function withTempWork(title = "测作品") {
  const ctx = await withTempRoot();
  const { meta, dir } = await createWork(ctx.paths, { title });
  return { ...ctx, meta, dir };
}

/** Pad short samples so HumanFeel MIN_CHARS (120) / NovelSense (160) engage. */
export function padBody(s: string, times = 2): string {
  return s.repeat(times);
}
