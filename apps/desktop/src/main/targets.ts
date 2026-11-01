import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { Target } from "../context";
import { rememberRoot } from "../../../../packages/toutiao/src/env";
import {
  ensureStorage,
  listProjects,
  projectIdOf,
  resolveWorkDir,
  rememberProject,
} from "../../../../packages/fanqie/src/engine/work-store";
import {
  claimWorkspace,
  releaseWorkspace,
} from "../../../../packages/core/src/workspace-lock";
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
  const version = ++state.selectionVersion;
  const previous = state.target;
  const normalized = {
    mode: next.mode,
    root: path.resolve(next.root),
    ...(next.work ? { work: next.work } : {}),
  };
  if (normalized.mode === "toutiao") rememberRoot(normalized.root);
  else {
    const project = (await listProjects()).find(
      (p) => p.id === projectIdOf(normalized.root),
    );
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
  if (version !== state.selectionVersion) return state.target!;
  state.target = normalized;
  if (
    previous &&
    state.sessions.key(previous) !== state.sessions.key(state.target) &&
    !state.sessions
      .running()
      .some((item) => state.sessions.key(item.target) === state.sessions.key(previous))
  )
    await releaseWorkspace(await lockRoot(state, previous));
  state.access = await claimWorkspace(await lockRoot(state, state.target));
  if (previous && state.sessions.key(previous) !== state.sessions.key(state.target))
    state.sessions.release(previous);
  await writeFile(path.join(state.home, "target.json"), JSON.stringify(state.target));
  return state.target;
}
