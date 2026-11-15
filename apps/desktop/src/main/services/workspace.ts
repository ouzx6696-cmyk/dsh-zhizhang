/**
 * 写作文件夹：跨进程租约（获取失败 → 只读模式）、目录骨架与模式根目录。
 * 只读时所有写命令返回 storage.locked（data.readonly=true）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Clock } from "@zhizhang/core/clock";
import { AppError, isAppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists, resolveInside } from "@zhizhang/core/fs";
import type { Lease, LockService } from "@zhizhang/core/lock";
import { FORMAT_VERSION, WORKSPACE_META_DIR } from "@zhizhang/core/paths";
import type { WorkspaceRoots, WorkspaceStatus } from "../../shared/views.js";

export const MODE_DIRS = { fanqie: "长篇", toutiao: "头条", library: "拆书库" } as const;

export function workspaceRoots(root: string): WorkspaceRoots {
  return root
    ? {
        fanqie: path.join(root, MODE_DIRS.fanqie),
        toutiao: path.join(root, MODE_DIRS.toutiao),
        library: path.join(root, MODE_DIRS.library),
      }
    : { fanqie: "", toutiao: "", library: "" };
}

export interface WorkspaceService {
  status(): WorkspaceStatus;
  open(root: string): Promise<WorkspaceStatus>;
  takeOver(owner: string): Promise<WorkspaceStatus>;
  assertWritable(): void;
  /** 目标路径必须位于写作文件夹内。 */
  assertInside(target: string): string;
  release(): Promise<void>;
}

export function createWorkspaceService(deps: {
  locks: LockService;
  clock: Clock;
}): WorkspaceService {
  let lease: Lease | undefined;
  let state: WorkspaceStatus = {
    root: "",
    configured: false,
    readonly: false,
    roots: workspaceRoots(""),
  };

  async function ensureLayout(root: string): Promise<void> {
    for (const dir of [
      WORKSPACE_META_DIR,
      MODE_DIRS.fanqie,
      MODE_DIRS.toutiao,
      MODE_DIRS.library,
    ]) {
      await fs.mkdir(path.join(root, dir), { recursive: true });
    }
    const rootFile = path.join(root, WORKSPACE_META_DIR, "root.json");
    const existing = await readTextIfExists(rootFile);
    if (existing === undefined) {
      await atomicWrite(
        rootFile,
        JSON.stringify(
          {
            format: FORMAT_VERSION,
            id: `ws-${deps.clock.now().toString(36)}`,
            created: deps.clock.iso(),
          },
          null,
          2,
        ),
      );
      return;
    }
    let format: unknown;
    try {
      format = JSON.parse(existing).format;
    } catch {
      format = undefined;
    }
    if (format !== FORMAT_VERSION) {
      throw new AppError("storage.format_unsupported", "写作文件夹的标记不是 zhizhang/1.3", {
        root,
      });
    }
  }

  async function claim(root: string, expectedOwner?: string): Promise<WorkspaceStatus> {
    try {
      lease = await deps.locks.lease(root, expectedOwner);
      state = { root, configured: true, readonly: false, roots: workspaceRoots(root) };
    } catch (err) {
      if (!isAppError(err, "storage.locked")) throw err;
      lease = undefined;
      const owner = typeof err.data?.owner === "string" ? err.data.owner : undefined;
      state = {
        root,
        configured: true,
        readonly: true,
        roots: workspaceRoots(root),
        ...(owner ? { owner } : {}),
      };
    }
    return state;
  }

  return {
    status: () => state,
    async open(input) {
      const root = path.resolve(input);
      if (lease && lease.root === root) return state;
      const previous = lease;
      await fs.mkdir(root, { recursive: true });
      await ensureLayout(root);
      const next = await claim(root);
      await previous?.release();
      return next;
    },
    async takeOver(owner) {
      if (!state.readonly || !state.root) {
        throw new AppError("gate.denied", "写作文件夹没有被其他实例占用");
      }
      if (state.owner !== owner) {
        throw new AppError("storage.conflict", "占用者已变化，请刷新后再接管", {
          owner: state.owner ?? "",
        });
      }
      return claim(state.root, owner);
    },
    assertWritable() {
      if (!state.configured) {
        throw new AppError("input.invalid", "请先选择写作文件夹", { field: "workspaceRoot" });
      }
      if (state.readonly) {
        throw new AppError("storage.locked", "写作文件夹已被另一个织章实例打开，当前为只读模式", {
          readonly: true,
          ...(state.owner ? { owner: state.owner } : {}),
        });
      }
    },
    assertInside(target) {
      if (!state.root)
        throw new AppError("input.invalid", "请先选择写作文件夹", { field: "workspaceRoot" });
      const resolved = path.resolve(target);
      const rel = path.relative(state.root, resolved);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new AppError("input.invalid", "目标不在写作文件夹内", { path: resolved });
      }
      return rel ? resolveInside(state.root, rel) : resolved;
    },
    async release() {
      await lease?.release();
      lease = undefined;
    },
  };
}
