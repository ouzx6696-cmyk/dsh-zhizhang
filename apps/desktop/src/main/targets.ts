import path from "node:path";
import type { Target } from "../context";
import { rememberRoot } from "../../../../packages/toutiao/src/env";
import { atomicWrite, serialize } from "../../../../packages/core/src/fsx";
import {
  ensureStorage,
  listProjects,
  projectIdOf,
  resolveWorkDir,
  rememberProject,
} from "../../../../packages/fanqie/src/engine/work-store";
import { claimWorkspace, releaseWorkspace } from "../../../../packages/core/src/workspace-lock";
import type { Runtime } from "./runtime";

export async function lockRoot(state: Runtime, value: Target) {
  if (value.mode === "toutiao" || !value.work) return value.root;
  const project = (await listProjects()).find((item) => item.id === projectIdOf(value.root));
  return resolveWorkDir(
    await ensureStorage(null, {
      ...state.writerConfig.fanqie,
      storageRoot: value.root,
      worksRoot: project?.worksRoot,
    }),
    value.work,
  );
}

export async function selectTarget(state: Runtime, next: Target) {
  if (state.maintenance) throw new Error("正在恢复作品，请等待完成后切换");
  return serialize(`target:${state.home}`, async () => {
    const previous = state.target;
    const normalized = {
      mode: next.mode,
      root: path.resolve(next.root),
      ...(next.work ? { work: next.work } : {}),
    };
    if (normalized.mode === "toutiao") rememberRoot(normalized.root);
    else {
      const project = (await listProjects()).find((p) => p.id === projectIdOf(normalized.root));
      const unified =
        state.settings?.workspace &&
        normalized.root === path.join(state.settings.workspace, ".writer");
      const paths = await ensureStorage(null, {
        ...state.writerConfig.fanqie,
        storageRoot: normalized.root,
        ...(project?.worksRoot
          ? { worksRoot: project.worksRoot }
          : unified
            ? { worksRoot: path.join(state.settings.workspace, "novels") }
            : {}),
      });
      await rememberProject(paths.base, paths.works);
    }
    const newRoot = await lockRoot(state, normalized);
    const access = await claimWorkspace(newRoot);
    try {
      await atomicWrite(path.join(state.home, "target.json"), JSON.stringify(normalized));
    } catch (error) {
      if (
        (!previous || state.sessions.key(previous) !== state.sessions.key(normalized)) &&
        !state.sessions
          .running()
          .some((item) => state.sessions.key(item.target) === state.sessions.key(normalized))
      )
        await releaseWorkspace(newRoot).catch(() => {});
      throw error;
    }
    state.target = normalized;
    state.access = access;
    if (previous && state.sessions.key(previous) !== state.sessions.key(normalized)) {
      if (
        !state.sessions
          .running()
          .some((item) => state.sessions.key(item.target) === state.sessions.key(previous))
      ) {
        try {
          await releaseWorkspace(await lockRoot(state, previous));
        } catch (error) {
          state.notice = "作品已切换，旧目录占用释放失败：" + String(error);
        }
      }
      state.sessions.release(previous);
    }
    return normalized;
  });
}

export { releaseWorkspaces } from "../../../../packages/core/src/workspace-lock";
