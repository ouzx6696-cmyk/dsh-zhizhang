import { resolveFanqieWork } from "./storage";
import { migrateInspirationBindings } from "../../../../packages/fanqie/src/engine/storage/inspiration-migration";
import { physicalRoot } from "../../../../packages/core/src/identity";
import path from "node:path";
import type { Target } from "../context";
import { rememberRoot } from "../../../../packages/toutiao/src/env";
import { atomicWrite, serialize } from "../../../../packages/core/src/fsx";
import {
  ensureStorage,
  listProjects,
  projectIdOf,
  rememberProject,
} from "../../../../packages/fanqie/src/engine/work-store";
import {
  claimWorkspace,
  releaseWorkspace,
  takeOverWorkspace,
} from "../../../../packages/core/src/workspace-lock";
import type { Runtime } from "./runtime";

export async function lockRoot(state: Runtime, value: Target) {
  if (value.mode === "toutiao" || !value.work) return value.root;
  return resolveFanqieWork(state.writerConfig, value);
}

export async function selectTarget(state: Runtime, next: Target) {
  return serialize(`target:${state.home}`, async () => {
    if (state.maintenance) throw new Error("正在恢复作品，请等待完成后切换");
    const previous = state.target;
    const normalized = {
      mode: next.mode,
      root: physicalRoot(next.root),
      ...(next.article ? { article: next.article } : {}),
      ...(next.work ? { work: next.work } : {}),
    };
    if (normalized.mode !== "toutiao") {
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
      await migrateInspirationBindings(paths);
      await rememberProject(paths.base, paths.works);
    }
    await state.sessions.initialize(normalized);
    const newRoot = await lockRoot(state, normalized);
    const access = await claimWorkspace(newRoot);
    try {
      if (normalized.mode === "toutiao") await rememberRoot(normalized.root);
      await atomicWrite(path.join(state.home, "target.json"), JSON.stringify(normalized));
    } catch (error) {
      if (
        (!previous || !state.sessions.same(previous, normalized)) &&
        !state.sessions.isRunning(normalized)
      )
        try {
          await releaseWorkspace(newRoot);
        } catch (releaseError) {
          await reportReleaseFailure(state, releaseError);
        }
      throw error;
    }
    state.target = normalized;
    state.access = access;
    if (previous && !state.sessions.same(previous, normalized)) {
      if (!state.sessions.isRunning(previous)) {
        try {
          const oldRoot = await lockRoot(state, previous);
          if (oldRoot !== newRoot) await releaseWorkspace(oldRoot);
        } catch (error) {
          await reportReleaseFailure(state, error);
        }
      }
      state.sessions.release(previous);
    }
    return normalized;
  });
}

/** The author confirmed in the renderer that the other device or window has closed the work. */
export async function takeOverTarget(state: Runtime, ownerId: string) {
  return serialize(`target:${state.home}`, async () => {
    if (state.maintenance) throw new Error("正在恢复作品，请等待完成后再接管");
    if (!state.target) throw new Error("请先选择作品");
    const current = state.target;
    const previous = state.access.owner;
    const access = await takeOverWorkspace(await lockRoot(state, current), ownerId);
    state.access = access;
    await state.diagnostics.write("workspace_taken_over", {
      mode: current.mode,
      work: current.work,
      previousHost: previous?.host,
      previousMachine: previous?.machine,
      previousPid: previous?.pid,
    });
    state.emit({ target: current, refresh: true });
    return access;
  });
}

export async function releaseInactiveTarget(state: Runtime, target: Target) {
  if (
    !state.target ||
    state.sessions.same(target, state.target) ||
    state.sessions.isRunning(target)
  )
    return;
  try {
    const root = await lockRoot(state, target);
    if (!state.target || root !== (await lockRoot(state, state.target)))
      await releaseWorkspace(root);
  } catch (error) {
    await reportReleaseFailure(state, error);
  }
}

async function reportReleaseFailure(state: Runtime, error: unknown) {
  state.notice = "作品占用释放失败，请保留现有文件并核对：" + String(error);
  state.emit({ error: state.notice });
  await state.diagnostics.write("workspace_release_failed", { message: String(error) });
}

export { releaseWorkspaces } from "../../../../packages/core/src/workspace-lock";
