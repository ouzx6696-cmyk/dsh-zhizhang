import { exists as pathExists } from "../../../core/src/fsx.js";

import type { StoragePaths, PluginConfig } from "../engine/types.js";

import {
  ensureStorage,
  getLastToolBase,
  listProjects,
  loadLastToolBase,
  projectIdOf,
} from "../engine/work-store.js";

import { NovelError } from "../engine/errors.js";

/**
 * Resolve storage root for HTTP (no agent session).
 * Priority: config.storageRoot → env WRITER_NOVEL_ROOT → cwd/.writer if present → ensureStorage default.
 */
export async function resolveHttpPaths(config: PluginConfig) {
  const configured = config.storageRoot || process.env.WRITER_NOVEL_ROOT?.trim();
  if (configured)
    return {
      ...(await ensureStorage(null, { ...config, storageRoot: configured })),
      resolvedVia: "config",
    };
  const lastBase = getLastToolBase() || (await loadLastToolBase());
  if (lastBase && (await pathExists(lastBase)))
    return {
      ...(await ensureStorage(null, { ...config, storageRoot: lastBase })),
      resolvedVia: "last-agent-tool",
    };
  return { ...(await ensureStorage(null, config)), resolvedVia: "cwd" };
}

export async function panelPaths(
  url: URL,
  config: PluginConfig,
  baseOverride = "",
): Promise<StoragePaths> {
  const requested = (
    baseOverride ||
    url.searchParams.get("base") ||
    url.searchParams.get("project") ||
    ""
  ).trim();
  if (!requested) {
    return resolveHttpPaths(config);
  }
  const want = projectIdOf(requested);
  const find = (list: Awaited<ReturnType<typeof listProjects>>) =>
    list.find((p) => p.id === want || projectIdOf(p.base) === want);
  let match = find(await listProjects());
  if (!match) match = find(await listProjects({ refresh: true }));
  if (!match || !match.exists)
    throw new NovelError("bad_base", "未登记的项目（base 不在项目索引里）");
  const paths = await ensureStorage(null, {
    storageRoot: match.base,
    libraryRoot: config.libraryRoot,
    sourceRoot: config.sourceRoot,
    // 优先用该项目自己记录的作品目录；没记时再回退到全局配置，
    // 否则面板切到子项目会继续读写顶层项目的作品。
    worksRoot: match.worksRoot || config.worksRoot,
  });
  return { ...paths, resolvedVia: "panel:selected-project" };
}
