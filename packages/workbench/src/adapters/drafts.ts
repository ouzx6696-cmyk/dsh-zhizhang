/**
 * 草稿存储的注入契约（M0-2）：渲染层不落 localStorage，正文与助手输入草稿一律经
 * `DraftStore` 读写；桌面端由主进程 IPC 落写作文件夹 `.zhizhang/drafts/`，
 * 没有写作文件夹时注入方退化为内存暂存。
 */
import { AppError } from "@zhizhang/core/errors";
import type { DraftEntry } from "../editor/drafts.js";

export interface DraftStore {
  read(key: string): Promise<DraftEntry | null>;
  /** 写入草稿文本；返回保存时间戳。空文本等价于清除，由实现方决定落盘形态。 */
  write(key: string, text: string, baseRevision: string): Promise<{ savedAt: number }>;
  clear(key: string): Promise<void>;
}

let installed: DraftStore | null = null;

/** 渲染层启动时注入草稿存储（桌面端指向 drafts.* IPC 通道 + 内存后备）。 */
export function installDraftStore(store: DraftStore): void {
  installed = store;
}

export function draftStore(): DraftStore {
  if (!installed) throw new AppError("internal", "草稿存储尚未注入");
  return installed;
}

/** 纯内存暂存：没有写作文件夹时由注入方启用，进程关闭即丢弃，绝不碰 localStorage。 */
export function createMemoryDraftStore(): DraftStore {
  const entries = new Map<string, DraftEntry>();
  return {
    async read(key) {
      return entries.get(key) ?? null;
    },
    async write(key, text, baseRevision) {
      const savedAt = Date.now();
      entries.set(key, { text, savedAt, baseRevision });
      return { savedAt };
    },
    async clear(key) {
      entries.delete(key);
    },
  };
}

/**
 * 桌面端草稿存储：优先走注入的文件通道；未配置写作文件夹（`input.invalid` 且
 * reason `no_workspace`）时自动退回内存暂存，写作者文件夹后自动恢复落盘。
 */
export function createFallbackDraftStore(file: DraftStore): DraftStore {
  const memory = createMemoryDraftStore();
  const isNoWorkspace = (error: unknown): boolean =>
    error instanceof AppError &&
    error.code === "input.invalid" &&
    error.data?.reason === "no_workspace";
  const run = async <T>(op: () => Promise<T>, fallback: () => Promise<T>): Promise<T> => {
    try {
      return await op();
    } catch (error) {
      if (isNoWorkspace(error)) return fallback();
      throw error;
    }
  };
  return {
    read: (key) =>
      run(
        () => file.read(key),
        () => memory.read(key),
      ),
    write: (key, text, baseRevision) =>
      run(
        () => file.write(key, text, baseRevision),
        () => memory.write(key, text, baseRevision),
      ),
    clear: (key) =>
      run(
        () => file.clear(key),
        () => memory.clear(key),
      ),
  };
}
