/** 作品/文章列表与最近目标（recent.json，番茄/头条合一）。 */
import path from "node:path";
import type { Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { loadRecentTargets, recordRecentTarget } from "@zhizhang/core/fs";
import { commands as fanqie } from "@zhizhang/fanqie";
import { commands as toutiao } from "@zhizhang/toutiao";
import type { Target, TargetItem, WorkspaceRoots } from "../../shared/views.js";
import { isMode } from "../modes.js";

export async function listTargets(roots: WorkspaceRoots): Promise<TargetItem[]> {
  if (!roots.fanqie) return [];
  const works = await fanqie.listWorks(roots.fanqie);
  const { rows } = await toutiao.listArticleRowsCommand(roots.toutiao);
  return [
    ...works.map(
      (work): TargetItem => ({
        target: { mode: "fanqie", path: work.workPath },
        label: work.title,
        kind: "work",
        updated: work.created,
      }),
    ),
    ...rows.map(
      (row): TargetItem => ({
        target: { mode: "toutiao", path: path.join(roots.toutiao, row.id) },
        label: row.title,
        kind: "article",
        status: row.status,
        updated: row.updatedAt,
      }),
    ),
  ];
}

export async function describeTarget(target: Target, roots: WorkspaceRoots): Promise<TargetItem> {
  if (target.mode === "fanqie") {
    if (path.resolve(target.path) === path.resolve(roots.library)) {
      return { target, label: path.basename(target.path), kind: "library" };
    }
    const meta = await fanqie.getWork(target.path);
    return { target, label: meta.title, kind: "work", updated: meta.created };
  }
  const { rows } = await toutiao.listArticleRowsCommand(path.dirname(target.path));
  const row = rows.find((r) => r.id === path.basename(target.path));
  if (!row) throw new AppError("input.not_found", `未找到文章：${target.path}`, { path: target.path });
  return { target, label: row.title, kind: "article", status: row.status, updated: row.updatedAt };
}

export async function recentTargets(roots: WorkspaceRoots): Promise<TargetItem[]> {
  const items: TargetItem[] = [];
  for (const entry of await loadRecentTargets().catch(() => [])) {
    if (!isMode(entry.mode)) continue;
    const item = await describeTarget({ mode: entry.mode, path: entry.path }, roots).catch(() => undefined);
    if (item) items.push(item);
  }
  return items;
}

export async function rememberTarget(item: TargetItem, clock: Clock): Promise<void> {
  await recordRecentTarget({ mode: item.target.mode, path: item.target.path, title: item.label }, clock.iso());
}
