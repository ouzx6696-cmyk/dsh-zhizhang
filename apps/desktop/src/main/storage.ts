import { storagePaths } from "../../../../packages/fanqie/src/engine/storage/paths";
import { listProjects, projectIdOf } from "../../../../packages/fanqie/src/engine/storage/projects";
import { resolveWorkDir } from "../../../../packages/fanqie/src/engine/work-store";
import type { PluginConfig } from "../../../../packages/fanqie/src/engine/types";
import type { Target } from "../context";
export async function resolveFanqiePaths(config: { fanqie?: PluginConfig }, target: Target) {
  const project = (await listProjects()).find((row) => row.id === projectIdOf(target.root));
  return storagePaths(null, {
    ...config.fanqie,
    storageRoot: target.root,
    ...(project?.worksRoot ? { worksRoot: project.worksRoot } : {}),
  });
}
export async function resolveFanqieWork(config: { fanqie?: PluginConfig }, target: Target) {
  if (!target.work) throw new Error("请先选择小说");
  return resolveWorkDir(await resolveFanqiePaths(config, target), target.work);
}
