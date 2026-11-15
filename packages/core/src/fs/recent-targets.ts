import path from "node:path";
import { arr, lit, obj, opt, str, type Infer } from "../schema/parse.js";
import { stateSubpath } from "../paths.js";
import { atomicWrite } from "./atomic.js";
import { readJson } from "./read.js";

const RecentEntrySchema = obj({
  mode: str({ min: 1 }),
  path: str({ min: 1 }),
  title: opt(str()),
  updatedAt: str({ min: 1 }),
});

const RecentFileSchema = obj({
  format: lit("zhizhang/1.3"),
  items: arr(RecentEntrySchema, { max: 50 }),
});

export type RecentEntry = Infer<typeof RecentEntrySchema>;

export async function loadRecentTargets(env?: NodeJS.ProcessEnv): Promise<RecentEntry[]> {
  const file = stateSubpath("recent.json", env);
  const data = await readJson(file, RecentFileSchema);
  return data?.items ?? [];
}

export async function recordRecentTarget(
  entry: Omit<RecentEntry, "updatedAt">,
  nowIso: string,
  env?: NodeJS.ProcessEnv
): Promise<RecentEntry[]> {
  const file = stateSubpath("recent.json", env);
  const existing = await loadRecentTargets(env).catch(() => []);
  const norm = path.resolve(entry.path);
  const next: RecentEntry[] = [
    { ...entry, path: norm, updatedAt: nowIso },
    ...existing.filter((item) => path.resolve(item.path) !== norm),
  ].slice(0, 30);
  await atomicWrite(file, JSON.stringify({ format: "zhizhang/1.3", items: next }, null, 2));
  return next;
}
