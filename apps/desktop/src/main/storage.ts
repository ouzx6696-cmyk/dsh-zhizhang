import { listProjects, projectIdOf, resolveWorkDir, storagePaths, type FanqieConfig } from "@zhizhang/fanqie";
import type { Target } from "../context";

export async function resolveFanqiePaths(config: { fanqie?: FanqieConfig }, target: Target) {
  const project = (await listProjects()).find((row) => row.id === projectIdOf(target.root));
  return storagePaths(null, {
    ...config.fanqie,
    storageRoot: target.root,
    ...(project?.worksRoot ? { worksRoot: project.worksRoot } : {}),
  });
}

export async function resolveFanqieWork(config: { fanqie?: FanqieConfig }, target: Target) {
  if (!target.work) throw new Error("请先选择小说");
  return resolveWorkDir(await resolveFanqiePaths(config, target), target.work);
}
