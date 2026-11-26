/**
 * 存储健康：遗留写锁（原进程已退出）、未完成的多文件写入意图、被中断的流水线运行。
 * 恢复动作只针对本次巡检列出的条目，并且都需要作者在界面上确认后才会发起。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { replayIntents } from "@zhizhang/core/journal";
import type { LockService } from "@zhizhang/core/lock";
import type {
  PendingIntentView,
  RecoverAction,
  StorageHealth,
  WorkspaceStatus,
} from "../../shared/views.js";
import { summarizeRun, type RunStore } from "./runs.js";

async function childDirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => path.join(dir, e.name));
}

async function pendingIntents(status: WorkspaceStatus): Promise<PendingIntentView[]> {
  if (!status.root) return [];
  const resources = [
    ...(await childDirs(status.roots.fanqie)),
    ...(await childDirs(status.roots.toutiao)),
    status.roots.library,
  ];
  const out: PendingIntentView[] = [];
  for (const resource of resources) {
    const dir = path.join(resource, ".journal");
    const names = await fs.readdir(dir).catch(() => []);
    for (const name of names) {
      if (name.endsWith(".json")) out.push({ dir, id: name.slice(0, -5) });
    }
  }
  return out;
}

export function createStorageHealth(deps: {
  locks: LockService;
  runs: RunStore;
  clock: Clock;
  workspace(): WorkspaceStatus;
  cancelRun(action: Extract<RecoverAction, { kind: "discard-run" }>): Promise<unknown>;
}) {
  async function inspect(): Promise<StorageHealth> {
    const status = deps.workspace();
    const lockRoots = status.root ? [status.root, status.roots.fanqie, status.roots.toutiao] : [];
    const innerLocks = (
      await Promise.all(lockRoots.map((dir) => deps.locks.inspectStale(dir)))
    ).flat();
    let parentLeaseLocks: typeof innerLocks = [];
    if (status.root) {
      const resolvedRoot = path.resolve(status.root);
      const parentDir = path.dirname(resolvedRoot);
      const leaseLockName = `.zhizhang-lock-work-${path.basename(resolvedRoot)}`;
      if (parentDir && parentDir !== resolvedRoot) {
        const found = await deps.locks.inspectStale(parentDir);
        parentLeaseLocks = found.filter((lock) => path.basename(lock.lockDir) === leaseLockName);
      }
    }
    const staleLocks = [...parentLeaseLocks, ...innerLocks];
    const interruptedRuns = (await deps.runs.listAll())
      .filter(
        (run) =>
          run.state === "paused" &&
          run.stateHistory[run.stateHistory.length - 1]?.reason === "interrupted",
      )
      .map(summarizeRun);
    return {
      root: status.root,
      readonly: status.readonly,
      staleLocks,
      pendingIntents: await pendingIntents(status),
      interruptedRuns,
    };
  }

  return {
    inspect,
    async recover(action: RecoverAction): Promise<StorageHealth> {
      const health = await inspect();
      if (health.readonly) {
        throw new AppError("storage.locked", "只读模式下不能执行恢复", { readonly: true });
      }
      if (action.kind === "clear-lock") {
        const lock = health.staleLocks.find((l) => l.lockDir === action.lockDir);
        if (!lock)
          throw new AppError("input.not_found", "该写锁已不是遗留锁", { lockDir: action.lockDir });
        await deps.locks.clearStale(lock, { confirmedByAuthor: true, at: deps.clock.iso() });
      } else if (action.kind === "replay-intents") {
        if (!health.pendingIntents.some((i) => i.dir === action.dir)) {
          throw new AppError("input.not_found", "没有待恢复的写入意图", { dir: action.dir });
        }
        const status = deps.workspace();
        const resourceRoot = path.dirname(path.resolve(action.dir));
        const resourceKind =
          resourceRoot === path.resolve(status.roots.library)
            ? "library"
            : resourceRoot.startsWith(path.resolve(status.roots.toutiao) + path.sep)
              ? "article"
              : "work";
        const result = await replayIntents(action.dir, {
          allowedRoots: [resourceRoot],
          lock: deps.locks,
          resource: { kind: resourceKind, path: resourceRoot },
        });
        if (result.conflicts.length > 0) {
          throw new AppError("storage.conflict", "部分写入意图与当前文件冲突，未自动恢复", {
            conflicts: result.conflicts,
            resumed: result.resumed,
          });
        }
      } else {
        await deps.cancelRun(action);
      }
      return inspect();
    },
  };
}
