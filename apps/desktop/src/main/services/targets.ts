/** 作品/文章列表、聚合元数据索引（.zhizhang/index.json）与最近目标（recent.json）。 */
import path from "node:path";
import type { Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, loadRecentTargets, recordRecentTarget } from "@zhizhang/core/fs";
import { FORMAT_VERSION, WORKSPACE_META_DIR } from "@zhizhang/core/paths";
import { commands as fanqie } from "@zhizhang/fanqie";
import { commands as toutiao } from "@zhizhang/toutiao";
import type { Target, TargetItem, WorkspaceRoots } from "../../shared/views.js";
import { isMode } from "../modes.js";

async function enrichWork(
  work: Awaited<ReturnType<typeof fanqie.listWorks>>[number],
): Promise<TargetItem> {
  const [chapters, bible] = await Promise.all([
    fanqie.listChapters(work.workPath).catch(() => []),
    fanqie.readBible(work.workPath).catch(() => undefined),
  ]);
  const wordCount = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);
  const finalCount = chapters.filter((ch) => ch.status === "final").length;
  return {
    target: { mode: "fanqie", path: work.workPath },
    label: work.title,
    kind: "work",
    updated: work.created,
    wordCount,
    chapterCount: chapters.length,
    finalCount,
    pendingBible: bible?.pending.length ?? 0,
    profile: work.profile,
    ...(work.tags ? { tags: work.tags } : {}),
    ...(work.pinned !== undefined ? { pinned: work.pinned } : {}),
    ...(work.archived !== undefined ? { archived: work.archived } : {}),
  };
}

export async function listTargets(roots: WorkspaceRoots): Promise<TargetItem[]> {
  if (!roots.fanqie) return [];
  const [works, { rows }] = await Promise.all([
    fanqie.listWorks(roots.fanqie),
    toutiao.listArticleRowsCommand(roots.toutiao),
  ]);
  const enrichedWorks = await Promise.all(works.map(enrichWork));
  const items: TargetItem[] = [
    ...enrichedWorks,
    ...rows.map((row): TargetItem => ({
      target: { mode: "toutiao", path: path.join(roots.toutiao, row.id) },
      label: row.title,
      kind: "article",
      status: row.status,
      updated: row.updatedAt,
      genre: row.genre,
      ...(row.qaScore !== undefined ? { qaScore: row.qaScore } : {}),
    })),
  ];

  const workspaceRoot = path.dirname(roots.fanqie);
  await atomicWrite(
    path.join(workspaceRoot, WORKSPACE_META_DIR, "index.json"),
    JSON.stringify({ format: FORMAT_VERSION, items }, null, 2),
  ).catch(() => undefined);

  return items;
}

export async function describeTarget(target: Target, roots: WorkspaceRoots): Promise<TargetItem> {
  if (target.mode === "fanqie") {
    if (path.resolve(target.path) === path.resolve(roots.library)) {
      return { target, label: path.basename(target.path), kind: "library" };
    }
    const meta = await fanqie.getWork(target.path);
    return enrichWork({
      id: meta.id,
      title: meta.title,
      workPath: target.path,
      grade: meta.grade,
      profile: meta.profile,
      tags: meta.tags,
      pinned: meta.pinned,
      archived: meta.archived,
      targetTotalWords: meta.targetTotalWords,
      created: meta.created,
    });
  }
  const { rows } = await toutiao.listArticleRowsCommand(path.dirname(target.path));
  const row = rows.find((r) => r.id === path.basename(target.path));
  if (!row)
    throw new AppError("input.not_found", `未找到文章：${target.path}`, { path: target.path });
  return {
    target,
    label: row.title,
    kind: "article",
    status: row.status,
    updated: row.updatedAt,
    genre: row.genre,
    ...(row.qaScore !== undefined ? { qaScore: row.qaScore } : {}),
  };
}

export async function recentTargets(roots: WorkspaceRoots): Promise<TargetItem[]> {
  const items: TargetItem[] = [];
  for (const entry of await loadRecentTargets().catch(() => [])) {
    if (!isMode(entry.mode)) continue;
    const item = await describeTarget({ mode: entry.mode, path: entry.path }, roots).catch(
      () => undefined,
    );
    if (item) items.push(item);
  }
  return items;
}

export async function rememberTarget(item: TargetItem, clock: Clock): Promise<void> {
  await recordRecentTarget(
    { mode: item.target.mode, path: item.target.path, title: item.label },
    clock.iso(),
  );
}
